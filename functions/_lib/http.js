export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function clientIp(request) {
  // Cloudflare sets CF-Connecting-IP to the visitor that connected to this
  // request. When drcharming.net proxies /interview/*, that function must copy
  // the visitor's CF-Connecting-IP onto the upstream request. A browser-supplied
  // X-Forwarded-For cannot override it.
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf && cf.trim()) return cf.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
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
