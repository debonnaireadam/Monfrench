CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`title` text NOT NULL,
	`level` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`current_version_id` text,
	`publication_status` text DEFAULT 'draft' NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`published_at` text,
	`archived_at` text,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`current_version_id`) REFERENCES `activity_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "activities_publication_status_check" CHECK("activities"."publication_status" in ('draft', 'pending_review', 'published', 'rejected', 'unpublished', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `activities_unit_status_idx` ON `activities` (`unit_id`,`publication_status`);--> statement-breakpoint
CREATE INDEX `activities_author_idx` ON `activities` (`author_id`);--> statement-breakpoint
CREATE INDEX `activities_current_version_idx` ON `activities` (`current_version_id`);--> statement-breakpoint
CREATE TABLE `activity_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`r2_key` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`file_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`checksum_sha256` text NOT NULL,
	`validation_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "activity_versions_number_check" CHECK("activity_versions"."version_number" > 0),
	CONSTRAINT "activity_versions_file_type_check" CHECK("activity_versions"."file_type" in ('html', 'zip')),
	CONSTRAINT "activity_versions_file_size_check" CHECK("activity_versions"."file_size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_versions_number_idx` ON `activity_versions` (`activity_id`,`version_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_versions_r2_key_idx` ON `activity_versions` (`r2_key`);--> statement-breakpoint
CREATE INDEX `activity_versions_created_by_idx` ON `activity_versions` (`created_by`);--> statement-breakpoint
CREATE TABLE `assignment_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`recipient_type` text NOT NULL,
	`student_id` text,
	`group_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assignment_recipients_type_check" CHECK("assignment_recipients"."recipient_type" in ('student', 'group')),
	CONSTRAINT "assignment_recipients_target_check" CHECK((
      ("assignment_recipients"."recipient_type" = 'student' and "assignment_recipients"."student_id" is not null and "assignment_recipients"."group_id" is null)
      or
      ("assignment_recipients"."recipient_type" = 'group' and "assignment_recipients"."group_id" is not null and "assignment_recipients"."student_id" is null)
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_recipients_student_idx` ON `assignment_recipients` (`assignment_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_recipients_group_idx` ON `assignment_recipients` (`assignment_id`,`group_id`);--> statement-breakpoint
CREATE INDEX `assignment_recipients_student_lookup_idx` ON `assignment_recipients` (`student_id`,`assignment_id`);--> statement-breakpoint
CREATE INDEX `assignment_recipients_group_lookup_idx` ON `assignment_recipients` (`group_id`,`assignment_id`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`activity_version_id` text NOT NULL,
	`assigned_by` text NOT NULL,
	`due_at` text,
	`instructions` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`activity_version_id`) REFERENCES `activity_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assignments_status_check" CHECK("assignments"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `assignments_activity_idx` ON `assignments` (`activity_id`);--> statement-breakpoint
CREATE INDEX `assignments_version_idx` ON `assignments` (`activity_version_id`);--> statement-breakpoint
CREATE INDEX `assignments_teacher_status_idx` ON `assignments` (`assigned_by`,`status`);--> statement-breakpoint
CREATE INDEX `assignments_due_idx` ON `assignments` (`due_at`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`request_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_actor_created_idx` ON `audit_events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "categories_active_check" CHECK("categories"."active" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_idx` ON `categories` (`name`);--> statement-breakpoint
CREATE INDEX `categories_active_order_idx` ON `categories` (`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "collections_active_check" CHECK("collections"."active" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_category_name_idx` ON `collections` (`category_id`,`name`);--> statement-breakpoint
CREATE INDEX `collections_category_active_order_idx` ON `collections` (`category_id`,`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `group_memberships` (
	`group_id` text NOT NULL,
	`student_id` text NOT NULL,
	`added_by` text,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`group_id`, `student_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `group_memberships_student_idx` ON `group_memberships` (`student_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`teacher_id` text NOT NULL,
	`created_by` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "groups_active_check" CHECK("groups"."active" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_teacher_name_idx` ON `groups` (`teacher_id`,`name`);--> statement-breakpoint
CREATE INDEX `groups_teacher_active_idx` ON `groups` (`teacher_id`,`active`);--> statement-breakpoint
CREATE TABLE `migration_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`legacy_id` text NOT NULL,
	`identifier` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload_json` text NOT NULL,
	`error_json` text DEFAULT '[]' NOT NULL,
	`user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `migration_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "migration_rows_row_number_check" CHECK("migration_rows"."row_number" > 0),
	CONSTRAINT "migration_rows_status_check" CHECK("migration_rows"."status" in ('pending', 'valid', 'imported', 'skipped', 'collision', 'failed', 'rolled_back'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `migration_rows_run_row_idx` ON `migration_rows` (`run_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `migration_rows_run_status_idx` ON `migration_rows` (`run_id`,`status`);--> statement-breakpoint
CREATE INDEX `migration_rows_legacy_id_idx` ON `migration_rows` (`legacy_id`);--> statement-breakpoint
CREATE INDEX `migration_rows_identifier_idx` ON `migration_rows` (`identifier`);--> statement-breakpoint
CREATE INDEX `migration_rows_user_idx` ON `migration_rows` (`user_id`);--> statement-breakpoint
CREATE TABLE `migration_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_type` text NOT NULL,
	`source_name` text NOT NULL,
	`source_checksum` text NOT NULL,
	`started_by` text NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`completed_at` text,
	`rolled_back_at` text,
	`rolled_back_by` text,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rolled_back_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "migration_runs_mode_check" CHECK("migration_runs"."mode" in ('dry_run', 'import')),
	CONSTRAINT "migration_runs_status_check" CHECK("migration_runs"."status" in ('pending', 'running', 'completed', 'completed_with_errors', 'failed', 'rolled_back')),
	CONSTRAINT "migration_runs_source_type_check" CHECK("migration_runs"."source_type" in ('csv', 'json'))
);
--> statement-breakpoint
CREATE INDEX `migration_runs_status_created_idx` ON `migration_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `migration_runs_source_checksum_idx` ON `migration_runs` (`source_checksum`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`granted` integer DEFAULT false NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`user_id`, `kind`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "permissions_kind_check" CHECK("permissions"."kind" in ('upload_library', 'direct_publish', 'reset_student_password')),
	CONSTRAINT "permissions_granted_check" CHECK("permissions"."granted" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `permissions_kind_granted_idx` ON `permissions` (`kind`,`granted`);--> statement-breakpoint
CREATE TABLE `publication_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`activity_version_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`reviewer_id` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`reviewed_at` text,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_version_id`) REFERENCES `activity_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_reviews_state_check" CHECK("publication_reviews"."state" in ('pending', 'approved', 'rejected', 'unpublished', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_reviews_version_idx` ON `publication_reviews` (`activity_version_id`);--> statement-breakpoint
CREATE INDEX `publication_reviews_state_created_idx` ON `publication_reviews` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `publication_reviews_reviewer_idx` ON `publication_reviews` (`reviewer_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`bucket_key` text NOT NULL,
	`scope` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`bucket_key`, `scope`),
	CONSTRAINT "rate_limits_scope_check" CHECK("rate_limits"."scope" in ('login', 'upload')),
	CONSTRAINT "rate_limits_count_check" CHECK("rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `rate_limits_expires_idx` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`annotations_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "reviews_status_check" CHECK("reviews"."status" in ('corrected', 'redo'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_submission_idx` ON `reviews` (`submission_id`);--> statement-breakpoint
CREATE INDEX `reviews_reviewer_created_idx` ON `reviews` (`reviewer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `saved_work` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`activity_version_id` text NOT NULL,
	`state_json` text DEFAULT '{}' NOT NULL,
	`annotations_json` text DEFAULT '[]' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`autosaved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_version_id`) REFERENCES `activity_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "saved_work_progress_check" CHECK("saved_work"."progress" between 0 and 100),
	CONSTRAINT "saved_work_status_check" CHECK("saved_work"."status" in ('draft', 'locked')),
	CONSTRAINT "saved_work_revision_check" CHECK("saved_work"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_work_assignment_student_idx` ON `saved_work` (`assignment_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `saved_work_student_status_idx` ON `saved_work` (`student_id`,`status`);--> statement-breakpoint
CREATE INDEX `saved_work_version_idx` ON `saved_work` (`activity_version_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`csrf_token_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `student_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`legacy_id` text,
	`temporary_password` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "student_profiles_temporary_password_check" CHECK("student_profiles"."temporary_password" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_profiles_legacy_id_idx` ON `student_profiles` (`legacy_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`saved_work_id` text NOT NULL,
	`activity_version_id` text NOT NULL,
	`attempt_number` integer DEFAULT 1 NOT NULL,
	`state_json` text NOT NULL,
	`annotations_json` text DEFAULT '[]' NOT NULL,
	`progress` integer DEFAULT 100 NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`saved_work_id`) REFERENCES `saved_work`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`activity_version_id`) REFERENCES `activity_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "submissions_attempt_check" CHECK("submissions"."attempt_number" > 0),
	CONSTRAINT "submissions_progress_check" CHECK("submissions"."progress" between 0 and 100),
	CONSTRAINT "submissions_status_check" CHECK("submissions"."status" in ('submitted', 'corrected', 'redo'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_assignment_student_attempt_idx` ON `submissions` (`assignment_id`,`student_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `submissions_student_status_idx` ON `submissions` (`student_id`,`status`);--> statement-breakpoint
CREATE INDEX `submissions_assignment_status_idx` ON `submissions` (`assignment_id`,`status`);--> statement-breakpoint
CREATE INDEX `submissions_saved_work_idx` ON `submissions` (`saved_work_id`);--> statement-breakpoint
CREATE TABLE `teacher_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `teacher_student_links` (
	`teacher_id` text NOT NULL,
	`student_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`teacher_id`, `student_id`),
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `teacher_student_links_student_idx` ON `teacher_student_links` (`student_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "units_active_check" CHECK("units"."active" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_collection_name_idx` ON `units` (`collection_id`,`name`);--> statement-breakpoint
CREATE INDEX `units_collection_active_order_idx` ON `units` (`collection_id`,`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_id` text,
	`r2_key` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`file_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`uploaded_bytes` integer DEFAULT 0 NOT NULL,
	`checksum_sha256` text,
	`validation_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "upload_sessions_file_type_check" CHECK("upload_sessions"."file_type" in ('html', 'zip')),
	CONSTRAINT "upload_sessions_file_size_check" CHECK("upload_sessions"."file_size" >= 0),
	CONSTRAINT "upload_sessions_uploaded_bytes_check" CHECK("upload_sessions"."uploaded_bytes" >= 0),
	CONSTRAINT "upload_sessions_status_check" CHECK("upload_sessions"."status" in ('uploading', 'validating', 'completed', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_sessions_r2_key_idx` ON `upload_sessions` (`r2_key`);--> statement-breakpoint
CREATE INDEX `upload_sessions_user_status_idx` ON `upload_sessions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `upload_sessions_expires_idx` ON `upload_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'chateau' NOT NULL,
	`text_size` text DEFAULT 'm' NOT NULL,
	`interface_scale` integer DEFAULT 100 NOT NULL,
	`density` text DEFAULT 'comfortable' NOT NULL,
	`reduced_transparency` integer DEFAULT false NOT NULL,
	`reduced_motion` integer DEFAULT false NOT NULL,
	`solid_contrast` integer DEFAULT false NOT NULL,
	`large_touch_targets` integer DEFAULT false NOT NULL,
	`reading_width` text DEFAULT 'standard' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_preferences_theme_check" CHECK("user_preferences"."theme" in ('chateau', 'nuit')),
	CONSTRAINT "user_preferences_text_size_check" CHECK("user_preferences"."text_size" in ('s', 'm', 'l')),
	CONSTRAINT "user_preferences_scale_check" CHECK("user_preferences"."interface_scale" between 75 and 150),
	CONSTRAINT "user_preferences_density_check" CHECK("user_preferences"."density" in ('compact', 'comfortable', 'spacious')),
	CONSTRAINT "user_preferences_reduced_transparency_check" CHECK("user_preferences"."reduced_transparency" in (0, 1)),
	CONSTRAINT "user_preferences_reduced_motion_check" CHECK("user_preferences"."reduced_motion" in (0, 1)),
	CONSTRAINT "user_preferences_solid_contrast_check" CHECK("user_preferences"."solid_contrast" in (0, 1)),
	CONSTRAINT "user_preferences_large_touch_targets_check" CHECK("user_preferences"."large_touch_targets" in (0, 1)),
	CONSTRAINT "user_preferences_reading_width_check" CHECK("user_preferences"."reading_width" in ('narrow', 'standard', 'wide'))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`created_by` text,
	`password_changed_at` text,
	`last_login_at` text,
	`deactivated_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('principal', 'teacher', 'student')),
	CONSTRAINT "users_active_check" CHECK("users"."active" in (0, 1)),
	CONSTRAINT "users_must_change_password_check" CHECK("users"."must_change_password" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_identifier_idx` ON `users` (`identifier`);--> statement-breakpoint
CREATE INDEX `users_role_active_idx` ON `users` (`role`,`active`);