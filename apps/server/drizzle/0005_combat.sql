CREATE TABLE `combatants` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`actor_id` text,
	`name` text NOT NULL,
	`initiative` real,
	`hidden` integer DEFAULT false NOT NULL,
	`sort` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `combatants_encounter_id_idx` ON `combatants` (`encounter_id`);--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`current_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `game_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encounters_table_id_unique` ON `encounters` (`table_id`);