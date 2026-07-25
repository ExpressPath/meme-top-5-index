const snapshot = {
  name: "Meme Top 5 Index",
  symbol: "MT5",
  value: 1000,
  currency: "USD",
  status: "research-preview",
  isLive: false,
  asOf: "2026-07-26",
  constituents: [
    { symbol: "DOGE", weight: 0.3 },
    { symbol: "SHIB", weight: 0.3 },
    { symbol: "PEPE", weight: 0.2582 },
    { symbol: "BONK", weight: 0.0861 },
    { symbol: "FLOKI", weight: 0.0557 },
  ],
  disclaimer:
    "Research preview only. Not an investment product or investment advice.",
};

export async function GET() {
  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
