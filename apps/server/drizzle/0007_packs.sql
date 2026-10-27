ALTER TABLE `actors` ADD `pack_ref` text;--> statement-breakpoint
CREATE INDEX `actors_pack_ref_idx` ON `actors` (`table_id`,`pack_ref`);--> statement-breakpoint
ALTER TABLE `items` ADD `pack_ref` text;--> statement-breakpoint
CREATE INDEX `items_pack_ref_idx` ON `items` (`table_id`,`pack_ref`);