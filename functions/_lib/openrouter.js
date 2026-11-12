import { DEFAULT_MODEL, DEFAULT_TRANSCRIBE_MODEL } from "./constants.js";
import { computeDelivery } from "./delivery.js";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const HTTP_REFERER = "https://drcharming.net";
const APP_TITLE = "med-interview-coach";

export const TEXT_TIMEOUT_MS = 60_000;
export const TRANSCRIBE_TIMEOUT_MS = 120_000;

const AUDIO_FORMATS = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
};

export class UpstreamError extends Error {
  constructor(status, message, usage) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.usage = usage;
  }
}

export function hasOpenRouterKey(env) {
  return typeof env?.OPENROUTER_API_KEY === "string" && env.OPENROUTER_API_KEY.trim() !== "";
}

export function textModel(env) {
  return env?.OPENROUTER_MODEL || DEFAULT_MODEL;
}

export function transcribeModel(env) {
  return env?.OPENROUTER_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL;
}

export function redactSecrets(text, apiKey) {
  let out = String(text ?? "");
  if (apiKey) out = out.split(apiKey).join("[redacted]");
  return out.replace(/sk-or-[A-Za-z0-9_-]+/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export function errorDetail(error) {
  if (error instanceof UpstreamError) {
    if (!error.status) return `upstream ${error.message}`;
    return `upstream ${error.status}: ${error.message}`;
  }
  const message = redactSecrets(error?.message || "request failed").replace(/\s+/g, " ").trim();
  return `upstream ${message}`.slice(0, 300);
}

// Chat Completions takes whatever format string the provider accepts.
// Gemini accepts audio/webm, including MediaRecorder's webm/opus, so the
// container is labeled "webm" and the bytes are not transcoded. Relabeling
// webm as wav makes the model ignore the audio. Responses API format is
// limited to wav and mp3; this client uses Chat Completions instead.
export function audioFormat(mimeType) {
  const base = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return AUDIO_FORMATS[base] || "";
}

export function usageFromPayload(payload) {
  const usage = payload?.usage;
  return {
    prompt_tokens: finiteNumber(usage?.prompt_tokens),
    completion_tokens: finiteNumber(usage?.completion_tokens),
    cost: finiteNumber(usage?.cost),
  };
}

export async function openrouterChat({
  apiKey,
  model,
  systemInstruction,
  userContent,
  responseSchema,
  schemaName,
  thinkingLevel,
  timeoutMs = TEXT_TIMEOUT_MS,
}) {
  const messages = [];
  if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
  messages.push({ role: "user", content: userContent });
  const body = { model, messages };
  if (thinkingLevel) body.reasoning = { effort: thinkingLevel, exclude: true };
  if (responseSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: schemaName || "response",
        strict: true,
        schema: responseSchema,
      },
    };
    body.provider = { require_parameters: true };
  }
  const key = String(apiKey || "").trim();
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "HTTP-Referer": HTTP_REFERER,
        "X-Title": APP_TITLE,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    console.error("openrouter request failed", timedOut ? "timeout" : error?.name || "error");
    throw new UpstreamError(0, timedOut ? "timeout" : "request failed");
  }
  const raw = await response.text();
  if (!response.ok) {
    console.error("openrouter upstream error", response.status, redactSecrets(raw, key).slice(0, 2000));
    throw new UpstreamError(response.status, upstreamMessage(raw, key));
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error("openrouter upstream error", response.status, redactSecrets(raw, key).slice(0, 2000));
    throw new UpstreamError(response.status, "response was not JSON");
  }
  const usage = usageFromPayload(payload);
  console.log(JSON.stringify({ openrouter: "usage", model, ...usage }));
  return { text: extractOutputText(payload), usage };
}

export async function completeJson({
  env,
  model,
  systemInstruction,
  userContent,
  responseSchema,
  schemaName,
  thinkingLevel,
  timeoutMs,
}) {
  const { text, usage } = await openrouterChat({
    apiKey: env.OPENROUTER_API_KEY,
    model,
    systemInstruction,
    userContent,
    responseSchema,
    schemaName,
    thinkingLevel,
    timeoutMs,
  });
  try {
    return { data: parseModelJson(text), usage };
  } catch (error) {
    error.usage = usage;
    throw error;
  }
}

export async function transcribeAudio({ env, audioBase64, mimeType, durationMs, prompt }) {
  const format = audioFormat(mimeType);
  if (!format) throw new UpstreamError(0, "unsupported audio format");
  const model = transcribeModel(env);
  const { data, usage } = await completeJson({
    env,
    model,
    systemInstruction: prompt,
    thinkingLevel: "low",
    timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    schemaName: "transcript",
    responseSchema: {
      type: "object",
      properties: {
        transcript: { type: "string" },
        segments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              startMs: { type: "integer" },
              endMs: { type: "integer" },
              text: { type: "string" },
            },
            required: ["startMs", "endMs", "text"],
          },
        },
      },
      required: ["transcript", "segments"],
    },
    userContent: [
      { type: "text", text: "請轉寫這段繁體中文面試回答。" },
      { type: "input_audio", input_audio: { data: audioBase64, format } },
    ],
  });
  const transcript = String(data.transcript || "").trim();
  const segments = Array.isArray(data.segments) ? data.segments : [];
  return {
    mock: false,
    transcript,
    segments,
    delivery: computeDelivery({ transcript, segments, durationMs }),
    model,
    usage,
  };
}

export const INTERVIEW_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["follow_up", "done"] },
    question: { type: "string" },
  },
  required: ["decision", "question"],
};

export const REFLECT_SCHEMA = {
  type: "object",
  properties: { reflectionQuestion: { type: "string" } },
  required: ["reflectionQuestion"],
};

export const REPORT_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "string" },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          score: { type: "integer" },
          evidence: { type: "array", items: { type: "string" } },
          comment: { type: "string" },
        },
        required: ["id", "evidence", "comment"],
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    trapsHit: {
      type: "array",
      items: {
        type: "object",
        properties: {
          trap: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["trap", "evidence"],
      },
    },
    improvement: { type: "string" },
    betterStructure: { type: "string" },
    deliveryComment: { type: "string" },
  },
  required: ["overall", "dimensions", "strengths", "weaknesses", "trapsHit", "improvement", "betterStructure", "deliveryComment"],
};

export function parseModelJson(text) {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型沒有回傳 JSON。");
  return JSON.parse(trimmed.slice(start, end + 1));
}

function extractOutputText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n").trim();
  }
  return "";
}

function upstreamMessage(raw, apiKey) {
  let message = "";
  try {
    const parsed = JSON.parse(raw);
    const found = parsed?.error?.message || parsed?.message;
    if (typeof found === "string") message = found;
  } catch {
    message = String(raw || "");
  }
  message = redactSecrets(message, apiKey).replace(/\s+/g, " ").trim();
  return (message || "empty error body").slice(0, 240);
}

function finiteNumber(value) {
  if (typeof value === "string" && value.trim() !== "") value = Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
