import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const trades = sqliteTable(
  "trades",
  {
    signature: text("signature").primaryKey(),
    tokenAddress: text("token_address").notNull(),
    symbol: text("symbol").notNull(),
    wallet: text("wallet").notNull(),
    clusterId: text("cluster_id").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    amountUsd: real("amount_usd").notNull(),
    priceUsd: real("price_usd"),
    identityConfidence: real("identity_confidence").notNull().default(0),
    botScore: real("bot_score").notNull().default(0),
    source: text("source").notNull(),
    timestamp: integer("timestamp").notNull(),
    receivedAt: integer("received_at").notNull(),
  },
  (table) => [
    index("trades_token_time_idx").on(table.tokenAddress, table.timestamp),
    index("trades_cluster_time_idx").on(table.clusterId, table.timestamp),
  ],
);

export const indexSnapshots = sqliteTable(
  "index_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    value: real("value").notNull(),
    change30m: real("change_30m").notNull(),
    payload: text("payload").notNull(),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => [index("index_snapshots_time_idx").on(table.timestamp)],
);

export const collectorState = sqliteTable("collector_state", {
  id: text("id").primaryKey(),
  cursor: integer("cursor").notNull().default(0),
  nextDue: integer("next_due").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const indexState = sqliteTable("index_state", {
  id: text("id").primaryKey(),
  level: real("level").notNull(),
  divisor: real("divisor").notNull(),
  stateJson: text("state_json").notNull(),
  lastRebalancedAt: integer("last_rebalanced_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const ingestNonces = sqliteTable(
  "ingest_nonces",
  {
    nonce: text("nonce").primaryKey(),
    signerId: text("signer_id").notNull(),
    timestamp: integer("timestamp").notNull(),
    receivedAt: integer("received_at").notNull(),
  },
  (table) => [index("ingest_nonces_received_idx").on(table.receivedAt)],
);

export const reserveReports = sqliteTable(
  "reserve_reports",
  {
    reportId: text("report_id").notNull(),
    signerId: text("signer_id").notNull(),
    sequence: integer("sequence").notNull(),
    asOf: integer("as_of").notNull(),
    mode: text("mode", { enum: ["shadow", "custodied"] }).notNull(),
    source: text("source").notNull(),
    payload: text("payload").notNull(),
    bodyHash: text("body_hash").notNull(),
    receivedAt: integer("received_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.reportId, table.signerId] }),
    uniqueIndex("reserve_reports_signer_sequence_idx").on(
      table.signerId,
      table.sequence,
    ),
    index("reserve_reports_as_of_idx").on(table.asOf),
  ],
);
