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
  extractOutputText,
  geminiInteraction,
  parseModelJson,
  textModel,
  transcribeAudio,
} from "./gemini.js";
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
    mock: !env?.GEMINI_API_KEY,
    model: textModel(env || {}),
    transcribeModel: env?.GEMINI_TRANSCRIBE_MODEL || textModel(env || {}),
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
  if (!env?.GEMINI_API_KEY) return json(mockTranscript(getQuestion(body.value.questionId), audio));
  try {
    const prompts = await loadPrompts();
    const result = await transcribeAudio({
      env,
      audioBase64: audio.audioBase64,
      mimeType: audio.mimeType,
      durationMs: audio.durationMs,
      prompt: prompts.transcribe,
    });
    if (!result.transcript) return json({ error: "沒有辨識到說話內容，請再錄一次。" }, 422);
    return json({ ...result, input: "audio" });
  } catch {
    return json({ error: "語音轉文字失敗，請稍後再試。音檔沒有被保存。" }, 502);
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
  if (session.followUpsRemaining <= 0) {
    return json({ decision: "done", question: "", mock: !env?.GEMINI_API_KEY });
  }
  const last = session.turns.filter((turn) => turn.role === "student").at(-1);
  if (last.text.length < 12) {
    return json({
      decision: "follow_up",
      question: pickFollowUp(session.question, session.turns),
      mock: !env?.GEMINI_API_KEY,
    });
  }
  if (!env?.GEMINI_API_KEY) return json(mockInterview(session));
  try {
    const prompts = await loadPrompts();
    const payload = await geminiInteraction({
      apiKey: env.GEMINI_API_KEY,
      model: textModel(env),
      systemInstruction: prompts.interviewer,
      thinkingLevel: "low",
      responseSchema: INTERVIEW_SCHEMA,
      input: assembleInterviewerPrompt(prompts.interviewer, session),
    });
    const parsed = parseModelJson(extractOutputText(payload));
    if (parsed.decision !== "follow_up") return json({ decision: "done", question: "", mock: false });
    return json({
      decision: "follow_up",
      question: sanitizeInterviewerQuestion(parsed.question, session),
      mock: false,
    });
  } catch {
    return json({ error: "面試官沒有成功回應，請再送出一次。內容沒有被保存。" }, 502);
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
  if (!env?.GEMINI_API_KEY) return json(mockReflection(session.items));
  try {
    const prompts = await loadPrompts();
    const payload = await geminiInteraction({
      apiKey: env.GEMINI_API_KEY,
      model: textModel(env),
      systemInstruction: prompts.coach,
      thinkingLevel: "low",
      responseSchema: REFLECT_SCHEMA,
      input: assembleReflectPrompt(prompts.coach, session),
    });
    const parsed = parseModelJson(extractOutputText(payload));
    return json({
      mock: false,
      reflectionQuestion: sanitizeReflection(parsed.reflectionQuestion, session.items),
    });
  } catch {
    return json({ mock: false, reflectionQuestion: fallbackReflection(session.items) });
  }
}

async function report(session, env) {
  const delivery = deliveryForItems(session.items);
  if (!env?.GEMINI_API_KEY) return json(mockReport({ ...session, delivery }));
  try {
    const prompts = await loadPrompts();
    const payload = await geminiInteraction({
      apiKey: env.GEMINI_API_KEY,
      model: textModel(env),
      systemInstruction: prompts.coach,
      thinkingLevel: "medium",
      responseSchema: REPORT_SCHEMA,
      input: assembleCoachPrompt(prompts.coach, { ...session, delivery }),
    });
    const parsed = parseModelJson(extractOutputText(payload));
    return json(normalizeReport(parsed, { transcript: studentTranscript(session.items), delivery }));
  } catch {
    return json({ error: "回饋沒有成功產生，請再試一次。內容沒有被保存。" }, 502);
  }
}

async function limit(request, env, bucket) {
  const result = await enforceRateLimit(env, clientIp(request), bucket);
  if (result.allowed) return null;
  return json(
    { error: "這個網路位置的練習次數暫時太多，請稍後再試。", retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000) },
    429,
    { "retry-after": String(Math.ceil(result.retryAfterMs / 1000)) },
  );
}
