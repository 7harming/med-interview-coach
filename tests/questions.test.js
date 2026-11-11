import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORIES, publicQuestions, questionBank, rubric } from "../functions/_lib/bank.js";

const questions = questionBank.questions;

test("question bank stays inside the planned size and categories", () => {
  assert.ok(questions.length >= 60 && questions.length <= 80, questions.length);
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  for (const question of questions) counts[question.category] += 1;
  assert.deepEqual(Object.keys(counts).sort(), [...CATEGORIES].sort());
  assert.ok(counts["時事與醫療政策"] >= 14 && counts["時事與醫療政策"] <= 20);
  assert.ok(counts["學習歷程延伸"] >= 7 && counts["學習歷程延伸"] <= 12);
  assert.ok(counts["醫學倫理"] >= 7 && counts["醫學倫理"] <= 12);
  assert.ok(counts["自我認識"] >= 6 && counts["自我認識"] <= 11);
  assert.ok(counts["動機與志向"] >= 6 && counts["動機與志向"] <= 11);
  assert.ok(counts["情境/溝通"] >= 6 && counts["情境/溝通"] <= 12);
  assert.ok(counts["邏輯思辨"] >= 6 && counts["邏輯思辨"] <= 11);
  assert.ok(counts["團隊合作"] >= 4 && counts["團隊合作"] <= 8);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), questions.length);
});

test("every question has the fields a professor prompt needs", () => {
  const ids = new Set();
  for (const question of questions) {
    assert.match(question.id, /^q\d{3}$/);
    assert.equal(ids.has(question.id), false);
    ids.add(question.id);
    assert.ok(["traditional", "mmi"].includes(question.format));
    assert.ok(["easy", "medium", "hard"].includes(question.difficulty));
    assert.equal(typeof question.prompt, "string");
    assert.ok(question.prompt.length >= 20);
    assert.ok(question.scenario === null || typeof question.scenario === "string");
    assert.ok(question.followUps.length >= 2 && question.followUps.length <= 4);
    assert.ok(question.weakTraps.length >= 2 && question.weakTraps.length <= 4);
    assert.ok(question.strongAnswer.length >= 20);
    assert.ok(question.inspiredBy.length >= 1 && question.inspiredBy.length <= 3);
    for (const source of question.inspiredBy) {
      assert.ok(source.school && source.year);
      assert.match(source.url, /^https:\/\/.+/);
    }
    if (question.format === "traditional") assert.equal(question.readingSeconds, 0);
    if (question.format === "mmi") assert.ok(question.readingSeconds >= 30 && question.readingSeconds <= 180);
    assert.ok(question.answerSeconds >= 60 && question.answerSeconds <= 480);
    assert.equal(question.prompt.includes("儒林"), false);
  }
});

test("public question payload hides probes and model answers", () => {
  const payload = JSON.stringify(publicQuestions());
  assert.equal(payload.includes("followUps"), false);
  assert.equal(payload.includes("strongAnswer"), false);
  assert.equal(payload.includes("weakTraps"), false);
  assert.equal(publicQuestions().questions.length, questions.length);
});

test("rubric has seven scored dimensions with five levels", () => {
  assert.equal(rubric.dimensions.length, 7);
  const ids = rubric.dimensions.map((dimension) => dimension.id);
  assert.deepEqual(ids, ["motive", "logic", "stakeholders", "care", "communication", "reflection", "composure"]);
  for (const dimension of rubric.dimensions) {
    for (const score of ["1", "2", "3", "4", "5"]) assert.ok(dimension.levels[score].length > 10);
    assert.ok(dimension.goodExample.length > 10);
    assert.ok(dimension.badExample.length > 10);
    assert.ok(dimension.officialAnchors.length >= 1);
  }
});
