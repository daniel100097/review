CREATE TABLE `walkthroughs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`head_sha` text NOT NULL,
	`agent` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
