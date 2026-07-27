import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the MT5 public index page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>MT5 — Human Demand Meme Index<\/title>/i);
  assert.match(html, /ウォレットではなく/);
  assert.match(html, /TRUMP/);
  assert.match(html, /算出ルール/);
  assert.match(html, /ユーザー数とは表示しません/);
  assert.match(html, /Mainnet発行は自動停止中/);
  assert.match(html, /ENSG3jHnZM3EgzMb8WZHMg4oQ1hZL8KisuTCx7f8msHt/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("serves the public index API", async () => {
  const response = await render("/api/index");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.symbol, "MT5");
  assert.equal(typeof body.isLive, "boolean");
  assert.match(body.dataMode, /^(live-human-estimate|live-market-proxy|fallback)$/);
  assert.equal(body.constituents.length, 5);
  assert.equal(body.methodologyVersion, "3.0");
  assert.match(body.publication.state, /^(publishable|degraded|halted)$/);
  assert.equal(typeof body.publication.tokenNavEligible, "boolean");
  assert.equal(Array.isArray(body.dataSources), true);
});
