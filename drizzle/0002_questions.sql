CREATE TABLE `question_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`role` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'done' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `question_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `question_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`path` text NOT NULL,
	`old_path` text NOT NULL,
	`old_line` integer,
	`new_line` integer,
	`excerpt` text NOT NULL,
	`head_sha` text NOT NULL,
	`base_sha` text NOT NULL,
	`agent` text NOT NULL,
	`model` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
