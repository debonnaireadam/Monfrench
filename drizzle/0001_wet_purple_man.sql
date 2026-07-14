CREATE TABLE `activity_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`r2_key` text,
	`original_name` text,
	`content_type` text,
	`external_url` text,
	`file_size` integer DEFAULT 0 NOT NULL,
	`runtime_kind` text DEFAULT 'generic' NOT NULL,
	`online_capable` integer DEFAULT false NOT NULL,
	`manifest_version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_versions_number_idx` ON `activity_versions` (`activity_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `activity_versions_activity_idx` ON `activity_versions` (`activity_id`);--> statement-breakpoint
CREATE INDEX `activity_versions_r2_idx` ON `activity_versions` (`r2_key`);--> statement-breakpoint
INSERT INTO `activity_versions` (`id`,`activity_id`,`version_number`,`title`,`category`,`description`,`instructions`,`r2_key`,`original_name`,`content_type`,`external_url`,`file_size`,`runtime_kind`,`online_capable`,`manifest_version`,`created_by`,`created_at`)
SELECT 'legacy-' || `id`,`id`,1,`title`,`category`,`description`,`instructions`,`r2_key`,`original_name`,`content_type`,`external_url`,0,'generic',0,1,`created_by`,`created_at` FROM `activities`;--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `app_settings` (`key`,`value`,`updated_by`,`updated_at`) VALUES ('trash_retention_days','30',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_idx` ON `audit_events` (`actor_id`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`parent_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text,
	`archived_at` text,
	`trashed_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `folders_scope_parent_idx` ON `folders` (`scope`,`parent_id`);--> statement-breakpoint
CREATE INDEX `folders_creator_idx` ON `folders` (`created_by`);--> statement-breakpoint
CREATE TABLE `student_work` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`state_r2_key` text,
	`state_size` integer DEFAULT 0 NOT NULL,
	`state_version` integer DEFAULT 0 NOT NULL,
	`final_pdf_r2_key` text,
	`final_pdf_original_name` text,
	`final_pdf_content_type` text,
	`final_pdf_size` integer DEFAULT 0 NOT NULL,
	`saved_at` text,
	`submitted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_work_assignment_student_idx` ON `student_work` (`assignment_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `student_work_student_idx` ON `student_work` (`student_id`);--> statement-breakpoint
CREATE TABLE `teacher_students` (
	`student_id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`assigned_at` text NOT NULL,
	`assigned_by` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `teacher_students_teacher_idx` ON `teacher_students` (`teacher_id`);--> statement-breakpoint
INSERT INTO `teacher_students` (`student_id`,`teacher_id`,`assigned_at`,`assigned_by`)
SELECT student.`id`,teacher.`id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'),teacher.`id`
FROM `users` student
CROSS JOIN (
	SELECT `id` FROM `users`
	WHERE `role`='teacher' AND `active`=1 AND lower(`username`)='debonnaire'
	ORDER BY `created_at`,`id`
	LIMIT 1
) teacher
WHERE student.`role`='student';--> statement-breakpoint
-- Add assignment metadata in place. Rebuilding this parent table would fire
-- the existing ON DELETE CASCADE relationships in D1 and could erase
-- assignment_students and submissions.
ALTER TABLE `assignments` ADD `activity_version_id` text REFERENCES `activity_versions`(`id`);--> statement-breakpoint
UPDATE `assignments` SET `activity_version_id`='legacy-' || `activity_id`;--> statement-breakpoint
ALTER TABLE `assignments` ADD `folder_id` text;--> statement-breakpoint
ALTER TABLE `assignments` ADD `status` text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE `assignments` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `assignments` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `assignments` ADD `trashed_at` text;--> statement-breakpoint
CREATE INDEX `assignments_creator_idx` ON `assignments` (`created_by`);--> statement-breakpoint
CREATE INDEX `assignments_activity_idx` ON `assignments` (`activity_id`);--> statement-breakpoint
CREATE INDEX `assignments_version_idx` ON `assignments` (`activity_version_id`);--> statement-breakpoint
CREATE INDEX `assignments_folder_idx` ON `assignments` (`folder_id`);--> statement-breakpoint
ALTER TABLE `activities` ADD `current_version_id` text;--> statement-breakpoint
UPDATE `activities` SET `current_version_id`='legacy-' || `id`;--> statement-breakpoint
ALTER TABLE `activities` ADD `folder_id` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `trashed_at` text;--> statement-breakpoint
CREATE INDEX `activities_creator_idx` ON `activities` (`created_by`);--> statement-breakpoint
CREATE INDEX `activities_folder_idx` ON `activities` (`folder_id`);--> statement-breakpoint
CREATE INDEX `activities_current_version_idx` ON `activities` (`current_version_id`);--> statement-breakpoint
ALTER TABLE `assignment_students` ADD `assigned_at` text;--> statement-breakpoint
UPDATE `assignment_students` SET `assigned_at`=(SELECT `published_at` FROM `assignments` WHERE `assignments`.`id`=`assignment_students`.`assignment_id`);--> statement-breakpoint
CREATE INDEX `assignment_students_student_idx` ON `assignment_students` (`student_id`);--> statement-breakpoint
ALTER TABLE `submissions` ADD `folder_id` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `file_size` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `corrected_file_size` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `trashed_at` text;--> statement-breakpoint
CREATE INDEX `submissions_student_idx` ON `submissions` (`student_id`);--> statement-breakpoint
CREATE INDEX `submissions_folder_idx` ON `submissions` (`folder_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `folder_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `users` ADD `deactivated_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `trashed_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `updated_at` text;--> statement-breakpoint
CREATE INDEX `users_role_active_idx` ON `users` (`role`,`active`);--> statement-breakpoint
CREATE INDEX `users_folder_idx` ON `users` (`folder_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_single_owner_idx` ON `users` (`role`) WHERE `role`='owner';
