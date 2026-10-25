CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`host` text NOT NULL,
	`username` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_kind_host_unique` ON `sources` (`kind`,`host`);--> statement-breakpoint
CREATE TABLE `viewed_files` (
	`source_id` integer NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`path` text NOT NULL,
	`patch_hash` text NOT NULL,
	PRIMARY KEY(`source_id`, `repo`, `number`, `path`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
