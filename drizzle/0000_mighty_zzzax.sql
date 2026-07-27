CREATE TABLE `index_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`value` real NOT NULL,
	`change_30m` real NOT NULL,
	`payload` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `index_snapshots_time_idx` ON `index_snapshots` (`timestamp`);--> statement-breakpoint
CREATE TABLE `trades` (
	`signature` text PRIMARY KEY NOT NULL,
	`token_address` text NOT NULL,
	`symbol` text NOT NULL,
	`wallet` text NOT NULL,
	`cluster_id` text NOT NULL,
	`side` text NOT NULL,
	`amount_usd` real NOT NULL,
	`price_usd` real,
	`identity_confidence` real DEFAULT 0 NOT NULL,
	`bot_score` real DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`timestamp` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trades_token_time_idx` ON `trades` (`token_address`,`timestamp`);--> statement-breakpoint
CREATE INDEX `trades_cluster_time_idx` ON `trades` (`cluster_id`,`timestamp`);