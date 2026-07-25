# MT5 — Meme Top 5 Index

主要ミームコイン5銘柄を、公開ルールで追跡する研究用インデックスの公式サイトです。

## Product status

- Research preview
- Demo snapshot only
- Not an investment product
- Not investment advice
- No token sale or custody

## Methodology preview

1. Minimum market capitalization: 100M USD
2. Minimum 24-hour volume: 10M USD
3. Select the five largest eligible assets
4. Market-cap weighting with a 30% single-asset cap
5. Publish scheduled and emergency constituent changes

## Development

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Validation

```bash
npm test
npm audit --omit=dev
```

## Disclaimer

MT5 is a research prototype. It does not provide an investment product,
financial advice, price guarantees, custody, redemption, or token sales.
