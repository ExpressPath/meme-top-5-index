import type { IndexSnapshot } from "./index-engine.ts";

export type IndexState = {
  level: number;
  divisor: number;
  asOf: string;
  lastRebalancedAt: string;
  methodologyVersion: "4.0";
  constituents: Array<{
    tokenAddress: string;
    units: number;
    weight: number;
    priceUsd: number;
  }>;
};

type IndexStateRow = {
  stateJson: string;
};

type SnapshotRow = {
  payload: string;
  timestamp: number;
};

const INDEX_STATE_ID = "mt5";
const REBALANCE_HOUR_UTC = 0;

export function advanceIndexState(
  previous: IndexState | null,
  snapshot: IndexSnapshot,
): { snapshot: IndexSnapshot; state: IndexState; rebalanced: boolean } {
  if (snapshot.constituents.length === 0) {
    return {
      snapshot,
      state:
        previous ?? {
          level: snapshot.value,
          divisor: 1 / Math.max(snapshot.value, 1),
          asOf: snapshot.asOf,
          lastRebalancedAt: snapshot.asOf,
          methodologyVersion: "4.0",
          constituents: [],
        },
      rebalanced: false,
    };
  }

  const currentPrices = new Map(
    snapshot.constituents.map((coin) => [coin.tokenAddress, coin.priceUsd]),
  );
  const sameBasket =
    previous?.constituents.length === snapshot.constituents.length &&
    previous.constituents.every((coin) => currentPrices.has(coin.tokenAddress));
  const scheduledRebalance =
    previous !== null &&
    sameBasket &&
    isNewRebalanceDay(previous.lastRebalancedAt, snapshot.asOf);
  const rebalanced = previous === null || !sameBasket || scheduledRebalance;

  let level = snapshot.value;
  let divisor = previous?.divisor ?? 1 / Math.max(level, 1);
  let units: IndexState["constituents"];
  let lastRebalancedAt = previous?.lastRebalancedAt ?? snapshot.asOf;

  if (previous && sameBasket) {
    const basketValue = previous.constituents.reduce(
      (sum, coin) =>
        sum + coin.units * (currentPrices.get(coin.tokenAddress) ?? 0),
      0,
    );
    if (basketValue > 0 && previous.divisor > 0) {
      level = basketValue / previous.divisor;
    }
  } else if (previous) {
    level = previous.level;
  }

  if (rebalanced) {
    units = snapshot.constituents.map((coin) => ({
      tokenAddress: coin.tokenAddress,
      units: coin.priceUsd > 0 ? coin.weight / coin.priceUsd : 0,
      weight: coin.weight,
      priceUsd: coin.priceUsd,
    }));
    divisor = 1 / Math.max(level, 1e-9);
    lastRebalancedAt = snapshot.asOf;
  } else {
    units = previous!.constituents.map((coin) => ({
      ...coin,
      priceUsd: currentPrices.get(coin.tokenAddress) ?? coin.priceUsd,
    }));
  }

  const previousLevel = previous?.level ?? 1000;
  const changePercent =
    previousLevel > 0 ? ((level / previousLevel) - 1) * 100 : 0;
  const basketValue = units.reduce(
    (sum, coin) => sum + coin.units * coin.priceUsd,
    0,
  );
  const weightsByAddress = new Map(
    units.map((coin) => [
      coin.tokenAddress,
      basketValue > 0 ? (coin.units * coin.priceUsd) / basketValue : coin.weight,
    ]),
  );
  const nextSnapshot: IndexSnapshot = {
    ...snapshot,
    value: level,
    changePercent,
    constituents: snapshot.constituents.map((coin) => ({
      ...coin,
      weight: weightsByAddress.get(coin.tokenAddress) ?? coin.weight,
    })),
  };
  const state: IndexState = {
    level,
    divisor,
    asOf: snapshot.asOf,
    lastRebalancedAt,
    methodologyVersion: "4.0",
    constituents: units.map((coin) => ({
      ...coin,
      weight: weightsByAddress.get(coin.tokenAddress) ?? coin.weight,
    })),
  };

  return { snapshot: nextSnapshot, state, rebalanced };
}

export async function readIndexState(database?: D1Database) {
  if (!database) return null;
  const row = await database
    .prepare(
      `SELECT state_json AS stateJson
       FROM index_state
       WHERE id = ?`,
    )
    .bind(INDEX_STATE_ID)
    .first<IndexStateRow>();
  if (!row) return null;

  try {
    return JSON.parse(row.stateJson) as IndexState;
  } catch {
    return null;
  }
}

export async function readLatestIndexSnapshot(
  database?: D1Database,
  maximumAgeSeconds = 180,
) {
  if (!database) return null;
  const cutoff = Math.floor(Date.now() / 1000) - maximumAgeSeconds;
  const row = await database
    .prepare(
      `SELECT payload, timestamp
       FROM index_snapshots
       WHERE timestamp >= ?
       ORDER BY timestamp DESC, id DESC
       LIMIT 1`,
    )
    .bind(cutoff)
    .first<SnapshotRow>();
  if (!row) return null;

  try {
    return JSON.parse(row.payload) as IndexSnapshot;
  } catch {
    return null;
  }
}

export async function persistIndexSnapshot(
  database: D1Database | undefined,
  snapshot: IndexSnapshot,
  state: IndexState,
) {
  if (!database) return;
  const timestamp = Math.floor(new Date(snapshot.asOf).getTime() / 1000);
  const stateJson = JSON.stringify(state);
  const payload = JSON.stringify(snapshot);
  const retentionCutoff = timestamp - 7 * 24 * 60 * 60;

  await database.batch([
    database
      .prepare(
        `INSERT INTO index_state (
           id, level, divisor, state_json, last_rebalanced_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           level = excluded.level,
           divisor = excluded.divisor,
           state_json = excluded.state_json,
           last_rebalanced_at = excluded.last_rebalanced_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        INDEX_STATE_ID,
        state.level,
        state.divisor,
        stateJson,
        Math.floor(new Date(state.lastRebalancedAt).getTime() / 1000),
        timestamp,
      ),
    database
      .prepare(
        `INSERT INTO index_snapshots (
           value, change_30m, payload, timestamp
         ) VALUES (?, ?, ?, ?)`,
      )
      .bind(snapshot.value, snapshot.changePercent, payload, timestamp),
    database
      .prepare("DELETE FROM index_snapshots WHERE timestamp < ?")
      .bind(retentionCutoff),
  ]);
}

function isNewRebalanceDay(previousAsOf: string, nextAsOf: string) {
  const previous = new Date(previousAsOf);
  const next = new Date(nextAsOf);
  const previousDay = Date.UTC(
    previous.getUTCFullYear(),
    previous.getUTCMonth(),
    previous.getUTCDate(),
    REBALANCE_HOUR_UTC,
  );
  const nextDay = Date.UTC(
    next.getUTCFullYear(),
    next.getUTCMonth(),
    next.getUTCDate(),
    REBALANCE_HOUR_UTC,
  );
  return nextDay > previousDay;
}
