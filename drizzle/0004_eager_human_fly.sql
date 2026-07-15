CREATE TABLE `student_assignment_folders` (
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`folder_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_assignment_folder_idx` ON `student_assignment_folders` (`assignment_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `student_assignment_folder_student_idx` ON `student_assignment_folders` (`student_id`,`folder_id`);--> statement-breakpoint
ALTER TABLE `submissions` ADD `corrected_original_name` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `corrected_content_type` text;