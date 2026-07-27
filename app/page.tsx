import Image from "next/image";
import { fallbackSnapshot } from "../lib/index-engine";
import LiveIndex from "./live-index";

const devnetMint = "ENSG3jHnZM3EgzMb8WZHMg4oQ1hZL8KisuTCx7f8msHt";
const devnetExplorer = `https://explorer.solana.com/address/${devnetMint}?cluster=devnet`;

const methodology = [
  {
    number: "01",
    title: "直近30分を集計",
    body: "Solana上のミームコイン売買を継続取得し、買い側のUSD金額を30分のローリング窓で集計します。",
  },
  {
    number: "02",
    title: "ウォレットを人へ寄せる",
    body: "Botを除外し、資金源と取引パターンが一致する場合だけ複数ウォレットを同一クラスタに統合します。",
  },
  {
    number: "03",
    title: "買い総額で上位5",
    body: "推定ユーザー25以上、十分な流動性、信頼度65%以上を満たす銘柄を有効買い総額で順位付けします。",
  },
  {
    number: "04",
    title: "時価総額で加重",
    body: "採用5銘柄の価格変動を、各銘柄の時価総額比率で加重平均し、指数値として15秒ごとに更新します。",
  },
];

export default function Home() {
  return (
    <main>
      <nav className="nav shell" aria-label="メインナビゲーション">
        <a className="brand" href="#top" aria-label="MT5 ホーム">
          <span className="brand-mark">M5</span>
          <span>
            Meme Top 5
            <small>Human Demand Index</small>
          </span>
        </a>
        <div className="nav-links">
          <a href="#index">リアルタイム指数</a>
          <a href="#methodology">算出ルール</a>
          <a href="#launch">トークン</a>
        </div>
        <a className="nav-cta" href="/api/index">
          Open API
        </a>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <div className="kicker">
            <span className="live-dot" />
            SOLANA · 25 SECOND CONSENSUS REFRESH
          </div>
          <h1>
            ウォレットではなく、
            <br />
            <em>人の買いを測る。</em>
          </h1>
          <p className="hero-lede">
            MT5は、直近30分で多くの推定ユーザーが買った総額の大きいミームコイン5銘柄を選び、
            価格変動を独立した2つの市場データ源で照合し、時価総額加重平均で示す研究指数です。
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#index">
              現在の指数を見る <span aria-hidden="true">↓</span>
            </a>
            <a className="button secondary" href="#methodology">
              算出ルール
            </a>
          </div>
          <p className="microcopy">
            投資商品ではありません · ウォレット数をユーザー数とは表示しません · 研究用
          </p>
        </div>

        <div className="hero-visual">
          <div className="image-frame">
            <Image
              src="/mt5-brand.jpeg"
              alt="赤い上向き矢印と上昇する棒グラフ"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 48vw"
            />
          </div>
          <LiveIndex initial={fallbackSnapshot} compact />
        </div>
      </section>

      <section className="stat-strip" aria-label="指数概要">
        <div className="shell stats">
          <div>
            <strong>30m</strong>
            <span>Rolling demand window</span>
          </div>
          <div>
            <strong>5</strong>
            <span>Selected coins</span>
          </div>
          <div>
            <strong>25s</strong>
            <span>Market refresh</span>
          </div>
          <div>
            <strong>Human</strong>
            <span>Identity estimate</span>
          </div>
        </div>
      </section>

      <section className="section shell" id="index">
        <div className="section-heading">
          <div>
            <span className="section-label">LIVE INDEX</span>
            <h2>現在のトップ5</h2>
          </div>
          <p className="section-summary">
            選定は買い総額、値動きは時価総額加重。データの確度も同時に表示します。
          </p>
        </div>
        <LiveIndex initial={fallbackSnapshot} />
      </section>

      <section className="method-section" id="methodology">
        <div className="shell">
          <div className="method-intro">
            <span className="section-label light">METHODOLOGY 3.0</span>
            <h2>
              人気の数ではなく、
              <br />
              買いの広がりを見る。
            </h2>
            <p>
              1人が100個のウォレットで買っても、100人とは数えません。完全な本人確認ではなく、
              オンチェーン上で説明可能な高信頼の推定値として公開します。
            </p>
          </div>
          <div className="method-grid">
            {methodology.map((item) => (
              <article className="method-card" key={item.number}>
                <span>{item.number}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section shell risk-section">
        <div className="risk-copy">
          <span className="section-label">IDENTITY LIMITS</span>
          <h2>「ユーザー数」は推定値。</h2>
          <p>
            ブロックチェーンに人間の身元は記録されません。MT5はBotらしさ、共通資金源、
            同期した売買パターンを使い、証拠が揃った場合だけウォレットを統合します。
            誤統合と見逃しは残るため、信頼度を必ず併記します。
          </p>
        </div>
        <div className="risk-list">
          <div>
            <span>01</span>
            <strong>Bot filter</strong>
            <small>高頻度・機械的な反復売買をランキングから除外</small>
          </div>
          <div>
            <span>02</span>
            <strong>Cluster confidence</strong>
            <small>資金源だけで人を断定せず、複数の一致信号を要求</small>
          </div>
          <div>
            <span>03</span>
            <strong>Market-cap weight</strong>
            <small>採用後の指数変動は時価総額比率で加重平均</small>
          </div>
        </div>
      </section>

      <section className="closing" id="launch">
        <div className="shell closing-inner">
          <div>
            <span className="section-label light">MAINNET RELEASE GATE</span>
            <h2>指数は稼働。Mainnet発行は自動停止中。</h2>
            <p>
              DEX ScreenerとGeckoTerminalの価格合意、人物推定、カストディ、
              監査、法的確認がすべて揃うまでMainnetへの発行と入金を拒否します。
              現在のMT5Rは無価値の研究用Devnetトークンであり、指数持分や償還請求権ではありません。
            </p>
            <code className="mint-address">{devnetMint}</code>
          </div>
          <div className="token-actions">
            <a
              className="button light-button"
              href={devnetExplorer}
              target="_blank"
              rel="noreferrer"
            >
              Solana Explorer
            </a>
            <a className="button token-secondary" href="/token/metadata.json">
              Metadata
            </a>
            <a className="button token-secondary" href="/data-sources.json">
              Data policy
            </a>
          </div>
        </div>
      </section>

      <footer className="footer shell">
        <div className="brand footer-brand">
          <span className="brand-mark">M5</span>
          <span>
            Meme Top 5
            <small>Human Demand Index</small>
          </span>
        </div>
        <p>
          MT5は研究用プロトタイプです。暗号資産、金融商品、投資助言、価値保証、
          保管、償還、トークン販売を提供するものではありません。
        </p>
        <span>© 2026 MT5 Research</span>
      </footer>
    </main>
  );
}
