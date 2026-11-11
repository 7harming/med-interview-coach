import { DISCLAIMER } from "./constants.js";
import { rubric } from "./bank.js";
import { aggregateDelivery, computeDelivery, synthesizeSegments } from "./delivery.js";

const BANNED_INTERVIEWER = /很好|不錯|很棒|加油|優秀|標準答案|建議你|你可以說|示範答案|滿分|一定會錄取|如果是我|稱讚|回答得/;

export function studentTranscript(items) {
  return items
    .flatMap((item) => item.turns.filter((turn) => turn.role === "student").map((turn) => turn.text))
    .join("\n");
}

export function deliveryFromTurns(turns) {
  const parts = turns
    .filter((turn) => turn.role === "student")
    .map((turn) => {
      const durationMs = Number(turn.delivery?.durationMs);
      const segments = Array.isArray(turn.delivery?.segments) && turn.delivery.segments.length
        ? turn.delivery.segments
        : synthesizeSegments(turn.text, Number.isFinite(durationMs) ? durationMs : Math.max(turn.text.length * 280, 1_000));
      return computeDelivery({
        transcript: turn.text,
        segments,
        durationMs: Number.isFinite(durationMs) ? durationMs : null,
      });
    });
  return aggregateDelivery(parts);
}

export function deliveryForItems(items) {
  return deliveryFromTurns(items.flatMap((item) => item.turns));
}

export function pickFollowUp(question, turns) {
  const used = turns.filter((turn) => turn.role === "interviewer").map((turn) => turn.text).join("\n");
  const unused = question.followUps.find((item) => !used.includes(item.slice(0, 8)));
  return ensureQuestion(unused || question.followUps[0]);
}

export function sanitizeInterviewerQuestion(questionText, context) {
  const text = String(questionText || "").replace(/\s+/g, " ").trim();
  const fallback = pickFollowUp(context.question, context.turns);
  if (!text || text.length > 180 || !/[？?]$/.test(text) || BANNED_INTERVIEWER.test(text)) return fallback;
  return text;
}

export function sanitizeReflection(questionText, items) {
  const text = String(questionText || "").replace(/\s+/g, " ").trim();
  const fallback = fallbackReflection(items);
  if (!text || text.length > 140 || !/[？?]$/.test(text) || BANNED_INTERVIEWER.test(text) || /分數|標準答案|建議你/.test(text)) {
    return fallback;
  }
  return text;
}

export function fallbackReflection(items) {
  const compact = studentTranscript(items).replace(/\s+/g, "");
  const snippet = compact.slice(0, 18) || "這段回答";
  return `你剛剛說「${snippet}」。你覺得教授聽到這句會追問什麼？`;
}

export function normalizeReport(raw, { transcript, delivery }) {
  const source = raw && typeof raw === "object" ? raw : {};
  const byId = new Map((source.dimensions || []).map((dimension) => [dimension.id, dimension]));
  const dimensions = rubric.dimensions.map((dimension) => {
    const found = byId.get(dimension.id) || {};
    const evidence = unique(asArray(found.evidence).map((item) => String(item).trim()).filter((item) => item.length >= 2 && transcript.includes(item)));
    let score = found.score == null || found.score === "" ? null : Number(found.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) score = null;
    if (score != null && evidence.length === 0) score = null;
    const comment = scrubComment(found.comment, transcript);
    return {
      id: dimension.id,
      name: dimension.name,
      score,
      evidence,
      comment: score == null && evidence.length === 0 ? "這次逐字稿沒有足夠內容，不給分。" : comment || "沒有額外說明。",
    };
  });
  const trapsHit = asArray(source.trapsHit)
    .map((trap) => {
      const evidence = String(trap?.evidence || "").trim();
      return {
        trap: String(trap?.trap || "").trim().slice(0, 160),
        evidence: evidence && transcript.includes(evidence) ? evidence : "",
      };
    })
    .filter((trap) => trap.trap)
    .slice(0, 6);
  return {
    mock: false,
    disclaimer: DISCLAIMER,
    overall: scrubComment(source.overall, transcript).slice(0, 500) || "這次沒有形成可用的總評。",
    dimensions,
    strengths: asArray(source.strengths).map((item) => scrubComment(item, transcript)).filter(Boolean).slice(0, 4),
    weaknesses: asArray(source.weaknesses).map((item) => scrubComment(item, transcript)).filter(Boolean).slice(0, 4),
    trapsHit,
    improvement: scrubComment(source.improvement, transcript).slice(0, 400),
    betterStructure: String(source.betterStructure || "").trim().slice(0, 400),
    delivery,
    deliveryComment: String(source.deliveryComment || "").replace(/[0-9]+/g, "").trim().slice(0, 300) || delivery.notes,
  };
}

function scrubComment(value, transcript) {
  return String(value || "")
    .replace(/「([^」]{2,})」/g, (all, inner) => (transcript.includes(inner) ? all : ""))
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values)];
}

function ensureQuestion(text) {
  const trimmed = String(text || "").trim();
  return /[？?]$/.test(trimmed) ? trimmed : `${trimmed}？`;
}
