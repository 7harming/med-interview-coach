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
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf.trim();
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
