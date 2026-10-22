CREATE TABLE `ydocs` (
	`name` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`journal_entry_id` text,
	`state` blob NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ydocs_actor_id_idx` ON `ydocs` (`actor_id`);--> statement-breakpoint
CREATE INDEX `ydocs_journal_entry_id_idx` ON `ydocs` (`journal_entry_id`);