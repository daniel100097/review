CREATE TABLE `flowmark_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`base_sha` text NOT NULL,
	`head_sha` text NOT NULL,
	`mode` text NOT NULL,
	`request` text DEFAULT '' NOT NULL,
	`agent` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`base_source` text,
	`head_source` text,
	`result` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
