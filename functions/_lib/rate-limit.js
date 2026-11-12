import { RATE_RULES } from "./constants.js";

const memory = new Map();

export function resetRateLimitMemory() {
  memory.clear();
}

export async function hashIp(ip) {
  const data = new TextEncoder().encode(`med-interview-v1|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function memoryStore() {
  return {
    kind: "memory",
    async get(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    async put(key, value) {
      memory.set(key, value);
    },
  };
}

export function kvStore(kv) {
  return {
    kind: "kv",
    async get(key) {
      return kv.get(key);
    },
    async put(key, value) {
      await kv.put(key, value, { expirationTtl: 60 * 60 * 2 });
    },
  };
}

export function storeForEnv(env) {
  if (env?.RATE_LIMIT_KV) return kvStore(env.RATE_LIMIT_KV);
  return memoryStore();
}

export async function consumeRateLimit(store, key, rule, now = Date.now()) {
  const raw = await store.get(key);
  let bucket = null;
  if (raw) {
    try {
      bucket = JSON.parse(raw);
    } catch {
      bucket = null;
    }
  }
  if (!bucket || typeof bucket.start !== "number" || now - bucket.start >= rule.windowMs) {
    bucket = { start: now, count: 0 };
  }
  bucket.count += 1;
  await store.put(key, JSON.stringify(bucket));
  const allowed = bucket.count <= rule.limit;
  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - bucket.count),
    retryAfterMs: Math.max(0, rule.windowMs - (now - bucket.start)),
    count: bucket.count,
  };
}

export async function enforceRateLimit(env, ip, bucketName, now = Date.now()) {
  const rule = RATE_RULES[bucketName];
  if (!rule) throw new Error(`unknown rate bucket ${bucketName}`);
  const store = storeForEnv(env);
  const key = `rl:${bucketName}:${await hashIp(ip)}`;
  const result = await consumeRateLimit(store, key, rule, now);
  return { ...result, backend: store.kind };
}
