"use client";

import { useEffect, useState } from "react";

type BackingStatusResponse = {
  status: "unconfigured" | "blocked" | "ready";
  releaseEligible: boolean;
  attestationQuorum: {
    required: number;
    observed: number;
  };
  plan: {
    targetReserveRatioBps: number;
    maximumWeightDriftBps: number;
    rebalance: {
      frequency: string;
      effectiveTime: string;
    };
  };
  reserve: null | {
    reserveRatioBps: number;
    maximumWeightDriftBps: number;
  };
  onchain?: {
    status: "unconfigured" | "blocked" | "verified" | "error";
    verified: boolean;
  };
  reconciliation?: null | {
    matches: boolean;
    maximumObservedDifferenceBps: number;
  };
  reasons: string[];
};

export default function BackingStatus() {
  const [status, setStatus] = useState<BackingStatusResponse | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/backing", { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as BackingStatusResponse;
        if (active) setStatus(next);
      } catch {
        // The visible fail-closed state remains when the status API is offline.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const ready = status?.releaseEligible === true;
  return (
    <div className={`backing-panel ${ready ? "ready" : "blocked"}`}>
      <div className="backing-head">
        <div>
          <span className="section-label">BACKING CONTROL</span>
          <h2>裏付け資産は、発行より先に証明する。</h2>
        </div>
        <span className="backing-state">
          {ready ? "RELEASE READY" : "ISSUANCE BLOCKED"}
        </span>
      </div>
      <div className="backing-metrics">
        <div>
          <strong>
            {status
              ? `${(status.plan.targetReserveRatioBps / 100).toFixed(0)}%`
              : "102%"}
          </strong>
          <span>Target reserve ratio</span>
        </div>
        <div>
          <strong>
            {status
              ? `${status.attestationQuorum.observed}/${status.attestationQuorum.required}`
              : "0/2"}
          </strong>
          <span>Signed attestations</span>
        </div>
        <div>
          <strong>
            {status
              ? `${status.plan.maximumWeightDriftBps / 100}%`
              : "1%"}
          </strong>
          <span>Maximum weight drift</span>
        </div>
        <div>
          <strong>00:00</strong>
          <span>Daily rebalance · UTC</span>
        </div>
      </div>
      <p>
        指数バスケット100%に現金バッファ2%を加え、独立した2者が同一の保管資産レポートへ署名した場合だけ、
        償還NAVの公開候補になります。現在は実カストディ未接続のため発行・入金を停止しています。
      </p>
      <div className="backing-verification">
        <span>
          On-chain Vault:{" "}
          <strong>{status?.onchain?.status ?? "unconfigured"}</strong>
        </span>
        <span>
          Attestation ↔ Chain:{" "}
          <strong>
            {status?.reconciliation
              ? status.reconciliation.matches
                ? "matched"
                : "mismatch"
              : "pending"}
          </strong>
        </span>
      </div>
      <div className="backing-links">
        <a href="/api/backing">Backing API</a>
        <a href="/api/security">Security API</a>
        <a href="/index-methodology.json">Methodology 4.0</a>
      </div>
    </div>
  );
}
