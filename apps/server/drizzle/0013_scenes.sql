CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`name` text NOT NULL,
	`background_url` text,
	`columns` integer NOT NULL,
	`rows` integer NOT NULL,
	`grid_type` text NOT NULL,
	`grid_size` integer NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`sort` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `game_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenes_table_idx` ON `scenes` (`table_id`,`sort`);--> statement-breakpoint
CREATE UNIQUE INDEX `scenes_active_unique` ON `scenes` (`table_id`) WHERE "scenes"."active" = 1;