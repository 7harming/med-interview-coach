import assert from "node:assert/strict";
import test from "node:test";
import { getQuestion } from "../functions/_lib/bank.js";
import { handleCoach, handleHealth, handleInterview, handleTranscribe } from "../functions/_lib/handlers.js";
import { coach, interviewer, transcribe } from "../functions/_lib/prompt-texts.js";
import {
  TEXT_TIMEOUT_MS,
  TRANSCRIBE_TIMEOUT_MS,
  audioFormat,
  redactSecrets,
  usageFromPayload,
} from "../functions/_lib/openrouter.js";

const KEY = "sk-or-v1-testkeyvalue";

function request(path, { method = "GET", body, ip = "203.0.113.80" } = {}) {
  return new Request(`http://local${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

async function post(handler, path, body, env, ip) {
  const response = await handler(request(path, { method: "POST", body, ip }), env);
  return { status: response.status, data: await response.json() };
}

function liveEnv(extra = {}) {
  return { OPENROUTER_API_KEY: KEY, ...extra };
}

function completion(content, usage = { prompt_tokens: 11, completion_tokens: 7, cost: 0.0015 }) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content } }],
    usage,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("audio labels keep the webm container and map the other browser types", () => {
  assert.equal(audioFormat("audio/webm;codecs=opus"), "webm");
  assert.equal(audioFormat("audio/webm"), "webm");
  assert.equal(audioFormat("audio/ogg"), "ogg");
  assert.equal(audioFormat("audio/opus"), "opus");
  assert.equal(audioFormat("audio/mp4"), "m4a");
  assert.equal(audioFormat("audio/x-m4a"), "m4a");
  assert.equal(audioFormat("audio/aac"), "aac");
  assert.equal(audioFormat("audio/mpeg"), "mp3");
  assert.equal(audioFormat("audio/wav"), "wav");
  assert.equal(audioFormat("audio/wave"), "wav");
  assert.equal(audioFormat("audio/flac"), "flac");
  assert.equal(audioFormat("application/octet-stream"), "");
  assert.equal(TEXT_TIMEOUT_MS, 60_000);
  assert.equal(TRANSCRIBE_TIMEOUT_MS, 120_000);
});

test("usage keeps token counts and cost, and secrets are stripped", () => {
  assert.deepEqual(usageFromPayload({ usage: { prompt_tokens: 4, completion_tokens: "2", cost: 0.25 } }), {
    prompt_tokens: 4,
    completion_tokens: 2,
    cost: 0.25,
  });
  assert.deepEqual(usageFromPayload({}), { prompt_tokens: null, completion_tokens: null, cost: null });
  assert.equal(redactSecrets(`bad ${KEY} and Bearer ${KEY}`, KEY).includes(KEY), false);
});

test("health names openrouter and stays in mock mode without its key", async () => {
  const missing = await handleHealth(request("/api/health"), { GEMINI_API_KEY: "still-set" });
  const missingBody = await missing.json();
  assert.equal(missingBody.provider, "openrouter");
  assert.equal(missingBody.mock, true);
  assert.equal(missingBody.model, "google/gemini-3.8-flash");

  const blank = await handleHealth(request("/api/health"), { OPENROUTER_API_KEY: "  " });
  assert.equal((await blank.json()).mock, true);

  const live = await handleHealth(request("/api/health"), liveEnv({
    OPENROUTER_MODEL: "google/gemini-3.5-flash",
    OPENROUTER_TRANSCRIBE_MODEL: "google/gemini-3.8-flash",
  }));
  const liveBody = await live.json();
  assert.equal(liveBody.mock, false);
  assert.equal(liveBody.provider, "openrouter");
  assert.equal(liveBody.model, "google/gemini-3.5-flash");
  assert.equal(liveBody.transcribeModel, "google/gemini-3.8-flash");
});

test("transcription sends webm audio to chat completions and returns usage", async () => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return completion(JSON.stringify({
      transcript: "嗯，我想讀醫學系。",
      segments: [{ startMs: 0, endMs: 1200, text: "嗯，我想讀醫學系。" }],
    }));
  };
  try {
    const audioBase64 = Buffer.from("not-really-audio-but-long-enough-for-the-size-check").toString("base64");
    const response = await post(handleTranscribe, "/api/transcribe", {
      audioBase64,
      mimeType: "audio/webm;codecs=opus",
      durationMs: 4000,
      questionId: "q010",
    }, liveEnv(), "203.0.113.81");
    assert.equal(response.status, 200);
    assert.equal(response.data.mock, false);
    assert.equal(response.data.transcript, "嗯，我想讀醫學系。");
    assert.deepEqual(response.data.usage, { prompt_tokens: 11, completion_tokens: 7, cost: 0.0015 });
    assert.equal(response.data.input, "audio");
    const call = seen[0];
    assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(call.init.headers.authorization, `Bearer ${KEY}`);
    assert.equal(call.init.headers["HTTP-Referer"], "https://drcharming.net");
    assert.equal(call.init.headers["X-Title"], "med-interview-coach");
    assert.ok(call.init.signal);
    const body = JSON.parse(call.init.body);
    assert.equal(body.model, "google/gemini-3.8-flash");
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, transcribe);
    assert.equal(body.messages[1].content[1].type, "input_audio");
    assert.equal(body.messages[1].content[1].input_audio.format, "webm");
    assert.equal(body.messages[1].content[1].input_audio.data, audioBase64);
    assert.equal(body.reasoning.effort, "low");
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(JSON.stringify(body).includes(KEY), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("upstream errors expose status and message without the key", async () => {
  const original = globalThis.fetch;
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: `Invalid credentials ${KEY}`, metadata: { authorization: `Bearer ${KEY}` } },
  }), { status: 401 });
  try {
    const audioBase64 = Buffer.from("not-really-audio-but-long-enough-for-the-size-check").toString("base64");
    const response = await post(handleTranscribe, "/api/transcribe", {
      audioBase64,
      mimeType: "audio/webm",
      durationMs: 4000,
    }, liveEnv(), "203.0.113.82");
    assert.equal(response.status, 502);
    assert.match(response.data.error, /語音轉文字失敗/);
    assert.equal(response.data.detail, "upstream 401: Invalid credentials [redacted]");
    assert.equal(JSON.stringify(response.data).includes(KEY), false);
    assert.equal(logs.join("\n").includes(KEY), false);
    assert.match(logs.join("\n"), /401/);
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
  }
});

test("a timed out interviewer call reports timeout instead of a fake success", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  try {
    const question = getQuestion("q043");
    const response = await post(handleInterview, "/api/interview", {
      questionId: question.id,
      mode: "single",
      turns: [
        { role: "interviewer", kind: "stem", text: question.prompt },
        { role: "student", text: "我想讀醫學系是因為高二陪家人看診，醫師先停下來問我們懂不懂。" },
      ],
    }, liveEnv(), "203.0.113.83");
    assert.equal(response.status, 502);
    assert.equal(response.data.detail, "upstream timeout");
    assert.equal(response.data.decision, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("interviewer and coach keep their prompts, and reflect failure is fallback", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.response_format.json_schema.name === "interview_turn") {
      return completion(JSON.stringify({ decision: "follow_up", question: "當時醫師停下來之後，你做了什麼？" }));
    }
    if (body.response_format.json_schema.name === "coach_reflect") {
      return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
    }
    return completion(JSON.stringify({ overall: "這次有一個具體場面。" }), { prompt_tokens: 40, completion_tokens: 9, cost: 0.01 });
  };
  try {
    const question = getQuestion("q043");
    const answer = "我想讀醫學系是因為高二陪家人看診，醫師先停下來問我們懂不懂。";
    const interview = await post(handleInterview, "/api/interview", {
      questionId: question.id,
      mode: "single",
      turns: [
        { role: "interviewer", kind: "stem", text: question.prompt },
        { role: "student", text: answer },
      ],
    }, liveEnv(), "203.0.113.84");
    assert.equal(interview.status, 200);
    assert.equal(interview.data.mock, false);
    assert.equal(interview.data.decision, "follow_up");
    assert.equal(interview.data.usage.cost, 0.0015);
    assert.equal(calls[0].messages[0].content, interviewer);
    assert.equal(calls[0].reasoning.effort, "low");
    assert.match(calls[0].messages[1].content, /不可信/);
    assert.match(calls[0].messages[1].content, /當時醫師|看診/);

    const items = [{
      questionId: question.id,
      turns: [
        { role: "interviewer", kind: "stem", text: question.prompt },
        { role: "student", text: answer },
      ],
    }];
    const reflect = await post(handleCoach, "/api/coach", {
      stage: "reflect",
      mode: "single",
      items,
    }, liveEnv(), "203.0.113.85");
    assert.equal(reflect.status, 200);
    assert.equal(reflect.data.fallback, true);
    assert.equal(Object.hasOwn(reflect.data, "mock"), false);
    assert.match(reflect.data.reflectionQuestion, /你剛剛說「/);
    assert.equal(calls[1].messages[0].content, coach);
    assert.equal(calls[1].reasoning.effort, "low");

    const report = await post(handleCoach, "/api/coach", {
      stage: "report",
      mode: "single",
      items,
    }, liveEnv(), "203.0.113.86");
    assert.equal(report.status, 200);
    assert.equal(report.data.mock, false);
    assert.equal(report.data.usage.prompt_tokens, 40);
    assert.equal(report.data.usage.cost, 0.01);
    assert.equal(calls[2].messages[0].content, coach);
    assert.equal(calls[2].reasoning.effort, "medium");
    assert.match(calls[2].messages[1].content, /stage：report/);
  } finally {
    globalThis.fetch = original;
  }
});
