import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDelivery, computeDelivery, parseOffsetToMs, segmentsFromWords } from "../functions/_lib/delivery.js";
import { normalizeReport, sanitizeInterviewerQuestion } from "../functions/_lib/report.js";
import { getQuestion } from "../functions/_lib/bank.js";

test("delivery counts fillers, rate, and long gaps", () => {
  const delivery = computeDelivery({
    transcript: "嗯，那個我覺得就是要先問病人。",
    segments: [
      { startMs: 0, endMs: 2000, text: "嗯，那個我覺得" },
      { startMs: 4000, endMs: 6000, text: "就是要先問病人。" },
    ],
    durationMs: 6000,
  });
  assert.equal(delivery.fillerCounts["嗯"], 1);
  assert.equal(delivery.fillerCounts["那個"], 1);
  assert.equal(delivery.fillerCounts["就是"], 1);
  assert.equal(delivery.longPauses.length, 1);
  assert.equal(delivery.longPauses[0].gapMs, 2000);
  assert.ok(delivery.speechRateCharsPerMin > 0);
  assert.match(delivery.notes, /語速約每分鐘/);
});

test("word offsets become segments", () => {
  assert.equal(parseOffsetToMs("1.250s"), 1250);
  const segments = segmentsFromWords([
    { type: "word_info", text: "我會", start_offset: "0.100s", end_offset: "0.400s" },
    { type: "word_info", text: "先問", start_offset: "0.500s", end_offset: "0.800s" },
    { type: "word_info", text: "家屬", start_offset: "2.000s", end_offset: "2.300s" },
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "我會先問");
  assert.equal(segments[1].text, "家屬");
});

test("aggregate delivery sums turns without inventing a pause between them", () => {
  const first = computeDelivery({ transcript: "嗯。", segments: [{ startMs: 0, endMs: 1000, text: "嗯。" }], durationMs: 1000 });
  const second = computeDelivery({ transcript: "家屬在等。", segments: [{ startMs: 0, endMs: 2000, text: "家屬在等。" }], durationMs: 2000 });
  const total = aggregateDelivery([first, second]);
  assert.equal(total.fillerCounts["嗯"], 1);
  assert.equal(total.durationMs, 3000);
  assert.equal(total.longPauses.length, 0);
});

test("interviewer output that praises is replaced by a bank probe", () => {
  const question = getQuestion("q043");
  const turns = [{ role: "interviewer", text: question.prompt }, { role: "student", text: "因為我想救人。" }];
  const cleaned = sanitizeInterviewerQuestion("很好，你可以再說說看標準答案。", { question, turns });
  assert.equal(/很好|標準答案|建議/.test(cleaned), false);
  assert.match(cleaned, /？$/);
  assert.ok(question.followUps.some((item) => cleaned.includes(item.slice(0, 8)) || cleaned === `${item}？` || cleaned === item));
});

test("coach evidence that the student never said is dropped and the score is withheld", () => {
  const transcript = "我高二陪家人看診，醫師有停下來問我們懂不懂。";
  const report = normalizeReport({
    overall: "你說「我想當史懷哲」所以動機很清楚。",
    dimensions: [
      { id: "motive", score: 5, evidence: ["我想當史懷哲"], comment: "你提到「想照顧全村」。" },
      { id: "logic", score: 3, evidence: ["醫師有停下來問我們懂不懂"], comment: "有一個具體畫面。" },
    ],
    strengths: ["動機充分。"],
    weaknesses: [],
    trapsHit: [{ trap: "套語", evidence: "史懷哲" }],
    improvement: "補一個限制。",
    betterStructure: "先場景，再理由。",
    deliveryComment: "語速 999 太快",
  }, { transcript, delivery: { notes: "語速約每分鐘 180 字。", speechRateCharsPerMin: 180, fillerCounts: {}, longPauses: [], durationMs: 1000, unitCount: 3 } });
  const motive = report.dimensions.find((dimension) => dimension.id === "motive");
  const logic = report.dimensions.find((dimension) => dimension.id === "logic");
  assert.equal(motive.score, null);
  assert.deepEqual(motive.evidence, []);
  assert.equal(logic.score, 3);
  assert.equal(logic.evidence[0], "醫師有停下來問我們懂不懂");
  assert.equal(report.overall.includes("史懷哲"), false);
  assert.equal(report.trapsHit[0].evidence, "");
  assert.equal(report.deliveryComment.includes("999"), false);
  assert.match(report.disclaimer, /不是錄取預測/);
});
