CREATE TABLE `collector_state` (
	`id` text PRIMARY KEY NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`next_due` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
