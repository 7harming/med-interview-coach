import {
  ALLOWED_AUDIO_TYPES,
  FOLLOW_UP_MAX,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MS,
  MAX_BASE64_CHARS,
  MAX_ITEMS,
  MAX_STUDENT_TURNS,
  MAX_TEXT_CHARS,
  MAX_TOTAL_CHARS,
  MAX_TURN_CHARS,
  MIN_AUDIO_MS,
} from "./constants.js";
import { getQuestion } from "./bank.js";

export function normalizeMime(mime) {
  return String(mime || "").split(";")[0].trim().toLowerCase();
}

export function stripDataUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/^data:[^,]+,(.+)$/s);
  return (match ? match[1] : text).replace(/\s/g, "");
}

export function decodedByteLength(base64) {
  const clean = stripDataUrl(base64);
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) return null;
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

export function validateAudioBody(body) {
  if (!body || typeof body !== "object") return fail("內容格式不對。");
  if (body.text != null && body.audioBase64) return fail("請只選擇錄音或文字其中一種。");
  if (typeof body.text === "string") {
    const text = body.text.trim();
    if (!text) return fail("文字回答是空的。");
    if (text.length > MAX_TEXT_CHARS) return fail("文字回答太長。");
    return { mode: "text", text };
  }
  const durationMs = Number(body.durationMs);
  if (!Number.isFinite(durationMs)) return fail("缺少錄音長度。");
  if (durationMs > MAX_AUDIO_MS) return fail("單次回答請勿超過三分鐘。", 413);
  if (durationMs < MIN_AUDIO_MS) return fail("錄音太短。");
  const mimeType = normalizeMime(body.mimeType);
  if (!ALLOWED_AUDIO_TYPES.has(mimeType)) return fail("不支援這個音檔格式。");
  const audioBase64 = stripDataUrl(body.audioBase64);
  if (!audioBase64) return fail("沒有收到音檔。");
  if (audioBase64.length > MAX_BASE64_CHARS) {
    return fail("音檔太大。請控制在三分鐘以內。", 413);
  }
  const bytes = decodedByteLength(audioBase64);
  if (bytes == null) return fail("音檔編碼不是有效的 base64。");
  if (bytes > MAX_AUDIO_BYTES) return fail("音檔太大。請控制在三分鐘以內。", 413);
  if (bytes < 32) return fail("音檔太短或是空的。");
  return { mode: "audio", audioBase64, mimeType, durationMs };
}

export function validateTurns(turns, { requireStudent = true } = {}) {
  if (!Array.isArray(turns) || turns.length === 0) return fail("缺少對話內容。");
  if (turns.length > 8) return fail("對話回合過多。");
  let total = 0;
  const clean = [];
  for (const turn of turns) {
    if (!turn || (turn.role !== "student" && turn.role !== "interviewer")) return fail("對話角色不正確。");
    if (typeof turn.text !== "string") return fail("對話內容不正確。");
    const text = turn.text.trim();
    if (!text) return fail("有一段對話是空的。");
    if (text.length > MAX_TURN_CHARS) return fail("有一段回答太長。");
    total += text.length;
    const cleaned = {
      role: turn.role,
      text,
      kind: turn.kind === "follow_up" || turn.kind === "stem" ? turn.kind : undefined,
    };
    if (turn.role === "student" && turn.delivery && typeof turn.delivery === "object") {
      const durationMs = Number(turn.delivery.durationMs);
      const segments = Array.isArray(turn.delivery.segments)
        ? turn.delivery.segments.slice(0, 80).map((segment) => ({
          startMs: Number(segment.startMs),
          endMs: Number(segment.endMs),
          text: String(segment.text || "").slice(0, 500),
        })).filter((segment) => Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs))
        : [];
      cleaned.delivery = {
        durationMs: Number.isFinite(durationMs) ? durationMs : null,
        segments,
      };
    }
    clean.push(cleaned);
  }
  if (total > MAX_TOTAL_CHARS) return fail("整段練習的文字太長。");
  const studentTurns = clean.filter((turn) => turn.role === "student");
  if (requireStudent && studentTurns.length === 0) return fail("還沒有學生的回答。");
  if (studentTurns.length > MAX_STUDENT_TURNS) return fail("追問次數已達上限。");
  return { turns: clean, studentTurns };
}

export function validateInterviewBody(body) {
  if (!body || typeof body !== "object") return fail("內容格式不對。");
  if (!FOLLOW_UP_MAX[body.mode]) return fail("練習模式不正確。");
  const question = getQuestion(body.questionId);
  if (!question) return fail("找不到這題。", 404);
  const parsed = validateTurns(body.turns);
  if (parsed.error) return parsed;
  const followUpsUsed = parsed.turns.filter((turn) => turn.role === "interviewer" && turn.kind === "follow_up").length;
  const followUpsRemaining = Math.max(0, FOLLOW_UP_MAX[body.mode] - followUpsUsed);
  if (parsed.studentTurns.length > followUpsUsed + 1) return fail("回答與追問的順序不正確。");
  return { mode: body.mode, question, turns: parsed.turns, followUpsRemaining, followUpsUsed };
}

export function validateCoachBody(body) {
  if (!body || typeof body !== "object") return fail("內容格式不對。");
  if (body.stage !== "reflect" && body.stage !== "report") return fail("回饋階段不正確。");
  if (!FOLLOW_UP_MAX[body.mode]) return fail("練習模式不正確。");
  if (!Array.isArray(body.items) || body.items.length === 0) return fail("沒有可回饋的回答。");
  if (body.items.length > MAX_ITEMS) return fail("一次練習的題數過多。");
  let total = 0;
  const items = [];
  for (const item of body.items) {
    const question = getQuestion(item?.questionId);
    if (!question) return fail("有一題不在題庫裡。", 404);
    const parsed = validateTurns(item.turns);
    if (parsed.error) return parsed;
    total += parsed.turns.reduce((sum, turn) => sum + turn.text.length, 0);
    items.push({ question, turns: parsed.turns });
  }
  if (total > MAX_TOTAL_CHARS) return fail("整段練習的文字太長。");
  const reflectionAnswer = typeof body.reflectionAnswer === "string" ? body.reflectionAnswer.trim().slice(0, 1_000) : "";
  return { stage: body.stage, mode: body.mode, items, reflectionAnswer };
}

function fail(error, status = 400) {
  return { error, status };
}
