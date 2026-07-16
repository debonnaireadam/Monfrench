ALTER TABLE `users` ADD `upload_permission` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activities` ADD `publication_status` text DEFAULT 'published' NOT NULL;
