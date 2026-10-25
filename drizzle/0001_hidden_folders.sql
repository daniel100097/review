CREATE TABLE `hidden_folders` (
	`source_id` integer NOT NULL,
	`repo` text NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`source_id`, `repo`, `path`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
