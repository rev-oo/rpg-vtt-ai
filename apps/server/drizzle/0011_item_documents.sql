ALTER TABLE `ydocs` ADD `item_id` text REFERENCES items(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `ydocs_item_id_idx` ON `ydocs` (`item_id`);