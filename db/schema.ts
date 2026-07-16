import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["principal", "teacher", "student"] }).notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").references((): AnySQLiteColumn => users.id, { onDelete: "set null" }),
  passwordChangedAt: text("password_changed_at"),
  lastLoginAt: text("last_login_at"),
  deactivatedAt: text("deactivated_at"),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  uniqueIndex("users_identifier_idx").on(table.identifier),
  index("users_role_active_idx").on(table.role, table.active),
  check("users_role_check", sql`${table.role} in ('principal', 'teacher', 'student')`),
  check("users_active_check", sql`${table.active} in (0, 1)`),
  check("users_must_change_password_check", sql`${table.mustChangePassword} in (0, 1)`),
]);

export const teacherProfiles = sqliteTable("teacher_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
});

export const studentProfiles = sqliteTable("student_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  legacyId: text("legacy_id"),
  temporaryPassword: integer("temporary_password", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  uniqueIndex("student_profiles_legacy_id_idx").on(table.legacyId),
  check("student_profiles_temporary_password_check", sql`${table.temporaryPassword} in (0, 1)`),
]);

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  teacherId: text("teacher_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
  archivedAt: text("archived_at"),
}, (table) => [
  uniqueIndex("groups_teacher_name_idx").on(table.teacherId, table.name),
  index("groups_teacher_active_idx").on(table.teacherId, table.active),
  check("groups_active_check", sql`${table.active} in (0, 1)`),
]);

export const groupMemberships = sqliteTable("group_memberships", {
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
  addedAt: text("added_at").notNull().default(utcNow),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.studentId], name: "group_memberships_pk" }),
  index("group_memberships_student_idx").on(table.studentId),
]);

export const teacherStudentLinks = sqliteTable("teacher_student_links", {
  teacherId: text("teacher_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(utcNow),
}, (table) => [
  primaryKey({ columns: [table.teacherId, table.studentId], name: "teacher_student_links_pk" }),
  index("teacher_student_links_student_idx").on(table.studentId),
]);

export const permissions = sqliteTable("permissions", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", {
    enum: ["upload_library", "direct_publish", "reset_student_password"],
  }).notNull(),
  granted: integer("granted", { mode: "boolean" }).notNull().default(false),
  grantedBy: text("granted_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  primaryKey({ columns: [table.userId, table.kind], name: "permissions_pk" }),
  index("permissions_kind_granted_idx").on(table.kind, table.granted),
  check(
    "permissions_kind_check",
    sql`${table.kind} in ('upload_library', 'direct_publish', 'reset_student_password')`,
  ),
  check("permissions_granted_check", sql`${table.granted} in (0, 1)`),
]);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
  archivedAt: text("archived_at"),
}, (table) => [
  uniqueIndex("categories_name_idx").on(table.name),
  index("categories_active_order_idx").on(table.active, table.sortOrder),
  check("categories_active_check", sql`${table.active} in (0, 1)`),
]);

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
  archivedAt: text("archived_at"),
}, (table) => [
  uniqueIndex("collections_category_name_idx").on(table.categoryId, table.name),
  index("collections_category_active_order_idx").on(table.categoryId, table.active, table.sortOrder),
  check("collections_active_check", sql`${table.active} in (0, 1)`),
]);

export const units = sqliteTable("units", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id").notNull().references(() => collections.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
  archivedAt: text("archived_at"),
}, (table) => [
  uniqueIndex("units_collection_name_idx").on(table.collectionId, table.name),
  index("units_collection_active_order_idx").on(table.collectionId, table.active, table.sortOrder),
  check("units_active_check", sql`${table.active} in (0, 1)`),
]);

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => units.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  level: text("level").notNull().default(""),
  description: text("description").notNull().default(""),
  currentVersionId: text("current_version_id").references(
    (): AnySQLiteColumn => activityVersions.id,
    { onDelete: "set null" },
  ),
  publicationStatus: text("publication_status", {
    enum: ["draft", "pending_review", "published", "rejected", "unpublished", "archived"],
  }).notNull().default("draft"),
  authorId: text("author_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
  publishedAt: text("published_at"),
  archivedAt: text("archived_at"),
}, (table) => [
  index("activities_unit_status_idx").on(table.unitId, table.publicationStatus),
  index("activities_author_idx").on(table.authorId),
  index("activities_current_version_idx").on(table.currentVersionId),
  check(
    "activities_publication_status_check",
    sql`${table.publicationStatus} in ('draft', 'pending_review', 'published', 'rejected', 'unpublished', 'archived')`,
  ),
]);

export const activityVersions = sqliteTable("activity_versions", {
  id: text("id").primaryKey(),
  activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  r2Key: text("r2_key").notNull(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  fileType: text("file_type", { enum: ["html", "zip"] }).notNull(),
  fileSize: integer("file_size").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  validationJson: text("validation_json").notNull().default("{}"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(utcNow),
}, (table) => [
  uniqueIndex("activity_versions_number_idx").on(table.activityId, table.versionNumber),
  uniqueIndex("activity_versions_r2_key_idx").on(table.r2Key),
  index("activity_versions_created_by_idx").on(table.createdBy),
  check("activity_versions_number_check", sql`${table.versionNumber} > 0`),
  check("activity_versions_file_type_check", sql`${table.fileType} in ('html', 'zip')`),
  check("activity_versions_file_size_check", sql`${table.fileSize} >= 0`),
]);

export const publicationReviews = sqliteTable("publication_reviews", {
  id: text("id").primaryKey(),
  activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  activityVersionId: text("activity_version_id").notNull().references(() => activityVersions.id, { onDelete: "cascade" }),
  requestedBy: text("requested_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  reviewerId: text("reviewer_id").references(() => users.id, { onDelete: "restrict" }),
  state: text("state", {
    enum: ["pending", "approved", "rejected", "unpublished", "archived"],
  }).notNull().default("pending"),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(utcNow),
  reviewedAt: text("reviewed_at"),
}, (table) => [
  uniqueIndex("publication_reviews_version_idx").on(table.activityVersionId),
  index("publication_reviews_state_created_idx").on(table.state, table.createdAt),
  index("publication_reviews_reviewer_idx").on(table.reviewerId),
  check(
    "publication_reviews_state_check",
    sql`${table.state} in ('pending', 'approved', 'rejected', 'unpublished', 'archived')`,
  ),
]);

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "restrict" }),
  activityVersionId: text("activity_version_id").notNull().references(() => activityVersions.id, { onDelete: "restrict" }),
  assignedBy: text("assigned_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  dueAt: text("due_at"),
  instructions: text("instructions").notNull().default(""),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
  archivedAt: text("archived_at"),
}, (table) => [
  index("assignments_activity_idx").on(table.activityId),
  index("assignments_version_idx").on(table.activityVersionId),
  index("assignments_teacher_status_idx").on(table.assignedBy, table.status),
  index("assignments_due_idx").on(table.dueAt),
  check("assignments_status_check", sql`${table.status} in ('active', 'archived')`),
]);

export const assignmentRecipients = sqliteTable("assignment_recipients", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  recipientType: text("recipient_type", { enum: ["student", "group"] }).notNull(),
  studentId: text("student_id").references(() => users.id, { onDelete: "cascade" }),
  groupId: text("group_id").references(() => groups.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(utcNow),
}, (table) => [
  uniqueIndex("assignment_recipients_student_idx").on(table.assignmentId, table.studentId),
  uniqueIndex("assignment_recipients_group_idx").on(table.assignmentId, table.groupId),
  index("assignment_recipients_student_lookup_idx").on(table.studentId, table.assignmentId),
  index("assignment_recipients_group_lookup_idx").on(table.groupId, table.assignmentId),
  check("assignment_recipients_type_check", sql`${table.recipientType} in ('student', 'group')`),
  check(
    "assignment_recipients_target_check",
    sql`(
      (${table.recipientType} = 'student' and ${table.studentId} is not null and ${table.groupId} is null)
      or
      (${table.recipientType} = 'group' and ${table.groupId} is not null and ${table.studentId} is null)
    )`,
  ),
]);

export const savedWork = sqliteTable("saved_work", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activityVersionId: text("activity_version_id").notNull().references(() => activityVersions.id, { onDelete: "restrict" }),
  stateJson: text("state_json").notNull().default("{}"),
  annotationsJson: text("annotations_json").notNull().default("[]"),
  progress: integer("progress").notNull().default(0),
  status: text("status", { enum: ["draft", "locked"] }).notNull().default("draft"),
  revision: integer("revision").notNull().default(0),
  autosavedAt: text("autosaved_at"),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  uniqueIndex("saved_work_assignment_student_idx").on(table.assignmentId, table.studentId),
  index("saved_work_student_status_idx").on(table.studentId, table.status),
  index("saved_work_version_idx").on(table.activityVersionId),
  check("saved_work_progress_check", sql`${table.progress} between 0 and 100`),
  check("saved_work_status_check", sql`${table.status} in ('draft', 'locked')`),
  check("saved_work_revision_check", sql`${table.revision} >= 0`),
]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "restrict" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  savedWorkId: text("saved_work_id").notNull().references(() => savedWork.id, { onDelete: "restrict" }),
  activityVersionId: text("activity_version_id").notNull().references(() => activityVersions.id, { onDelete: "restrict" }),
  attemptNumber: integer("attempt_number").notNull().default(1),
  stateJson: text("state_json").notNull(),
  annotationsJson: text("annotations_json").notNull().default("[]"),
  progress: integer("progress").notNull().default(100),
  status: text("status", { enum: ["submitted", "corrected", "redo"] }).notNull().default("submitted"),
  submittedAt: text("submitted_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  uniqueIndex("submissions_assignment_student_attempt_idx").on(
    table.assignmentId,
    table.studentId,
    table.attemptNumber,
  ),
  index("submissions_student_status_idx").on(table.studentId, table.status),
  index("submissions_assignment_status_idx").on(table.assignmentId, table.status),
  index("submissions_saved_work_idx").on(table.savedWorkId),
  check("submissions_attempt_check", sql`${table.attemptNumber} > 0`),
  check("submissions_progress_check", sql`${table.progress} between 0 and 100`),
  check("submissions_status_check", sql`${table.status} in ('submitted', 'corrected', 'redo')`),
]);

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  reviewerId: text("reviewer_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: text("status", { enum: ["corrected", "redo"] }).notNull(),
  note: text("note").notNull().default(""),
  annotationsJson: text("annotations_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  uniqueIndex("reviews_submission_idx").on(table.submissionId),
  index("reviews_reviewer_created_idx").on(table.reviewerId, table.createdAt),
  check("reviews_status_check", sql`${table.status} in ('corrected', 'redo')`),
]);

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme", { enum: ["chateau", "nuit"] }).notNull().default("chateau"),
  textSize: text("text_size", { enum: ["s", "m", "l"] }).notNull().default("m"),
  interfaceScale: integer("interface_scale").notNull().default(100),
  density: text("density", { enum: ["compact", "comfortable", "spacious"] }).notNull().default("comfortable"),
  reducedTransparency: integer("reduced_transparency", { mode: "boolean" }).notNull().default(false),
  reducedMotion: integer("reduced_motion", { mode: "boolean" }).notNull().default(false),
  solidContrast: integer("solid_contrast", { mode: "boolean" }).notNull().default(false),
  largeTouchTargets: integer("large_touch_targets", { mode: "boolean" }).notNull().default(false),
  readingWidth: text("reading_width", { enum: ["narrow", "standard", "wide"] }).notNull().default("standard"),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  check("user_preferences_theme_check", sql`${table.theme} in ('chateau', 'nuit')`),
  check("user_preferences_text_size_check", sql`${table.textSize} in ('s', 'm', 'l')`),
  check("user_preferences_scale_check", sql`${table.interfaceScale} between 75 and 150`),
  check("user_preferences_density_check", sql`${table.density} in ('compact', 'comfortable', 'spacious')`),
  check("user_preferences_reduced_transparency_check", sql`${table.reducedTransparency} in (0, 1)`),
  check("user_preferences_reduced_motion_check", sql`${table.reducedMotion} in (0, 1)`),
  check("user_preferences_solid_contrast_check", sql`${table.solidContrast} in (0, 1)`),
  check("user_preferences_large_touch_targets_check", sql`${table.largeTouchTargets} in (0, 1)`),
  check("user_preferences_reading_width_check", sql`${table.readingWidth} in ('narrow', 'standard', 'wide')`),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull().default(utcNow),
}, (table) => [
  index("audit_events_actor_created_idx").on(table.actorId, table.createdAt),
  index("audit_events_entity_idx").on(table.entityType, table.entityId),
  index("audit_events_created_idx").on(table.createdAt),
]);

export const migrationRuns = sqliteTable("migration_runs", {
  id: text("id").primaryKey(),
  mode: text("mode", { enum: ["dry_run", "import"] }).notNull(),
  status: text("status", {
    enum: ["pending", "running", "completed", "completed_with_errors", "failed", "rolled_back"],
  }).notNull().default("pending"),
  sourceType: text("source_type", { enum: ["csv", "json"] }).notNull(),
  sourceName: text("source_name").notNull(),
  sourceChecksum: text("source_checksum").notNull(),
  startedBy: text("started_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  summaryJson: text("summary_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(utcNow),
  completedAt: text("completed_at"),
  rolledBackAt: text("rolled_back_at"),
  rolledBackBy: text("rolled_back_by").references(() => users.id, { onDelete: "restrict" }),
}, (table) => [
  index("migration_runs_status_created_idx").on(table.status, table.createdAt),
  index("migration_runs_source_checksum_idx").on(table.sourceChecksum),
  check("migration_runs_mode_check", sql`${table.mode} in ('dry_run', 'import')`),
  check(
    "migration_runs_status_check",
    sql`${table.status} in ('pending', 'running', 'completed', 'completed_with_errors', 'failed', 'rolled_back')`,
  ),
  check("migration_runs_source_type_check", sql`${table.sourceType} in ('csv', 'json')`),
]);

export const migrationRows = sqliteTable("migration_rows", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => migrationRuns.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  legacyId: text("legacy_id").notNull(),
  identifier: text("identifier").notNull(),
  status: text("status", {
    enum: ["pending", "valid", "imported", "skipped", "collision", "failed", "rolled_back"],
  }).notNull().default("pending"),
  payloadJson: text("payload_json").notNull(),
  errorJson: text("error_json").notNull().default("[]"),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  uniqueIndex("migration_rows_run_row_idx").on(table.runId, table.rowNumber),
  index("migration_rows_run_status_idx").on(table.runId, table.status),
  index("migration_rows_legacy_id_idx").on(table.legacyId),
  index("migration_rows_identifier_idx").on(table.identifier),
  index("migration_rows_user_idx").on(table.userId),
  check("migration_rows_row_number_check", sql`${table.rowNumber} > 0`),
  check(
    "migration_rows_status_check",
    sql`${table.status} in ('pending', 'valid', 'imported', 'skipped', 'collision', 'failed', 'rolled_back')`,
  ),
]);

export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  csrfTokenHash: text("csrf_token_hash").notNull(),
  createdAt: text("created_at").notNull().default(utcNow),
  lastSeenAt: text("last_seen_at").notNull().default(utcNow),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [
  index("sessions_user_idx").on(table.userId),
  index("sessions_expires_idx").on(table.expiresAt),
]);

export const rateLimits = sqliteTable("rate_limits", {
  bucketKey: text("bucket_key").notNull(),
  scope: text("scope", { enum: ["login", "upload"] }).notNull(),
  count: integer("count").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull().default(utcNow),
  expiresAt: text("expires_at").notNull(),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  primaryKey({ columns: [table.bucketKey, table.scope], name: "rate_limits_pk" }),
  index("rate_limits_expires_idx").on(table.expiresAt),
  check("rate_limits_scope_check", sql`${table.scope} in ('login', 'upload')`),
  check("rate_limits_count_check", sql`${table.count} >= 0`),
]);

export const uploadSessions = sqliteTable("upload_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
  r2Key: text("r2_key").notNull(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  fileType: text("file_type", { enum: ["html", "zip"] }).notNull(),
  fileSize: integer("file_size").notNull(),
  uploadedBytes: integer("uploaded_bytes").notNull().default(0),
  checksumSha256: text("checksum_sha256"),
  validationJson: text("validation_json").notNull().default("{}"),
  status: text("status", {
    enum: ["uploading", "validating", "completed", "failed", "expired"],
  }).notNull().default("uploading"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(utcNow),
  updatedAt: text("updated_at").notNull().default(utcNow),
}, (table) => [
  uniqueIndex("upload_sessions_r2_key_idx").on(table.r2Key),
  index("upload_sessions_user_status_idx").on(table.userId, table.status),
  index("upload_sessions_expires_idx").on(table.expiresAt),
  check("upload_sessions_file_type_check", sql`${table.fileType} in ('html', 'zip')`),
  check("upload_sessions_file_size_check", sql`${table.fileSize} >= 0`),
  check("upload_sessions_uploaded_bytes_check", sql`${table.uploadedBytes} >= 0`),
  check(
    "upload_sessions_status_check",
    sql`${table.status} in ('uploading', 'validating', 'completed', 'failed', 'expired')`,
  ),
]);
