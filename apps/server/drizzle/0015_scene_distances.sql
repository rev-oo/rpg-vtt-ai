ALTER TABLE `scenes` ADD `cell_distance` real DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `distance_unit` text DEFAULT 'ft' NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `diagonals` text DEFAULT 'one' NOT NULL;