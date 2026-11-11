import assert from "node:assert/strict";
import test from "node:test";
import { RATE_RULES } from "../functions/_lib/constants.js";
import { handleTranscribe } from "../functions/_lib/handlers.js";
import { consumeRateLimit, hashIp } from "../functions/_lib/rate-limit.js";

test("memory rate limit blocks the next request after the bucket is full", async () => {
  const ip = "203.0.113.80";
  let last = null;
  for (let count = 0; count < RATE_RULES.transcribe.limit + 1; count += 1) {
    const response = await handleTranscribe(new Request("http://local/api/transcribe", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ text: "這是速率限制測試用的短回答，沒有音檔。" }),
    }), {});
    last = { status: response.status, data: await response.json() };
  }
  assert.equal(last.status, 429);
  assert.ok(last.data.retryAfterSeconds > 0);
  assert.equal(JSON.stringify(last.data).includes("短回答"), false);
});

test("kv-shaped store counts without keeping the answer", async () => {
  const saved = new Map();
  const store = {
    async get(key) { return saved.get(key) ?? null; },
    async put(key, value) { saved.set(key, value); },
  };
  const rule = { limit: 2, windowMs: 60_000 };
  const key = `rl:test:${await hashIp("198.51.100.4")}`;
  const first = await consumeRateLimit(store, key, rule, 1_000);
  const second = await consumeRateLimit(store, key, rule, 1_500);
  const third = await consumeRateLimit(store, key, rule, 2_000);
  assert.equal(first.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  const raw = [...saved.values()].join("");
  assert.equal(raw.includes("音檔"), false);
  assert.match(raw, /"count":3/);
});
