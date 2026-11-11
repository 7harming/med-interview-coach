import questionFile from "../../data/questions.json" with { type: "json" };
import rubricFile from "../../data/rubric.json" with { type: "json" };

export const questionBank = questionFile;
export const rubric = rubricFile;

export const CATEGORIES = [
  "動機與志向",
  "自我認識",
  "學習歷程延伸",
  "醫學倫理",
  "時事與醫療政策",
  "情境/溝通",
  "團隊合作",
  "邏輯思辨",
];

export function getQuestion(id) {
  return questionBank.questions.find((item) => item.id === id) || null;
}

export function toPublicQuestion(question) {
  return {
    id: question.id,
    category: question.category,
    format: question.format,
    difficulty: question.difficulty,
    readingSeconds: question.readingSeconds,
    answerSeconds: question.answerSeconds,
    prompt: question.prompt,
    scenario: question.scenario,
    inspiredBy: question.inspiredBy,
  };
}

export function publicQuestions() {
  return {
    version: questionBank.version,
    locale: questionBank.locale,
    note: questionBank.note,
    questions: questionBank.questions.map(toPublicQuestion),
  };
}
