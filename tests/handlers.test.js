import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BASE64_CHARS } from "../functions/_lib/constants.js";
import { handleCoach, handleHealth, handleInterview, handleQuestions, handleTranscribe } from "../functions/_lib/handlers.js";
import { getQuestion } from "../functions/_lib/bank.js";

function request(path, { method = "GET", body, ip = "203.0.113.10" } = {}) {
  return new Request(`http://local${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

async function post(handler, path, body, ip) {
  const response = await handler(request(path, { method: "POST", body, ip }), {});
  return { status: response.status, data: await response.json() };
}

test("health and questions advertise mock mode without hidden fields", async () => {
  const health = await handleHealth(request("/api/health"), {});
  const healthBody = await health.json();
  assert.equal(healthBody.mock, true);
  assert.equal(healthBody.model, "gemini-3.8-flash");
  assert.equal(healthBody.rateLimit, "memory");
  const questions = await handleQuestions(request("/api/questions"), {});
  const bank = await questions.json();
  assert.ok(bank.questions.length >= 60);
  assert.equal(Object.hasOwn(bank.questions[0], "followUps"), false);
  assert.equal(Object.hasOwn(bank.questions[0], "strongAnswer"), false);
});

test("mock mode runs text answer, one follow-up, reflection, and a sourced report", async () => {
  const question = getQuestion("q043");
  const answer = "我想讀醫學系是因為高二陪家人看診，醫師先停下來問我們懂不懂。我也知道訓練會睡不夠，如果只是為了收入，我會選別的工作。";
  const transcribed = await post(handleTranscribe, "/api/transcribe", { text: answer }, "203.0.113.21");
  assert.equal(transcribed.status, 200);
  assert.equal(transcribed.data.transcript, answer);
  assert.ok(transcribed.data.delivery.speechRateCharsPerMin > 0);
  assert.equal(transcribed.data.mockAudio, false);

  const first = await post(handleInterview, "/api/interview", {
    questionId: question.id,
    mode: "single",
    turns: [
      { role: "interviewer", kind: "stem", text: question.prompt },
      { role: "student", text: answer, delivery: transcribed.data.delivery },
    ],
  }, "203.0.113.22");
  assert.equal(first.status, 200);
  assert.equal(first.data.decision, "follow_up");
  assert.match(first.data.question, /？$/);
  assert.equal(/很好|不錯|建議/.test(first.data.question), false);

  const secondAnswer = "差在藥學比較少直接和病人一起做決定。我目前的消息來自那一次門診，不是長期見習，所以我還需要再核對。";
  const second = await post(handleInterview, "/api/interview", {
    questionId: question.id,
    mode: "single",
    turns: [
      { role: "interviewer", kind: "stem", text: question.prompt },
      { role: "student", text: answer },
      { role: "interviewer", kind: "follow_up", text: first.data.question },
      { role: "student", text: secondAnswer },
    ],
  }, "203.0.113.23");
  assert.equal(second.status, 200);
  assert.equal(second.data.decision, "done");

  const items = [{
    questionId: question.id,
    turns: [
      { role: "interviewer", kind: "stem", text: question.prompt },
      { role: "student", text: answer, delivery: transcribed.data.delivery },
      { role: "interviewer", kind: "follow_up", text: first.data.question },
      { role: "student", text: secondAnswer },
    ],
  }];
  const reflect = await post(handleCoach, "/api/coach", { stage: "reflect", mode: "single", items }, "203.0.113.24");
  assert.equal(reflect.status, 200);
  assert.match(reflect.data.reflectionQuestion, /？$/);
  assert.equal(reflect.data.dimensions, undefined);
  assert.match(reflect.data.reflectionQuestion, /你剛剛說「/);

  const report = await post(handleCoach, "/api/coach", {
    stage: "report",
    mode: "single",
    reflectionAnswer: "他可能會問我為什麼不是藥學。",
    items,
  }, "203.0.113.25");
  assert.equal(report.status, 200);
  assert.equal(report.data.dimensions.length, 7);
  assert.match(report.data.disclaimer, /不是錄取預測/);
  const transcript = `${answer}\n${secondAnswer}`;
  for (const dimension of report.data.dimensions) {
    for (const quote of dimension.evidence) assert.equal(transcript.includes(quote), true, quote);
    if (dimension.score != null) assert.ok(dimension.evidence.length > 0);
  }
  assert.ok(report.data.delivery.durationMs > 0);
});

test("a very short answer is probed before it can end", async () => {
  const question = getQuestion("q035");
  const response = await post(handleInterview, "/api/interview", {
    questionId: question.id,
    mode: "traditional",
    turns: [
      { role: "interviewer", kind: "stem", text: question.prompt },
      { role: "student", text: "不知道" },
    ],
  }, "203.0.113.26");
  assert.equal(response.data.decision, "follow_up");
});

test("traditional mode stops after the one allowed follow-up", async () => {
  const question = getQuestion("q035");
  const response = await post(handleInterview, "/api/interview", {
    questionId: question.id,
    mode: "traditional",
    turns: [
      { role: "interviewer", kind: "stem", text: question.prompt },
      { role: "student", text: "我不喜歡夜間被叫去解釋一個我也不確定的結果，我會先承認不確定。" },
      { role: "interviewer", kind: "follow_up", text: question.followUps[0] },
      { role: "student", text: "這個不喜歡來自我陪家人等待報告的那個晚上，不是電影。" },
    ],
  }, "203.0.113.27");
  assert.equal(response.data.decision, "done");
  assert.equal(response.data.question, "");
});

test("audio limits and unknown questions are rejected", async () => {
  const tooLong = await post(handleTranscribe, "/api/transcribe", {
    audioBase64: "AAAA",
    mimeType: "audio/webm",
    durationMs: 181000,
  }, "203.0.113.28");
  assert.equal(tooLong.status, 413);

  const badType = await post(handleTranscribe, "/api/transcribe", {
    audioBase64: "AAAA",
    mimeType: "application/octet-stream",
    durationMs: 2000,
  }, "203.0.113.29");
  assert.equal(badType.status, 400);

  const huge = await post(handleTranscribe, "/api/transcribe", {
    audioBase64: "A".repeat(MAX_BASE64_CHARS + 8),
    mimeType: "audio/webm",
    durationMs: 2000,
  }, "203.0.113.30");
  assert.equal(huge.status, 413);

  const missing = await post(handleInterview, "/api/interview", {
    questionId: "q999",
    mode: "single",
    turns: [{ role: "student", text: "這題不存在，所以不該進模型。" }],
  }, "203.0.113.31");
  assert.equal(missing.status, 404);
});

test("mock audio is labeled as a sample, not the student's voice", async () => {
  const bytes = Buffer.from("not-really-audio-but-long-enough-for-the-size-check");
  const response = await post(handleTranscribe, "/api/transcribe", {
    audioBase64: bytes.toString("base64"),
    mimeType: "audio/webm",
    durationMs: 4000,
    questionId: "q010",
  }, "203.0.113.32");
  assert.equal(response.status, 200);
  assert.equal(response.data.mockAudio, true);
  assert.match(response.data.notice, /不是你說的話/);
  assert.match(response.data.transcript, /健保|收入/);
});
