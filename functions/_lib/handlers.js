import { DISCLAIMER, PRACTICE_AUDIO_NOTE } from "./constants.js";
import { getQuestion, publicQuestions } from "./bank.js";
import { clientIp, json, readJson } from "./http.js";
import { enforceRateLimit } from "./rate-limit.js";
import { validateAudioBody, validateCoachBody, validateInterviewBody } from "./validate.js";
import { mockInterview, mockReflection, mockReport, mockTranscript, transcriptFromText } from "./mock.js";
import { loadPrompts, assembleCoachPrompt, assembleInterviewerPrompt, assembleReflectPrompt } from "./prompts.js";
import {
  INTERVIEW_SCHEMA,
  REFLECT_SCHEMA,
  REPORT_SCHEMA,
  TEXT_TIMEOUT_MS,
  completeJson,
  errorDetail,
  hasOpenRouterKey,
  textModel,
  transcribeAudio,
  transcribeModel,
} from "./openrouter.js";
import {
  deliveryForItems,
  fallbackReflection,
  normalizeReport,
  pickFollowUp,
  sanitizeInterviewerQuestion,
  sanitizeReflection,
  studentTranscript,
} from "./report.js";

export async function handleHealth(_request, env) {
  return json({
    ok: true,
    provider: "openrouter",
    mock: !hasOpenRouterKey(env),
    model: textModel(env || {}),
    transcribeModel: transcribeModel(env || {}),
    rateLimit: env?.RATE_LIMIT_KV ? "kv" : "memory",
    audioMaxSeconds: 180,
    disclaimer: DISCLAIMER,
    audioNote: PRACTICE_AUDIO_NOTE,
  });
}

export async function handleQuestions(request) {
  if (request.method !== "GET") return json({ error: "只接受 GET。" }, 405);
  return json(publicQuestions());
}

export async function handleTranscribe(request, env) {
  if (request.method !== "POST") return json({ error: "只接受 POST。" }, 405);
  const limited = await limit(request, env, "transcribe");
  if (limited) return limited;
  const body = await readJson(request);
  if (body.error) return json({ error: body.error }, body.status);
  const audio = validateAudioBody(body.value);
  if (audio.error) return json({ error: audio.error }, audio.status);
  if (audio.mode === "text") {
    return json({ ...transcriptFromText(audio.text), input: "text" });
  }
  if (!hasOpenRouterKey(env)) return json(mockTranscript(getQuestion(body.value.questionId), audio));
  try {
    const prompts = await loadPrompts();
    const result = await transcribeAudio({
      env,
      audioBase64: audio.audioBase64,
      mimeType: audio.mimeType,
      durationMs: audio.durationMs,
      prompt: prompts.transcribe,
    });
    if (!result.transcript) {
      return json({ error: "沒有辨識到說話內容，請再錄一次。", usage: result.usage }, 422);
    }
    return json({ ...result, input: "audio" });
  } catch (error) {
    return upstreamFailure(error, "語音轉文字失敗，請稍後再試。音檔沒有被保存。");
  }
}

export async function handleInterview(request, env) {
  if (request.method !== "POST") return json({ error: "只接受 POST。" }, 405);
  const limited = await limit(request, env, "interview");
  if (limited) return limited;
  const body = await readJson(request);
  if (body.error) return json({ error: body.error }, body.status);
  const session = validateInterviewBody(body.value);
  if (session.error) return json({ error: session.error }, session.status);
  const mock = !hasOpenRouterKey(env);
  if (session.followUpsRemaining <= 0) {
    return json({ decision: "done", question: "", mock });
  }
  const last = session.turns.filter((turn) => turn.role === "student").at(-1);
  if (last.text.length < 12) {
    return json({
      decision: "follow_up",
      question: pickFollowUp(session.question, session.turns),
      mock,
    });
  }
  if (mock) return json(mockInterview(session));
  try {
    const prompts = await loadPrompts();
    const { data, usage } = await completeJson({
      env,
      model: textModel(env),
      systemInstruction: prompts.interviewer,
      thinkingLevel: "low",
      timeoutMs: TEXT_TIMEOUT_MS,
      schemaName: "interview_turn",
      responseSchema: INTERVIEW_SCHEMA,
      userContent: assembleInterviewerPrompt(prompts.interviewer, session),
    });
    if (data.decision !== "follow_up") return json({ decision: "done", question: "", mock: false, usage });
    return json({
      decision: "follow_up",
      question: sanitizeInterviewerQuestion(data.question, session),
      mock: false,
      usage,
    });
  } catch (error) {
    return upstreamFailure(error, "面試官沒有成功回應，請再送出一次。內容沒有被保存。");
  }
}

export async function handleCoach(request, env) {
  if (request.method !== "POST") return json({ error: "只接受 POST。" }, 405);
  const limited = await limit(request, env, "coach");
  if (limited) return limited;
  const body = await readJson(request);
  if (body.error) return json({ error: body.error }, body.status);
  const session = validateCoachBody(body.value);
  if (session.error) return json({ error: session.error }, session.status);
  if (session.stage === "reflect") return reflect(session, env);
  return report(session, env);
}

async function reflect(session, env) {
  if (!hasOpenRouterKey(env)) return json(mockReflection(session.items));
  try {
    const prompts = await loadPrompts();
    const { data, usage } = await completeJson({
      env,
      model: textModel(env),
      systemInstruction: prompts.coach,
      thinkingLevel: "low",
      timeoutMs: TEXT_TIMEOUT_MS,
      schemaName: "coach_reflect",
      responseSchema: REFLECT_SCHEMA,
      userContent: assembleReflectPrompt(prompts.coach, session),
    });
    return json({
      mock: false,
      reflectionQuestion: sanitizeReflection(data.reflectionQuestion, session.items),
      usage,
    });
  } catch (error) {
    console.error("openrouter reflect fallback", errorDetail(error));
    const body = { fallback: true, reflectionQuestion: fallbackReflection(session.items) };
    if (error?.usage) body.usage = error.usage;
    return json(body);
  }
}

async function report(session, env) {
  const delivery = deliveryForItems(session.items);
  if (!hasOpenRouterKey(env)) return json(mockReport({ ...session, delivery }));
  try {
    const prompts = await loadPrompts();
    const { data, usage } = await completeJson({
      env,
      model: textModel(env),
      systemInstruction: prompts.coach,
      thinkingLevel: "medium",
      timeoutMs: TEXT_TIMEOUT_MS,
      schemaName: "coach_report",
      responseSchema: REPORT_SCHEMA,
      userContent: assembleCoachPrompt(prompts.coach, { ...session, delivery }),
    });
    return json({
      ...normalizeReport(data, { transcript: studentTranscript(session.items), delivery }),
      usage,
    });
  } catch (error) {
    return upstreamFailure(error, "回饋沒有成功產生，請再試一次。內容沒有被保存。");
  }
}

function upstreamFailure(error, message) {
  const detail = errorDetail(error);
  console.error("openrouter handler", detail);
  const body = { error: message, detail };
  if (error?.usage) body.usage = error.usage;
  return json(body, 502);
}

async function limit(request, env, bucket) {
  const result = await enforceRateLimit(env, clientIp(request, env), bucket);
  if (result.allowed) return null;
  return json(
    { error: "這個網路位置的練習次數暫時太多，請稍後再試。", retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000) },
    429,
    { "retry-after": String(Math.ceil(result.retryAfterMs / 1000)) },
  );
}
