import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientIp } from "../functions/_lib/http.js";
import { enforceRateLimit } from "../functions/_lib/rate-limit.js";
import { apiUrl, BASE_PATH } from "../public/interview/paths.js";

test("pages and the drcharming.net proxy share the /interview prefix", () => {
  assert.equal(BASE_PATH, "/interview");
  for (const path of ["api/health", "api/questions", "api/transcribe", "api/interview", "api/coach"]) {
    assert.equal(apiUrl(path), `/interview/${path}`);
  }
  const html = readFileSync(new URL("../public/interview/index.html", import.meta.url), "utf8");
  assert.match(html, /<base href="\/interview\/"/);
  assert.equal(html.includes('href="/styles.css"'), false);
  assert.equal(html.includes('src="/app.js"'), false);
  const app = readFileSync(new URL("../public/interview/app.js", import.meta.url), "utf8");
  assert.equal(app.includes('"/api/'), false);
  assert.match(app, /回到「我就怕被罵嘛」/);
  assert.match(app, /https:\/\/drcharming\.net\//);
  const redirects = readFileSync(new URL("../public/_redirects", import.meta.url), "utf8");
  assert.match(redirects, /^\/\s+\/interview\/\s+302/m);
  for (const name of ["health", "questions", "transcribe", "interview", "coach"]) {
    const source = readFileSync(new URL(`../functions/interview/api/${name}.js`, import.meta.url), "utf8");
    assert.match(source, /onRequest/);
  }
});

test("proxied rate limits use CF-Connecting-IP and ignore a spoofed X-Forwarded-For", async () => {
  function proxied(cf, forwarded) {
    return new Request("https://med-interview-coach.pages.dev/interview/api/coach", {
      headers: {
        "CF-Connecting-IP": cf,
        "X-Forwarded-For": forwarded,
      },
    });
  }
  const first = await enforceRateLimit({}, clientIp(proxied("203.0.113.71", "198.51.100.9")), "coach");
  const other = await enforceRateLimit({}, clientIp(proxied("203.0.113.72", "198.51.100.9")), "coach");
  const again = await enforceRateLimit({}, clientIp(proxied("203.0.113.71", "203.0.113.99")), "coach");
  assert.equal(clientIp(proxied("203.0.113.71", "198.51.100.9")), "203.0.113.71");
  assert.equal(first.count, 1);
  assert.equal(other.count, 1);
  assert.equal(again.count, 2);
});
