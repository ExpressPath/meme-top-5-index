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

test("renders the MT5 public index page without mojibake", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>MT5 — Active Buyer Meme Index<\/title>/i);
  assert.match(html, /人気ではなく、/);
  assert.match(html, /現在のトップ5/);
  assert.match(html, /推定アクティブ買い手/);
  assert.match(html, /Mainnet発行や入金は行いません/);
  assert.match(html, /ENSG3jHnZM3EgzMb8WZHMg4oQ1hZL8KisuTCx7f8msHt/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
  assert.doesNotMatch(html, /繧|縺|螟/);
});

test("serves the public index API with demand coverage fields", async () => {
  const response = await render("/api/index");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.symbol, "MT5");
  assert.equal(typeof body.isLive, "boolean");
  assert.match(
    body.dataMode,
    /^(live-human-estimate|live-wallet-observation|live-market-proxy|fallback)$/,
  );
  assert.equal(body.constituents.length, 5);
  assert.equal(body.methodologyVersion, "3.1");
  assert.match(body.publication.state, /^(publishable|degraded|halted)$/);
  assert.equal(typeof body.publication.tokenNavEligible, "boolean");
  assert.equal(
    typeof body.publication.demandObservedConstituents,
    "number",
  );
  assert.equal(typeof body.publication.completeDemandConstituents, "number");
  assert.equal(Array.isArray(body.dataSources), true);
  for (const coin of body.constituents) {
    assert.equal("observedBuyerWallets" in coin, true);
    assert.equal("demandCoverageComplete" in coin, true);
  }
});
