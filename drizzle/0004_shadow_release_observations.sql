CREATE TABLE `shadow_daily_status` (
  `day` text PRIMARY KEY NOT NULL,
  `samples` integer DEFAULT 0 NOT NULL,
  `index_ready_samples` integer DEFAULT 0 NOT NULL,
  `backing_ready_samples` integer DEFAULT 0 NOT NULL,
  `oracle_ready_samples` integer DEFAULT 0 NOT NULL,
  `fully_ready_samples` integer DEFAULT 0 NOT NULL,
  `failed_samples` integer DEFAULT 0 NOT NULL,
  `last_seen_at` integer NOT NULL
);
