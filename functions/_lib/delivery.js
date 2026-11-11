const FILLERS = ["那個", "就是", "然後", "嗯", "呃", "啊"];

export function computeDelivery({ transcript = "", segments = [], durationMs = null } = {}) {
  const text = String(transcript || "");
  const fillerCounts = {};
  for (const filler of FILLERS) {
    const matches = text.match(new RegExp(filler, "g"));
    if (matches?.length) fillerCounts[filler] = matches.length;
  }
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length || 0;
  const words = text.match(/[A-Za-z0-9]+/g)?.length || 0;
  const unitCount = cjk + words;
  const cleanSegments = (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      startMs: numberOrNull(segment.startMs),
      endMs: numberOrNull(segment.endMs),
      text: String(segment.text || ""),
    }))
    .filter((segment) => segment.startMs != null && segment.endMs != null && segment.endMs >= segment.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  let span = numberOrNull(durationMs);
  if (span == null && cleanSegments.length) {
    span = cleanSegments[cleanSegments.length - 1].endMs - cleanSegments[0].startMs;
  }
  const speechRateCharsPerMin = span > 0 ? Math.round(unitCount / (span / 60_000)) : null;
  const longPauses = [];
  for (let index = 1; index < cleanSegments.length; index += 1) {
    const gapMs = cleanSegments[index].startMs - cleanSegments[index - 1].endMs;
    if (gapMs >= 1_500) {
      longPauses.push({ afterMs: cleanSegments[index - 1].endMs, gapMs });
    }
  }
  const delivery = {
    speechRateCharsPerMin,
    fillerCounts,
    longPauses,
    durationMs: span,
    unitCount,
  };
  return { ...delivery, notes: describeDelivery(delivery) };
}

export function describeDelivery(delivery) {
  const parts = [];
  const rate = delivery.speechRateCharsPerMin;
  if (rate == null) {
    parts.push("沒有足夠的時間資訊，無法估算語速。");
  } else if (rate < 120) {
    parts.push(`語速約每分鐘 ${rate} 字，偏慢，重點會被等很久。`);
  } else if (rate > 280) {
    parts.push(`語速約每分鐘 ${rate} 字，偏快，句子容易黏在一起。`);
  } else {
    parts.push(`語速約每分鐘 ${rate} 字，落在一般口語範圍。`);
  }
  const fillers = Object.entries(delivery.fillerCounts || {});
  if (fillers.length) {
    const list = fillers.map(([word, count]) => `${word} ${count} 次`).join("、");
    parts.push(`語助詞是字面統計，可能含非填充用法：${list}。`);
  } else {
    parts.push("逐字稿裡沒有數到常見語助詞（嗯、那個、就是、然後、呃、啊）。");
  }
  const pauses = delivery.longPauses?.length || 0;
  if (pauses) {
    parts.push(`分段時間戳之間有 ${pauses} 次超過 1.5 秒的間隔。`);
  } else {
    parts.push("分段時間戳之間沒有超過 1.5 秒的間隔。若整段只有一個時間戳，長停頓可能沒有被分開。");
  }
  return parts.join("");
}

export function synthesizeSegments(transcript, durationMs) {
  const text = String(transcript || "").trim();
  const duration = Math.max(durationMs || Math.max(text.length, 1) * 300, 1);
  if (!text) return [];
  const parts = text.split(/(?<=[。！？!?])/).map((part) => part.trim()).filter(Boolean);
  const chunks = parts.length ? parts : [text];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
  let cursor = 0;
  return chunks.map((chunk) => {
    const slice = Math.max(Math.round((chunk.length / total) * duration), 1);
    const startMs = cursor;
    const endMs = Math.min(duration, cursor + slice);
    cursor = endMs;
    return { startMs, endMs, text: chunk };
  });
}

export function aggregateDelivery(parts) {
  let unitCount = 0;
  let durationMs = 0;
  const fillerCounts = {};
  const longPauses = [];
  for (const part of parts) {
    unitCount += part.unitCount || 0;
    durationMs += part.durationMs || 0;
    for (const [word, count] of Object.entries(part.fillerCounts || {})) {
      fillerCounts[word] = (fillerCounts[word] || 0) + count;
    }
    longPauses.push(...(part.longPauses || []));
  }
  const delivery = {
    speechRateCharsPerMin: durationMs > 0 ? Math.round(unitCount / (durationMs / 60_000)) : null,
    fillerCounts,
    longPauses,
    durationMs: durationMs || null,
    unitCount,
  };
  return { ...delivery, notes: describeDelivery(delivery) };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseOffsetToMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000 ? Math.round(value * 1_000) : Math.round(value);
  }
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([0-9]*\.?[0-9]+)\s*(ms|s)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2]?.toLowerCase() === "ms" ? Math.round(amount) : Math.round(amount * 1_000);
}

export function segmentsFromWords(words) {
  const parsed = (words || [])
    .map((word) => ({
      text: String(word.text || "").trim(),
      startMs: parseOffsetToMs(word.start_offset ?? word.startOffset),
      endMs: parseOffsetToMs(word.end_offset ?? word.endOffset),
    }))
    .filter((word) => word.text && word.startMs != null && word.endMs != null);
  if (!parsed.length) return [];
  const groups = [];
  let current = { ...parsed[0], text: parsed[0].text };
  for (let index = 1; index < parsed.length; index += 1) {
    const word = parsed[index];
    const gap = word.startMs - current.endMs;
    if (gap >= 700 || current.text.length >= 40) {
      groups.push({ startMs: current.startMs, endMs: current.endMs, text: current.text });
      current = { ...word };
    } else {
      current.text += word.text;
      current.endMs = word.endMs;
    }
  }
  groups.push({ startMs: current.startMs, endMs: current.endMs, text: current.text });
  return groups;
}
