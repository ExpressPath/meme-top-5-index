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
        // The last successful snapshot remains visible during a source outage.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (compact) {
    const publicationLabel = snapshot.publication.tokenNavEligible
      ? "NAV READY"
      : snapshot.isLive
        ? "INDEX LIVE"
        : "HALTED";
    return (
      <div className="index-float" aria-live="polite">
        <div className="float-top">
          <span>MT5 / USD</span>
          <span className={`preview-pill ${snapshot.isLive ? "live" : ""}`}>
            {publicationLabel}
          </span>
        </div>
        <strong>{snapshot.value.toFixed(2)}</strong>
        <div className="float-bottom">
          <span>{snapshot.windowMinutes}M MARKET-CAP WEIGHTED</span>
          <span className={snapshot.changePercent >= 0 ? "positive" : "negative"}>
            {signedPercent(snapshot.changePercent)}
          </span>
        </div>
      </div>
    );
  }

  const identityLive = snapshot.dataMode === "live-human-estimate";
  const walletObservation =
    snapshot.dataMode === "live-wallet-observation";
  const tokenNavEligible = snapshot.publication.tokenNavEligible;
  return (
    <div className="index-panel" aria-live="polite">
      <div className="feed-status">
        <div>
          <span className={`status-dot ${snapshot.isLive ? "" : "paused"}`} />
          {snapshot.isLive ? "オンライン集計中" : "検証用スナップショット"}
        </div>
        <span>
          {formatTimestamp(snapshot.asOf)}・60秒ごとに更新
        </span>
      </div>
      <div
        className={`identity-banner ${
          identityLive || walletObservation ? "ready" : ""
        }`}
      >
        <strong>
          {tokenNavEligible
            ? "トークンNAV公開可能"
            : identityLive
              ? "人物推定稼働・NAV審査中"
              : walletObservation
                ? "買い手観測稼働・人物判定未達"
                : "市場プロキシ稼働・人物判定未達"}
        </strong>
        <span>{snapshot.identityNotice}</span>
      </div>
      <div className="table-head live-table-head" aria-hidden="true">
        <span>銘柄</span>
        <span>30分購入総額</span>
        <span>推定アクティブ買い手</span>
        <span>観測ウォレット</span>
        <span>時価総額ウェイト</span>
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
                <small>
                  {coin.name}
                  {coin.demandCoverageComplete === false ? "・下限値" : ""}
                </small>
              </div>
            </div>
            <span className="market-value">
              {formatUsd(coin.rankingBuyUsd)}
            </span>
            <span className="market-value">
              {coin.estimatedUsers === null
                ? "—"
                : coin.estimatedUsers.toLocaleString("ja-JP")}
            </span>
            <span className="market-value">
              {coin.observedBuyerWallets === null
                ? "—"
                : coin.observedBuyerWallets.toLocaleString("ja-JP")}
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
        推定アクティブ買い手は、署名ウォレットの重複を除き、短時間の連続取引と
        1 USD未満の極小購入を除外した参考値です。人物を特定する数値ではありません。
      </div>
      <div className="panel-note">
        <span>✓</span>
        市場合意 {snapshot.publication.consensusConstituents}/5・買い手観測{" "}
        {snapshot.publication.demandObservedConstituents}/5・30分網羅{" "}
        {snapshot.publication.completeDemandConstituents}/5・オンチェーン検証{" "}
        {snapshot.publication.chainVerifiedConstituents}/5・トークンNAV{" "}
        {snapshot.publication.tokenNavEligible ? "公開可能" : "自動停止中"}
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

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
  });
}
