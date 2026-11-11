import { DEFAULT_MODEL, DEFAULT_TRANSCRIBE_MODEL } from "./constants.js";
import { computeDelivery, segmentsFromWords, synthesizeSegments } from "./delivery.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

export function textModel(env) {
  return env.GEMINI_MODEL || DEFAULT_MODEL;
}

export function transcribeModel(env) {
  return env.GEMINI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL;
}

export function isDedicatedTranscriber(model) {
  return /transcribe/i.test(model);
}

export async function geminiInteraction({
  apiKey,
  model,
  input,
  systemInstruction,
  responseSchema,
  thinkingLevel,
  transcriptionConfig,
}) {
  const generationConfig = {};
  if (thinkingLevel) generationConfig.thinking_level = thinkingLevel;
  if (transcriptionConfig) generationConfig.transcription_config = transcriptionConfig;
  const body = {
    model,
    input,
    system_instruction: systemInstruction,
  };
  if (Object.keys(generationConfig).length) body.generation_config = generationConfig;
  if (responseSchema) {
    body.response_format = {
      type: "text",
      mime_type: "application/json",
      schema: responseSchema,
    };
  }
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "Api-Revision": "2026-05-20",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`gemini ${response.status}`);
  }
  return response.json();
}

export function extractOutputText(payload) {
  if (!payload) return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (typeof payload.outputText === "string") return payload.outputText;
  const chunks = [];
  for (const step of payload.steps || []) {
    const content = step.content || step.model_output?.content || [];
    for (const part of content) {
      if (typeof part?.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

export function extractWordAnnotations(payload) {
  const words = [];
  for (const step of payload?.steps || []) {
    const content = step.content || [];
    for (const part of content) {
      for (const annotation of part.annotations || []) {
        if (annotation?.type === "word_info" || annotation?.text) {
          words.push(annotation);
        }
      }
    }
  }
  return words;
}

export function parseModelJson(text) {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型沒有回傳 JSON。");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function transcribeAudio({ env, audioBase64, mimeType, durationMs, prompt }) {
  const model = transcribeModel(env);
  if (isDedicatedTranscriber(model)) {
    const payload = await geminiInteraction({
      apiKey: env.GEMINI_API_KEY,
      model,
      input: [{ type: "audio", data: audioBase64, mime_type: mimeType }],
      transcriptionConfig: {
        language_codes: [],
        mode: { type: "verbatim", timestamp_granularities: ["word"] },
      },
    });
    const transcript = extractOutputText(payload).trim();
    const words = extractWordAnnotations(payload);
    const segments = segmentsFromWords(words);
    const usable = segments.length ? segments : synthesizeSegments(transcript, durationMs);
    return {
      mock: false,
      transcript,
      segments: usable,
      delivery: computeDelivery({ transcript, segments: usable, durationMs }),
      model,
    };
  }
  const payload = await geminiInteraction({
    apiKey: env.GEMINI_API_KEY,
    model,
    systemInstruction: prompt,
    thinkingLevel: "low",
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
    input: [
      { type: "text", text: "請轉寫這段繁體中文面試回答。" },
      { type: "audio", data: audioBase64, mime_type: mimeType },
    ],
  });
  const parsed = parseModelJson(extractOutputText(payload));
  const transcript = String(parsed.transcript || "").trim();
  const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
  return {
    mock: false,
    transcript,
    segments,
    delivery: computeDelivery({ transcript, segments, durationMs }),
    model,
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
