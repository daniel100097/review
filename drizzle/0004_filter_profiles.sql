CREATE TABLE `filter_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`repo` text NOT NULL,
	`name` text NOT NULL,
	`settings` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filter_profiles_source_id_repo_name_unique` ON `filter_profiles` (`source_id`,`repo`,`name`);