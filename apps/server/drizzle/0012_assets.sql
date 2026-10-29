CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`uploader_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `game_tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assets_table_idx` ON `assets` (`table_id`,`created_at`);