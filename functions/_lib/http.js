export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
      "permissions-policy": "microphone=(self)",
    },
  });
}

export function secretsMatch(presented, expected) {
  if (typeof expected !== "string" || expected.length === 0 || typeof presented !== "string") return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(presented);
  const right = encoder.encode(expected);
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }
  return diff === 0;
}

function firstForwardedFor(request) {
  const raw = request.headers.get("x-forwarded-for");
  if (!raw) return "";
  return raw.split(",")[0].trim();
}

export function clientIp(request, env) {
  // Direct visitors are keyed by CF-Connecting-IP. X-Forwarded-For is ignored
  // unless the proxy proves itself with INTERVIEW_PROXY_SECRET, because
  // Cloudflare replaces CF-Connecting-IP on subrequests to *.pages.dev.
  const expected = env?.INTERVIEW_PROXY_SECRET;
  const presented = request.headers.get("x-interview-proxy-secret") || "";
  if (secretsMatch(presented, expected)) {
    const forwarded = firstForwardedFor(request);
    if (forwarded) return forwarded;
  }
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf && cf.trim()) return cf.trim();
  return "local";
}

export async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 9_000_000) {
    return { error: "請求太大。單次音檔請短於三分鐘。", status: 413 };
  }
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    return { error: "請用 JSON 傳送。", status: 415 };
  }
  try {
    return { value: await request.json() };
  } catch {
    return { error: "JSON 無法解析。", status: 400 };
  }
}
