CREATE TABLE `actors` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`image_url` text,
	`ownership` text DEFAULT '{"default":"none","users":{}}' NOT NULL,
	`system` text DEFAULT '{}' NOT NULL,
	`data_version` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`soft_deleted_at` integer,
	FOREIGN KEY (`table_id`) REFERENCES `game_tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `actors_table_id_idx` ON `actors` (`table_id`,`soft_deleted_at`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`actor_id` text,
	`source_id` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`image_url` text,
	`system` text DEFAULT '{}' NOT NULL,
	`data_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`soft_deleted_at` integer,
	FOREIGN KEY (`table_id`) REFERENCES `game_tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `items_table_id_idx` ON `items` (`table_id`,`soft_deleted_at`);--> statement-breakpoint
CREATE INDEX `items_actor_id_idx` ON `items` (`actor_id`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`title` text NOT NULL,
	`ownership` text DEFAULT '{"default":"observer","users":{}}' NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`soft_deleted_at` integer,
	FOREIGN KEY (`table_id`) REFERENCES `game_tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `journal_entries_table_id_idx` ON `journal_entries` (`table_id`,`soft_deleted_at`);