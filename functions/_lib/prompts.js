import { DISCLAIMER } from "./constants.js";
import { rubric } from "./bank.js";
import { coach, interviewer, transcribe } from "./prompt-texts.js";

const PROMPTS = { interviewer, coach, transcribe };

export async function loadPrompts() {
  return PROMPTS;
}

export function resetPromptCache() {}

export function fence(text) {
  return String(text ?? "").replaceAll("<", "＜").replaceAll(">", "＞");
}

export function assembleInterviewerPrompt(template, { question, mode, followUpsRemaining, turns }) {
  const directions = question.followUps.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const dialogue = turns
    .map((turn) => `<${turn.role}>\n${fence(turn.text)}\n</${turn.role}>`)
    .join("\n");
  return [
    template.trim(),
    "",
    `模式：${mode}`,
    `還可以追問的次數：${followUpsRemaining}`,
    followUpsRemaining <= 0 ? "不能再追問。decision 必須是 done。" : "若需要追問，只問一個問題。",
    "",
    `類別：${question.category}`,
    "題目：",
    question.prompt,
    question.scenario ? `情境：\n${question.scenario}` : "情境：無",
    "可改寫的追問方向：",
    directions,
    "到目前為止的對話：",
    dialogue || "（尚無）",
  ].join("\n");
}

export function assembleReflectPrompt(template, { items }) {
  return [
    template.trim(),
    "",
    "stage：reflect",
    "下面是學生在練習中說過的話。只出一個反思問題。",
    renderItems(items),
  ].join("\n");
}

export function assembleCoachPrompt(template, { mode, items, delivery, reflectionAnswer }) {
  const levels = rubric.dimensions
    .map((dimension) => {
      const scale = [1, 2, 3, 4, 5].map((score) => `${score} ${dimension.levels[String(score)]}`).join("\n");
      return `【${dimension.id} ${dimension.name}】\n${scale}\n較好：${dimension.goodExample}\n較弱：${dimension.badExample}`;
    })
    .join("\n\n");
  return [
    template.trim(),
    "",
    "stage：report",
    `模式：${mode}`,
    `固定聲明（報告裡必須保留這個意思）：${DISCLAIMER}`,
    "",
    "尺規：",
    levels,
    "",
    "已計算的表達數據（不要改數字）：",
    JSON.stringify(delivery),
    reflectionAnswer ? `學生在看回饋前寫的反思：\n${fence(reflectionAnswer)}` : "學生沒有寫反思。",
    "",
    "練習內容：",
    renderItems(items, true),
  ].join("\n");
}

function renderItems(items, includeTraps = false) {
  return items
    .map((item, index) => {
      const lines = [
        `--- 第 ${index + 1} 題 ${item.question.id} ${item.question.category} ---`,
        `題目：${item.question.prompt}`,
        item.question.scenario ? `情境：${item.question.scenario}` : "情境：無",
      ];
      if (includeTraps) {
        lines.push("這題常見的弱回答：");
        lines.push(item.question.weakTraps.map((trap) => `- ${trap}`).join("\n"));
        lines.push(`較完整的回答會呈現：${item.question.strongAnswer}`);
        lines.push("以上是評分時的對照，不是要你寫進學生嘴裡的句子。");
      }
      lines.push("對話：");
      lines.push(
        item.turns.map((turn) => `<${turn.role}>\n${fence(turn.text)}\n</${turn.role}>`).join("\n"),
      );
      return lines.join("\n");
    })
    .join("\n\n");
}
