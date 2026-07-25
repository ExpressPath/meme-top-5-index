import Image from "next/image";

const constituents = [
  {
    symbol: "DOGE",
    name: "Dogecoin",
    weight: 30,
    marketCap: "$36.0B",
    volume: "$2.1B",
    change: 2.7,
    accent: "#e11d48",
  },
  {
    symbol: "SHIB",
    name: "Shiba Inu",
    weight: 30,
    marketCap: "$8.3B",
    volume: "$340M",
    change: -1.2,
    accent: "#fb7185",
  },
  {
    symbol: "PEPE",
    name: "Pepe",
    weight: 25.82,
    marketCap: "$5.1B",
    volume: "$620M",
    change: 4.1,
    accent: "#be123c",
  },
  {
    symbol: "BONK",
    name: "Bonk",
    weight: 8.61,
    marketCap: "$1.7B",
    volume: "$210M",
    change: 1.4,
    accent: "#fda4af",
  },
  {
    symbol: "FLOKI",
    name: "Floki",
    weight: 5.57,
    marketCap: "$1.1B",
    volume: "$150M",
    change: -0.8,
    accent: "#881337",
  },
];

const methodology = [
  {
    number: "01",
    title: "Liquidity first",
    body: "時価総額1億USD、24時間出来高1,000万USDを最低条件に設定。",
  },
  {
    number: "02",
    title: "Select the leaders",
    body: "適格銘柄を時価総額順に並べ、上位5銘柄だけを採用。",
  },
  {
    number: "03",
    title: "Cap concentration",
    body: "時価総額加重を基本に、1銘柄のウェイトを最大30%に制限。",
  },
  {
    number: "04",
    title: "Rebalance clearly",
    body: "定例見直しと緊急除外の履歴を公開し、指数の変更理由を残す。",
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
            <small>Research Index</small>
          </span>
        </a>
        <div className="nav-links">
          <a href="#constituents">構成</a>
          <a href="#methodology">算出ルール</a>
          <a href="#risk">リスク</a>
        </div>
        <a className="nav-cta" href="#constituents">
          View index
        </a>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <div className="kicker">
            <span className="live-dot" />
            Research preview · MT5
          </div>
          <h1>
            ミーム市場を、
            <br />
            <em>ひとつの指標へ。</em>
          </h1>
          <p className="hero-lede">
            人気ではなく、公開ルールで選ぶ。MT5は流動性と時価総額を基準に、
            主要ミームコイン5銘柄の動きを追う研究用インデックスです。
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#constituents">
              現在の構成を見る
              <span aria-hidden="true">↘</span>
            </a>
            <a className="button secondary" href="#methodology">
              算出ルール
            </a>
          </div>
          <p className="microcopy">投資商品ではありません · 価格保証なし · 研究用</p>
        </div>

        <div className="hero-visual">
          <div className="image-frame">
            <Image
              src="/mt5-brand.jpeg"
              alt="赤い上昇矢印とネイビーの棒グラフ"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 48vw"
            />
          </div>
          <div className="index-float">
            <div className="float-top">
              <span>MT5 / USD</span>
              <span className="preview-pill">DEMO</span>
            </div>
            <strong>1,000.00</strong>
            <div className="float-bottom">
              <span>BASE VALUE</span>
              <span className="positive">Rules-based</span>
            </div>
          </div>
        </div>
      </section>

      <section className="stat-strip" aria-label="指数概要">
        <div className="shell stats">
          <div>
            <strong>5</strong>
            <span>Constituents</span>
          </div>
          <div>
            <strong>30%</strong>
            <span>Single-asset cap</span>
          </div>
          <div>
            <strong>$100M</strong>
            <span>Minimum market cap</span>
          </div>
          <div>
            <strong>Open</strong>
            <span>Published methodology</span>
          </div>
        </div>
      </section>

      <section className="section shell" id="constituents">
        <div className="section-heading">
          <div>
            <span className="section-label">INDEX COMPOSITION</span>
            <h2>現在の構成</h2>
          </div>
          <div className="as-of">
            <span className="status-dot" />
            2026-07-26 · Demo snapshot
          </div>
        </div>

        <div className="index-panel">
          <div className="table-head" aria-hidden="true">
            <span>Asset</span>
            <span>Market cap</span>
            <span>24h volume</span>
            <span>24h</span>
            <span>Weight</span>
          </div>
          <div className="asset-list">
            {constituents.map((coin, index) => (
              <article className="asset-row" key={coin.symbol}>
                <div className="asset-id">
                  <span
                    className="coin-mark"
                    style={{ backgroundColor: coin.accent }}
                    aria-hidden="true"
                  >
                    {coin.symbol.slice(0, 1)}
                  </span>
                  <span className="rank">0{index + 1}</span>
                  <div>
                    <strong>{coin.symbol}</strong>
                    <small>{coin.name}</small>
                  </div>
                </div>
                <span className="market-value">{coin.marketCap}</span>
                <span className="market-value">{coin.volume}</span>
                <span className={coin.change >= 0 ? "positive" : "negative"}>
                  {coin.change >= 0 ? "+" : ""}
                  {coin.change.toFixed(1)}%
                </span>
                <div className="weight-cell">
                  <strong>{coin.weight.toFixed(2)}%</strong>
                  <div className="weight-track">
                    <span style={{ width: `${(coin.weight / 30) * 100}%` }} />
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="panel-note">
            <span>ⓘ</span>
            表示値はプロダクト確認用のデモスナップショットです。ライブ価格ではありません。
          </div>
        </div>
      </section>

      <section className="method-section" id="methodology">
        <div className="shell">
          <div className="method-intro">
            <span className="section-label light">METHODOLOGY</span>
            <h2>
              ルールを先に、
              <br />
              ストーリーは後に。
            </h2>
            <p>
              採用理由を誰でも検証できるようにすることが、指数ブランドの出発点です。
              ブラックボックスな「AI銘柄選定」は行いません。
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

      <section className="section shell risk-section" id="risk">
        <div className="risk-copy">
          <span className="section-label">RISK, MADE VISIBLE</span>
          <h2>上がる可能性より、壊れる可能性を先に見る。</h2>
          <p>
            ミームコインは極端な値動き、価格操作、流動性消失、コントラクト権限、
            規制変更などの影響を受けます。出来高や時価総額は安全性を保証しません。
          </p>
        </div>
        <div className="risk-list">
          <div>
            <span>01</span>
            <strong>Liquidity screening</strong>
            <small>売買しにくい小規模銘柄を候補から除外</small>
          </div>
          <div>
            <span>02</span>
            <strong>Concentration control</strong>
            <small>単一銘柄への過度な偏りを30%で制限</small>
          </div>
          <div>
            <span>03</span>
            <strong>Transparent changes</strong>
            <small>採用・除外・ルール変更の根拠を公開</small>
          </div>
        </div>
      </section>

      <section className="closing">
        <div className="shell closing-inner">
          <div>
            <span className="section-label light">THE RESEARCH STARTS HERE</span>
            <h2>ミーム市場を見る、新しい基準。</h2>
          </div>
          <a className="button light-button" href="#top">
            Back to top <span aria-hidden="true">↑</span>
          </a>
        </div>
      </section>

      <footer className="footer shell">
        <div className="brand footer-brand">
          <span className="brand-mark">M5</span>
          <span>
            Meme Top 5
            <small>Research Index</small>
          </span>
        </div>
        <p>
          MT5は研究用プロトタイプです。暗号資産、金融商品、投資助言、価値保証を
          提供するものではありません。
        </p>
        <span>© 2026 MT5 Research</span>
      </footer>
    </main>
  );
}
