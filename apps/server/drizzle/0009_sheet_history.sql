CREATE TABLE `actor_snapshots` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`actor_id` text NOT NULL,
	`layer` text NOT NULL,
	`state` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actor_snapshots_id_unique` ON `actor_snapshots` (`id`);--> statement-breakpoint
CREATE INDEX `actor_snapshots_actor_idx` ON `actor_snapshots` (`actor_id`,`layer`,`seq`);