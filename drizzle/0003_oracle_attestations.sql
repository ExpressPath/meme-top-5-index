CREATE TABLE `oracle_attestations` (
  `digest` text NOT NULL,
  `key_id` text NOT NULL,
  `signature` text NOT NULL,
  `as_of` integer NOT NULL,
  `received_at` integer NOT NULL,
  PRIMARY KEY(`digest`, `key_id`)
);
--> statement-breakpoint
CREATE INDEX `oracle_attestations_received_idx`
  ON `oracle_attestations` (`received_at`);
