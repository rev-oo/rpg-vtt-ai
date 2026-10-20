CREATE TABLE `chat_messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`table_id` text NOT NULL,
	`sender_id` text,
	`speaker` text NOT NULL,
	`audience` text NOT NULL,
	`recipients` text DEFAULT '[]' NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`rolls` text DEFAULT '[]' NOT NULL,
	`card` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `game_tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_id_unique` ON `chat_messages` (`id`);--> statement-breakpoint
CREATE INDEX `chat_messages_history_idx` ON `chat_messages` (`table_id`,`seq`);