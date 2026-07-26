# MT5 — Human Demand Meme Index

直近30分で多くの**推定ユニーク購入者**が買った総額の大きいSolanaミームコイン5銘柄を選び、価格変動をリアルタイム時価総額加重で示す研究指数です。

公開サイト: <https://meme-top-5-index.provf-official.chatgpt.site>

## Methodology 2.0

1. Solana上の対象銘柄について30分ローリング窓の買いを集計
2. 高頻度Botを除外
3. 資金源と取引パターンなど複数信号が一致した場合だけウォレットを同一ユーザー候補へ統合
4. 推定ユーザー25以上、流動性25万USD以上、時価総額100万USD以上、同一性信頼度65%以上を要求
5. 1推定ユーザー当たり10,000 USDでランキング寄与を上限処理
6. 有効買い総額の上位5銘柄を採用
7. 採用銘柄の価格変動を時価総額比率で加重平均

オンチェーンだけで人間を完全に識別することはできません。MT5はウォレット数をユーザー数として表示せず、推定方法・信頼度・未接続状態をAPIと画面で公開します。

## Data network

- DEX Screener: 価格、時価総額、流動性、候補探索
- Birdeye WebSocket: リアルタイム取引ストリーム
- Helius: 資金源・トランザクション解析用の拡張ポイント
- D1: 正規化取引とクラスタ結果の30分集計

Birdeyeのキーがない状態では、APIは価格層だけをライブ更新し、ランキングを「market proxy」と明示します。

## Development

```bash
npm install
npm run dev
npm test
```

## Collector

`.env.example` の値を環境変数として設定し、以下を常駐実行します。

```bash
npm run collector
```

## Devnet research token

`MT5R` は固定供給10億、追加発行不可、凍結権限なしのToken-2022テストトークンです。メインネット資産、指数持分、償還請求権ではありません。

```bash
npm run token:devnet
```

## Disclaimer

MT5は研究用プロトタイプです。暗号資産、金融商品、投資助言、価値保証、保管、償還、トークン販売を提供しません。
