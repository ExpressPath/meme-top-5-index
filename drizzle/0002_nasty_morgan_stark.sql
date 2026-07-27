CREATE TABLE `index_state` (
	`id` text PRIMARY KEY NOT NULL,
	`level` real NOT NULL,
	`divisor` real NOT NULL,
	`state_json` text NOT NULL,
	`last_rebalanced_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingest_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`signer_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ingest_nonces_received_idx` ON `ingest_nonces` (`received_at`);--> statement-breakpoint
CREATE TABLE `reserve_reports` (
	`report_id` text NOT NULL,
	`signer_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`as_of` integer NOT NULL,
	`mode` text NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL,
	`body_hash` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`report_id`, `signer_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reserve_reports_signer_sequence_idx` ON `reserve_reports` (`signer_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `reserve_reports_as_of_idx` ON `reserve_reports` (`as_of`);