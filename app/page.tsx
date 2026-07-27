import Image from "next/image";
import { fallbackSnapshot } from "../lib/index-engine";
import LiveIndex from "./live-index";

const devnetMint = "ENSG3jHnZM3EgzMb8WZHMg4oQ1hZL8KisuTCx7f8msHt";
const devnetExplorer = `https://explorer.solana.com/address/${devnetMint}?cluster=devnet`;

const methodology = [
  {
    number: "01",
    title: "直近30分を観測",
    body: "Solana上の対象ミームコインについて、主要プールの公開取引を60秒ごとに取得し、30分のローリング窓で集計します。",
  },
  {
    number: "02",
    title: "買い手を重複除外",
    body: "署名ウォレットとトランザクションを重複除外し、短時間の連続取引や極小購入をBot候補として分離します。",
  },
  {
    number: "03",
    title: "購入総額で上位5銘柄",
    body: "買い手が観測された銘柄を30分の購入総額で順位付けします。観測が不足する場合は市場取引量プロキシへ安全に切り替えます。",
  },
  {
    number: "04",
    title: "時価総額で加重",
    body: "採用5銘柄の価格変動を、複数データ源で照合した時価総額の比率で加重し、指数値として公開します。",
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
            <small>Active Buyer Index</small>
          </span>
        </a>
        <div className="nav-links">
          <a href="#index">リアルタイム指数</a>
          <a href="#methodology">算出ルール</a>
          <a href="#launch">トークン方針</a>
        </div>
        <a className="nav-cta" href="/api/index">
          Open API
        </a>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <div className="kicker">
            <span className="live-dot" />
            SOLANA・30 MINUTE ROLLING WINDOW
          </div>
          <h1>
            人気ではなく、
            <br />
            <em>実際の買い</em>を見る。
          </h1>
          <p className="hero-lede">
            MT5は、直近30分の推定アクティブ買い手と購入総額からSolanaミームコイン5銘柄を選び、
            価格変動を時価総額加重で示す公開研究指数です。
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#index">
              現在の指数を見る <span aria-hidden="true">→</span>
            </a>
            <a className="button secondary" href="#methodology">
              算出ルール
            </a>
          </div>
          <p className="microcopy">
            投資商品ではありません・人物を特定しません・研究用公開データ
          </p>
        </div>

        <div className="hero-visual">
          <div className="image-frame">
            <Image
              src="/mt5-brand.jpeg"
              alt="赤い上昇矢印と棒グラフ"
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
            <strong>60s</strong>
            <span>Public refresh</span>
          </div>
          <div>
            <strong>3+</strong>
            <span>Independent sources</span>
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
            GeckoTerminalの主要プール取引をオンライン集計し、DEX Screener・Jupiter・
            Heliusで価格、時価総額、Mint情報を照合します。
          </p>
        </div>
        <LiveIndex initial={fallbackSnapshot} />
      </section>

      <section className="method-section" id="methodology">
        <div className="shell">
          <div className="method-intro">
            <span className="section-label light">METHODOLOGY 3.1</span>
            <h2>
              ウォレットを数えて、
              <br />
              人物とは言い切らない。
            </h2>
            <p>
              ブロックチェーンから確実に観測できるのは人物ではなく署名ウォレットです。
              MT5はBot候補を除いた数を「推定アクティブ買い手」として表示し、
              観測の網羅性と人物推定の限界を同時に公開します。
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
          <span className="section-label">DATA QUALITY</span>
          <h2>足りないデータは、足りないと表示する。</h2>
          <p>
            主要プールのAPIは直近300取引までです。30分内に300件を超える場合、
            買い手数と購入額は下限値として表示します。外部データ源の停止や価格不一致を検出した場合、
            指数を縮退表示し、指数連動トークンのNAV公開は自動停止します。
          </p>
        </div>
        <div className="risk-list">
          <div>
            <span>01</span>
            <strong>Bot filter</strong>
            <small>高頻度の連続購入と極小取引を推定買い手から除外</small>
          </div>
          <div>
            <span>02</span>
            <strong>Coverage flag</strong>
            <small>30分を網羅できない銘柄を下限値として明示</small>
          </div>
          <div>
            <span>03</span>
            <strong>Market-cap weight</strong>
            <small>採用後の指数変動は検証済み時価総額比率で加重</small>
          </div>
        </div>
      </section>

      <section className="closing" id="launch">
        <div className="shell closing-inner">
          <div>
            <span className="section-label light">MAINNET RELEASE GATE</span>
            <h2>指数はオンライン。資産発行は安全条件がそろうまで停止。</h2>
            <p>
              現在のMT5Rは無価値の研究用Devnetトークンです。価格合意、人物推定、
              カストディ、監査、法務確認がすべて完了するまで、Mainnet発行や入金は行いません。
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
            <small>Active Buyer Index</small>
          </span>
        </div>
        <p>
          MT5は研究用プロトタイプです。暗号資産・金融商品・投資助言・価値保証・
          保管・送金・トークン販売を提供するものではありません。
        </p>
        <span>© 2026 MT5 Research</span>
      </footer>
    </main>
  );
}
