"use client";

import { useEffect, useState } from "react";
import type { IndexSnapshot } from "../lib/index-engine";

export default function LiveIndex({
  initial,
  compact = false,
}: {
  initial: IndexSnapshot;
  compact?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initial);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/index", { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as IndexSnapshot;
        if (active) setSnapshot(next);
      } catch {
        // Keep the most recent successful snapshot visible.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (compact) {
    return (
      <div className="index-float" aria-live="polite">
        <div className="float-top">
          <span>MT5 / USD</span>
          <span className={`preview-pill ${snapshot.isLive ? "live" : ""}`}>
            {snapshot.isLive ? "LIVE" : "FALLBACK"}
          </span>
        </div>
        <strong>{snapshot.value.toFixed(2)}</strong>
        <div className="float-bottom">
          <span>1H WEIGHTED</span>
          <span className={snapshot.changePercent >= 0 ? "positive" : "negative"}>
            {signedPercent(snapshot.changePercent)}
          </span>
        </div>
      </div>
    );
  }

  const identityLive = snapshot.dataMode === "live-human-estimate";
  return (
    <div className="index-panel" aria-live="polite">
      <div className="feed-status">
        <div>
          <span className={`status-dot ${snapshot.isLive ? "" : "paused"}`} />
          {snapshot.isLive ? "Market feed live" : "Fallback snapshot"}
        </div>
        <span>{new Date(snapshot.asOf).toLocaleString("ja-JP")}</span>
      </div>
      <div className={`identity-banner ${identityLive ? "ready" : ""}`}>
        <strong>{identityLive ? "Human estimate live" : "Identity layer pending"}</strong>
        <span>{snapshot.identityNotice}</span>
      </div>
      <div className="table-head live-table-head" aria-hidden="true">
        <span>Asset</span>
        <span>Buy amount</span>
        <span>Est. users</span>
        <span>{snapshot.windowMinutes}m</span>
        <span>Market-cap weight</span>
      </div>
      <div className="asset-list">
        {snapshot.constituents.map((coin) => (
          <article className="asset-row live-asset-row" key={coin.tokenAddress}>
            <div className="asset-id">
              <span className="coin-mark" aria-hidden="true">
                {coin.symbol.slice(0, 1)}
              </span>
              <span className="rank">0{coin.rank}</span>
              <div>
                <strong>{coin.symbol}</strong>
                <small>{coin.name}</small>
              </div>
            </div>
            <span className="market-value">{formatUsd(coin.rankingBuyUsd)}</span>
            <span className="market-value">
              {coin.estimatedUsers === null
                ? "—"
                : coin.estimatedUsers.toLocaleString("ja-JP")}
            </span>
            <span className={coin.changePercent >= 0 ? "positive" : "negative"}>
              {signedPercent(coin.changePercent)}
            </span>
            <div className="weight-cell">
              <strong>{(coin.weight * 100).toFixed(2)}%</strong>
              <div className="weight-track">
                <span style={{ width: `${coin.weight * 100}%` }} />
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="panel-note">
        <span>ⓘ</span>
        {identityLive
          ? "有効買い総額は、Bot除外後に1ユーザー当たり$10,000で上限処理した値です。"
          : "人間推定フィードが基準を満たすまで、買い出来高プロキシによる暫定順位です。ウォレット数はユーザー数として表示しません。"}
      </div>
    </div>
  );
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
