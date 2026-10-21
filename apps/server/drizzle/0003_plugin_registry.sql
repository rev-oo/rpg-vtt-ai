ALTER TABLE `plugins` ADD `description` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `core_api` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `code_entries` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `issues` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `scanned_at` integer;