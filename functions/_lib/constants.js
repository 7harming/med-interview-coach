export const DEFAULT_MODEL = "gemini-3.8-flash";
export const DEFAULT_TRANSCRIBE_MODEL = "gemini-3.8-flash";

export const MAX_AUDIO_MS = 180_000;
export const MIN_AUDIO_MS = 800;
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
export const MAX_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
export const MAX_TEXT_CHARS = 2_000;
export const MAX_TURN_CHARS = 4_000;
export const MAX_TOTAL_CHARS = 20_000;
export const MAX_ITEMS = 6;
export const MAX_STUDENT_TURNS = 3;

export const FOLLOW_UP_MAX = {
  single: 2,
  traditional: 1,
  mmi: 1,
};

export const RATE_RULES = {
  transcribe: { limit: 20, windowMs: 60 * 60 * 1000 },
  interview: { limit: 40, windowMs: 60 * 60 * 1000 },
  coach: { limit: 12, windowMs: 60 * 60 * 1000 },
};

export const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/ogg",
  "audio/opus",
  "audio/aac",
  "audio/m4a",
  "audio/x-m4a",
  "audio/flac",
]);

export const DISCLAIMER =
  "這是練習回饋，不是錄取預測。它只反映這一次練習的逐字稿，不代表任何醫學系的評分或錄取結果。";

export const PRACTICE_AUDIO_NOTE =
  "正式 MMI 作答常常是五到七分鐘。為了避免長音檔造成費用與濫用，這個練習每次錄音最長三分鐘。";
