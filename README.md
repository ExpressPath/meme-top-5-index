# MT5 — Human Demand Meme Index

直近30分で多くの**推定ユニーク購入者**が買った総額の大きいSolanaミームコイン5銘柄を選び、価格変動をリアルタイム時価総額加重で示す研究指数です。

公開サイト: <https://meme-top-5-index.provf-official.chatgpt.site>

## Methodology 3.0

1. Solana上の対象銘柄について30分ローリング窓の買いを集計
   - 動的候補はDEX Screenerの公開プロフィール／ブーストとGeckoTerminalのSolanaトレンドの両方に現れた銘柄だけを採用候補に追加
2. 高頻度Botを除外
3. 資金源と取引パターンなど複数信号が一致した場合だけウォレットを同一ユーザー候補へ統合
4. 推定ユーザー25以上、流動性25万USD以上、時価総額100万USD以上、同一性信頼度65%以上を要求
5. 1推定ユーザー当たり10,000 USDでランキング寄与を上限処理
6. 有効買い総額の上位5銘柄を採用
7. DEX ScreenerとGeckoTerminalの価格差が5%以内であることを要求
8. 採用銘柄の価格変動を検証済み時価総額比率で加重平均
9. ソース合意・人物推定・鮮度のいずれかが欠けた場合はトークンNAV公開を停止

オンチェーンだけで人間を完全に識別することはできません。MT5はウォレット数をユーザー数として表示せず、推定方法・信頼度・未接続状態をAPIと画面で公開します。

## Data network

- DEX Screener（キー不要）: 価格、時価総額、流動性、候補探索
- GeckoTerminal（キー不要）: 独立価格照合、流動性、購入ウォレット集計
- Birdeye Standard REST（無料枠）: 取引標本、署名者、Bot判定の研究入力
- Helius（任意）: 資金源・トランザクション解析用の拡張ポイント
- D1: 正規化取引とクラスタ結果の30分集計

無料のBirdeye Standard枠ではWebSocketを前提にせず、日次リクエスト予算内でREST取得します。ウォレット観測だけでは人物を断定せず、人物推定が基準未達ならランキングを `market proxy`、トークンNAVを `gated` と明示します。

公開ポリシー:

- <https://meme-top-5-index.provf-official.chatgpt.site/data-sources.json>
- <https://meme-top-5-index.provf-official.chatgpt.site/index-methodology.json>

## Development

```bash
npm install
npm run dev
npm test
```

## Collector

`.env.example` の値を環境変数として設定し、以下を常駐実行します。既定の収集器はHelius無料プランで利用できる標準WebSocketを使い、RPC照会を1分20件・1日20,000件以下に制限します。

```bash
npm run collector
```

Birdeye Standard RESTを併用する場合:

```bash
npm run collector:birdeye
```

どちらの無料収集器もウォレット観測の信頼度を40%に固定し、人物推定として採用しません。資金源グラフ等で65%以上の同一性信頼度を付与する別工程が必要です。

## Devnet research token

`MT5R` は固定供給10億、追加発行不可、凍結権限なしのToken-2022テストトークンです。メインネット資産、指数持分、償還請求権ではありません。

Devnet Mint: [`ENSG3jHnZM3EgzMb8WZHMg4oQ1hZL8KisuTCx7f8msHt`](https://explorer.solana.com/address/ENSG3jHnZM3EgzMb8WZHMg4oQ1hZL8KisuTCx7f8msHt?cluster=devnet)

オンチェーン検証済み:

- 供給量: 1,000,000,000 MT5R（6 decimals）
- Mint authority: revoked
- Freeze authority: none
- Metadata update authority: revoked
- Metadata pointer authority: revoked

```bash
npm run token:devnet
npm run token:mainnet:check
```

`token:mainnet:check` は、法的確認、登録事業者との連携、カストディ、監査、マルチシグ、2署名オラクル、30日間のシャドー運用、明示承認が揃うまで必ず失敗します。固定供給トークンは指数へ自動連動しないため、本番案は裏付け資産を持ち作成・償還できるバスケット保管型です。

## Disclaimer

MT5は研究用プロトタイプです。暗号資産、金融商品、投資助言、価値保証、保管、償還、トークン販売を提供しません。
