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
  assert.match(html, /<title>MT5 — Meme Top 5 Index<\/title>/i);
  assert.match(html, /ミーム市場を/);
  assert.match(html, /DOGE/);
  assert.match(html, /算出ルール/);
  assert.match(html, /投資商品ではありません/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("serves the public index API", async () => {
  const response = await render("/api/index");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.symbol, "MT5");
  assert.equal(body.isLive, false);
  assert.equal(body.constituents.length, 5);
});
