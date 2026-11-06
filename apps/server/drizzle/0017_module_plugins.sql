CREATE TABLE `user_plugin_settings` (
	`user_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`values` text NOT NULL,
	PRIMARY KEY(`user_id`, `plugin_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `game_tables` ADD `modules` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_tables` ADD `module_settings` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `kind` text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `settings` text DEFAULT '{}' NOT NULL;