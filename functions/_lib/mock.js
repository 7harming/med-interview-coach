import { computeDelivery, synthesizeSegments } from "./delivery.js";
import { DISCLAIMER } from "./constants.js";
import { rubric } from "./bank.js";

const CANNED = {
  "動機與志向": "嗯，我想讀醫學系，是因為高二陪家人看診時，那位醫師在說明選擇之前先停下來問我們哪裡沒聽懂。就是那次讓我覺得，我想做的是把選擇講清楚，而不是因為分數剛好夠。我知道訓練階段會常常睡不夠。如果只是想要穩定收入，我應該去找別的工作。",
  "自我認識": "我不太會在當下承認自己生氣。上次社團討論，我那個，先是沉默，回家才發現自己是在生氣別人沒照我的做法。後來我改成先講我在意的那一件事，而不是等別人來猜。",
  "學習歷程延伸": "我在服務時原本一直想把流程做完。有一次對方其實是想先問下一班車，我卻一直說明活動內容。我後來發現自己把人當成待完成的任務。下次我會先問他現在要處理什麼。",
  "醫學倫理": "我不會直接選邊。病人如果意識清楚，應該先聽本人。家屬的照顧負擔是真的，但是不能取代他的意願。我還缺的資訊是：他聽懂的是哪一部分，以及團隊有沒有用他聽得懂的話問過。",
  "時事與醫療政策": "我先不把圖上的差距當成單一原因。收入和餘命一起變動，可能夾著工作、就醫時間和生活條件。健保處理得到付錢這一段，處理不到全部的生活條件。若只說全部免費，我沒有說明錢要從哪裡來。",
  "情境/溝通": "我會先把規則講清楚，也先承認他在趕時間。後面已經在等的人也請了假。如果對方是有權勢的家屬，我不想改變順序。真的有安全問題，我會請現場負責人判斷，而不是自己通融。",
  "團隊合作": "我不會先認定他不負責任。我會先問他是不會、太忙，還是不想做。其他組員已經在生氣，我會請他們先不要公開批評。若他願意做，我們就把剩下的工作切成他做得到的一小段。",
  "邏輯思辨": "我不能直接說人力少所以品質差。住院天數比較長，也可能是病人年紀、轉院距離或出院後沒有人照顧。我還需要疾病嚴重度，以及這兩個地區是不是在收同一種病人。",
};

export function mockTranscript(question, audio) {
  const transcript = CANNED[question?.category] || CANNED["自我認識"];
  const durationMs = audio?.durationMs || 48_000;
  const pieces = transcript.split("。").filter(Boolean);
  const first = `${pieces[0]}。`;
  const rest = `${pieces.slice(1).join("。")}。`;
  const segments = [
    { startMs: 0, endMs: 8_000, text: first },
    { startMs: 10_400, endMs: Math.min(durationMs, 28_000), text: rest },
  ];
  return {
    mock: true,
    mockAudio: true,
    transcript,
    segments,
    delivery: computeDelivery({ transcript, segments, durationMs }),
    notice: "示範模式沒有辨識這段錄音。上面的逐字稿是預設例句，不是你說的話。",
  };
}

export function transcriptFromText(text, durationMs) {
  const transcript = text.trim();
  const safeDuration = durationMs || Math.max(transcript.length * 280, 1_000);
  const segments = synthesizeSegments(transcript, safeDuration);
  return {
    mock: false,
    mockAudio: false,
    transcript,
    segments,
    delivery: computeDelivery({ transcript, segments, durationMs: safeDuration }),
  };
}

export function mockInterview({ question, turns, followUpsRemaining }) {
  if (followUpsRemaining <= 0) return { decision: "done", question: "", mock: true };
  const studentTurns = turns.filter((turn) => turn.role === "student");
  const last = studentTurns[studentTurns.length - 1]?.text || "";
  const usedText = turns.filter((turn) => turn.role === "interviewer").map((turn) => turn.text).join("\n");
  const unused = question.followUps.filter((item) => !usedText.includes(item.slice(0, 10)));
  const probe = unused[0] || question.followUps[0];
  const challenge = unused[unused.length - 1] || probe;
  if (last.trim().length < 20) return { decision: "follow_up", question: probe, mock: true };
  if (studentTurns.length === 1) return { decision: "follow_up", question: probe, mock: true };
  if (/一定|絕對|完全沒有問題|我沒有缺點|標準答案/.test(last)) {
    return { decision: "follow_up", question: challenge, mock: true };
  }
  return { decision: "done", question: "", mock: true };
}

export function mockReflection(items) {
  const text = items.flatMap((item) => item.turns.filter((turn) => turn.role === "student").map((turn) => turn.text)).join("");
  const snippet = text.replace(/\s+/g, "").slice(0, 18) || "這段回答";
  return {
    mock: true,
    reflectionQuestion: `你剛剛說「${snippet}」。你覺得教授聽到這句，最可能追問的是哪一點？`,
  };
}

export function mockReport({ items, delivery }) {
  const transcript = items
    .flatMap((item) => item.turns.filter((turn) => turn.role === "student").map((turn) => turn.text))
    .join("\n");
  const traps = items.flatMap((item) => item.question.weakTraps);
  const dimensions = rubric.dimensions.map((dimension) => scoreDimension(dimension.id, transcript));
  const trapsHit = detectTraps(transcript, traps);
  const strengths = dimensions.filter((dimension) => dimension.score != null && dimension.score >= 4).map((dimension) => dimension.name);
  const weaknesses = dimensions
    .filter((dimension) => dimension.score == null || dimension.score <= 2)
    .map((dimension) => (dimension.score == null ? `${dimension.name}這次幾乎沒有材料` : `${dimension.name}還停在概括`));
  return {
    mock: true,
    disclaimer: DISCLAIMER,
    overall: overallLine(dimensions, transcript),
    dimensions,
    strengths: strengths.length ? strengths.map((name) => `${name}有具體句子可以對上。`) : ["這次沒有哪一個構面已經穩到可以算強項。"],
    weaknesses: weaknesses.length ? weaknesses : ["沒有單一構面特別低，但多數理由還可以再追問一層。"],
    trapsHit,
    improvement: improvementFor(dimensions),
    betterStructure: "先用一句話點出你要處理的人是誰，再講你的判斷和一個理由，最後補一個會讓你改決定的條件。這是順序，不是講稿。",
    delivery,
    deliveryComment: "以下數字來自逐字稿與時間戳，不是聽覺印象。",
  };
}

function scoreDimension(id, transcript) {
  const name = rubric.dimensions.find((dimension) => dimension.id === id).name;
  const keywords = {
    motive: ["因為", "經驗", "醫師", "辛苦", "收入", "藥學", "社工"],
    logic: ["因為", "原因", "所以", "資料", "另一方面", "不能"],
    stakeholders: ["病人", "家屬", "團隊", "醫師", "社會", "本人"],
    care: ["害怕", "為難", "感受", "安全", "休息", "聽懂"],
    communication: [],
    reflection: ["後來", "發現", "原本", "下次", "盲點", "改"],
    composure: ["不知道", "不確定", "壓力", "先", "若"],
  }[id];
  if (id === "communication") return scoreCommunication(name, transcript);
  const hits = keywords.filter((keyword) => transcript.includes(keyword));
  if (!hits.length) {
    return { id, name, score: null, evidence: [], comment: "這次逐字稿沒有足夠內容，不給分。" };
  }
  const evidence = firstSentence(transcript, hits) || transcript.slice(0, 40);
  let score = 2;
  if (hits.length >= 2 && evidence.length >= 18) score = 3;
  if (hits.length >= 3 && evidence.length >= 28) score = 4;
  return {
    id,
    name,
    score,
    evidence: transcript.includes(evidence) ? [evidence] : [],
    comment: score >= 4 ? "有具體句子，但還可以再講一個限制。" : "有碰到這個構面，理由還不夠穩定。",
  };
}

function scoreCommunication(name, transcript) {
  const evidence = transcript.slice(0, Math.min(40, transcript.length));
  if (!transcript.trim()) return { id: "communication", name, score: null, evidence: [], comment: "沒有逐字稿。" };
  if (transcript.trim().length < 25) {
    return { id: "communication", name, score: 1, evidence: [transcript.trim()], comment: "短到聽不出結構。" };
  }
  if (transcript.length < 80) {
    return { id: "communication", name, score: 2, evidence: [evidence], comment: "有回答，但聽者還要自己補上下文。" };
  }
  const structured = /因為|首先|另一方面|所以/.test(transcript);
  return {
    id: "communication",
    name,
    score: structured ? 4 : 3,
    evidence: [firstSentence(transcript, ["因為", "首先", "我"]) || evidence],
    comment: structured ? "聽得出順序。" : "句子夠長，但重點不夠靠前。",
  };
}

function firstSentence(transcript, keywords) {
  const parts = transcript.split(/(?<=[。！？!?])/).map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => keywords.some((keyword) => part.includes(keyword))) || null;
}

function detectTraps(transcript, traps) {
  const hits = [];
  if (transcript.trim().length < 25) {
    hits.push({ trap: "回答過短，只剩態度或口號", evidence: transcript.trim() });
  }
  if (/想救人|想幫助人|幫助別人/.test(transcript) && !/因為|例如|那次|經驗/.test(transcript)) {
    hits.push({ trap: "動機只剩想幫助人", evidence: matchSnippet(transcript, /想救人|想幫助人|幫助別人/) });
  }
  if (/我會尊重病人/.test(transcript) && !/家屬|團隊|本人/.test(transcript)) {
    hits.push({ trap: "倫理題立刻下結論，沒有看見其他人", evidence: matchSnippet(transcript, /我會尊重病人/) });
  }
  if (/服務時數|小時的志工/.test(transcript)) {
    hits.push({ trap: "服務經驗只報時數", evidence: matchSnippet(transcript, /服務時數|小時的志工/) });
  }
  if (!hits.length && traps.length && /一定|絕對/.test(transcript)) {
    hits.push({ trap: traps[0], evidence: matchSnippet(transcript, /一定|絕對/) });
  }
  return hits.filter((hit) => !hit.evidence || transcript.includes(hit.evidence));
}

function matchSnippet(transcript, pattern) {
  const match = transcript.match(pattern);
  if (!match) return "";
  const start = Math.max(0, match.index - 8);
  return transcript.slice(start, match.index + match[0].length + 12);
}

function overallLine(dimensions, transcript) {
  if (transcript.trim().length < 25) return "這次幾乎還沒有回答。先把一個具體例子說完，再談原則。";
  const low = dimensions.find((dimension) => dimension.score != null && dimension.score <= 2);
  if (low) return `${low.name}是這次最明顯的缺口。有碰到主題，但聽的人還無法追問下去。`;
  const missing = dimensions.filter((dimension) => dimension.score == null).map((dimension) => dimension.name);
  if (missing.length >= 4) return `這次主要只覆蓋到少數構面，${missing.slice(0, 2).join("、")}沒有材料，不另給分數。`;
  return "聽得出你有自己的判斷。接下來要補的是限制：誰付出代價，以及什麼資訊會讓你改口。";
}

function improvementFor(dimensions) {
  const weak = dimensions.find((dimension) => dimension.score != null && dimension.score <= 2) || dimensions.find((dimension) => dimension.score == null);
  if (!weak) return "下一次被追問時，只補一個你剛才沒說的具體條件，不要把整段答案重講。";
  return `下一次先處理「${weak.name}」：用一個你真的遇過或題目裡寫明的人，代替抽象原則。`;
}
