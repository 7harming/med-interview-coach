import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientIp, secretsMatch } from "../functions/_lib/http.js";
import { handleHealth } from "../functions/_lib/handlers.js";
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

test("without the proxy secret, X-Forwarded-For cannot change the rate-limit key", async () => {
  function proxied(cf, forwarded) {
    return new Request("https://med-interview-coach.pages.dev/interview/api/coach", {
      headers: {
        "CF-Connecting-IP": cf,
        "X-Forwarded-For": forwarded,
        "X-Interview-Proxy-Secret": "forged-secret",
      },
    });
  }
  const env = {};
  const first = await enforceRateLimit(env, clientIp(proxied("203.0.113.71", "198.51.100.9"), env), "coach");
  const other = await enforceRateLimit(env, clientIp(proxied("203.0.113.72", "198.51.100.9"), env), "coach");
  const again = await enforceRateLimit(env, clientIp(proxied("203.0.113.71", "203.0.113.99"), env), "coach");
  assert.equal(clientIp(proxied("203.0.113.71", "198.51.100.9"), env), "203.0.113.71");
  assert.equal(first.count, 1);
  assert.equal(other.count, 1);
  assert.equal(again.count, 2);
});

test("a matching proxy secret keys the limit on the first X-Forwarded-For address", async () => {
  const secret = "proxy-secret-value";
  const env = { INTERVIEW_PROXY_SECRET: secret };
  function proxied(cf, forwarded, presented = secret) {
    return new Request("https://med-interview-coach.pages.dev/interview/api/transcribe", {
      headers: {
        "CF-Connecting-IP": cf,
        "X-Forwarded-For": forwarded,
        "X-Interview-Proxy-Secret": presented,
      },
    });
  }
  assert.equal(secretsMatch(secret, secret), true);
  assert.equal(secretsMatch("proxy-secret-valua", secret), false);
  assert.equal(secretsMatch("short", secret), false);
  assert.equal(secretsMatch(secret, ""), false);
  assert.equal(clientIp(proxied("104.16.0.1", "203.0.113.40, 104.16.0.1"), env), "203.0.113.40");
  assert.equal(clientIp(proxied("104.16.0.1", "203.0.113.40", "wrong-secret"), env), "104.16.0.1");
  const visitor = await enforceRateLimit(env, clientIp(proxied("104.16.0.1", "203.0.113.41, 104.16.0.1"), env), "interview");
  const sameEdge = await enforceRateLimit(env, clientIp(proxied("104.16.0.1", "203.0.113.42"), env), "interview");
  const again = await enforceRateLimit(env, clientIp(proxied("104.16.0.2", "203.0.113.41"), env), "interview");
  assert.equal(visitor.count, 1);
  assert.equal(sameEdge.count, 1);
  assert.equal(again.count, 2);
  const response = await handleHealth(proxied("104.16.0.1", "203.0.113.41"), env);
  const body = await response.text();
  assert.equal(response.headers.get("permissions-policy"), "microphone=(self)");
  assert.equal(body.includes(secret), false);
});

test("static responses allow the microphone on this origin", () => {
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /Permissions-Policy:\s*microphone=\(self\)/);
});
