CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`actor_id` text,
	`name` text DEFAULT '' NOT NULL,
	`image_url` text,
	`column` real NOT NULL,
	`row` real NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tokens_scene_idx` ON `tokens` (`scene_id`);--> statement-breakpoint
CREATE INDEX `tokens_actor_idx` ON `tokens` (`actor_id`);