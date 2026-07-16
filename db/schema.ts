import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "teacher", "student"] }).notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  uploadPermission: text("upload_permission", { enum: ["none", "review", "immediate"] }).notNull().default("none"),
  folderId: text("folder_id"),
  createdBy: text("created_by"),
  deactivatedAt: text("deactivated_at"),
  archivedAt: text("archived_at"),
  trashedAt: text("trashed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
}, (table) => [
  uniqueIndex("users_username_idx").on(table.username),
  index("users_role_active_idx").on(table.role, table.active),
  index("users_folder_idx").on(table.folderId),
]);

export const teacherStudents = sqliteTable("teacher_students", {
  studentId: text("student_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  teacherId: text("teacher_id").notNull().references(() => users.id),
  assignedAt: text("assigned_at").notNull(),
  assignedBy: text("assigned_by").notNull().references(() => users.id),
}, (table) => [index("teacher_students_teacher_idx").on(table.teacherId)]);

export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  csrfToken: text("csrf_token").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("sessions_user_idx").on(table.userId)]);

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope", { enum: ["activities", "assignments", "corrections", "students", "student"] }).notNull(),
  parentId: text("parent_id"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  archivedAt: text("archived_at"),
  trashedAt: text("trashed_at"),
}, (table) => [
  index("folders_scope_parent_idx").on(table.scope, table.parentId),
  index("folders_creator_idx").on(table.createdBy),
]);

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  // Legacy file columns remain during the compatibility transition. New reads
  // and writes use the immutable activity_versions row selected below.
  r2Key: text("r2_key"),
  originalName: text("original_name"),
  contentType: text("content_type"),
  externalUrl: text("external_url"),
  currentVersionId: text("current_version_id"),
  folderId: text("folder_id"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  archivedAt: text("archived_at"),
  trashedAt: text("trashed_at"),
  publicationStatus: text("publication_status", { enum: ["pending", "published"] }).notNull().default("published"),
}, (table) => [
  index("activities_creator_idx").on(table.createdBy),
  index("activities_folder_idx").on(table.folderId),
  index("activities_current_version_idx").on(table.currentVersionId),
]);

export const activityVersions = sqliteTable("activity_versions", {
  id: text("id").primaryKey(),
  activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  r2Key: text("r2_key"),
  originalName: text("original_name"),
  contentType: text("content_type"),
  externalUrl: text("external_url"),
  fileSize: integer("file_size").notNull().default(0),
  runtimeKind: text("runtime_kind", { enum: ["generic", "glassbook", "pellucide"] }).notNull().default("generic"),
  onlineCapable: integer("online_capable", { mode: "boolean" }).notNull().default(false),
  manifestVersion: integer("manifest_version").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("activity_versions_number_idx").on(table.activityId, table.versionNumber),
  index("activity_versions_activity_idx").on(table.activityId),
  index("activity_versions_r2_idx").on(table.r2Key),
]);

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  // Keep the legacy cascade declaration so this migration can add the new
  // columns in place. Permanent deletion is still guarded in the API whenever
  // an activity has an assignment, so the cascade is never used by normal
  // portal operations.
  activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  activityVersionId: text("activity_version_id").references(() => activityVersions.id),
  folderId: text("folder_id"),
  dueAt: text("due_at"),
  instructions: text("instructions").notNull().default(""),
  status: text("status", { enum: ["published", "paused", "cancelled"] }).notNull().default("published"),
  publishedAt: text("published_at").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  updatedAt: text("updated_at"),
  archivedAt: text("archived_at"),
  trashedAt: text("trashed_at"),
}, (table) => [
  index("assignments_creator_idx").on(table.createdBy),
  index("assignments_activity_idx").on(table.activityId),
  index("assignments_version_idx").on(table.activityVersionId),
  index("assignments_folder_idx").on(table.folderId),
]);

export const assignmentStudents = sqliteTable("assignment_students", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("assigned"),
  assignedAt: text("assigned_at"),
  openedAt: text("opened_at"),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("assignment_student_idx").on(table.assignmentId, table.studentId),
  index("assignment_students_student_idx").on(table.studentId),
]);

export const studentAssignmentFolders = sqliteTable("student_assignment_folders", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("student_assignment_folder_idx").on(table.assignmentId, table.studentId),
  index("student_assignment_folder_student_idx").on(table.studentId, table.folderId),
]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  folderId: text("folder_id"),
  writing: text("writing"),
  r2Key: text("r2_key"),
  originalName: text("original_name"),
  contentType: text("content_type"),
  fileSize: integer("file_size").notNull().default(0),
  submittedAt: text("submitted_at").notNull(),
  feedback: text("feedback"),
  correctedR2Key: text("corrected_r2_key"),
  correctedOriginalName: text("corrected_original_name"),
  correctedContentType: text("corrected_content_type"),
  correctedFileSize: integer("corrected_file_size").notNull().default(0),
  correctedAt: text("corrected_at"),
  updatedAt: text("updated_at"),
  archivedAt: text("archived_at"),
  trashedAt: text("trashed_at"),
}, (table) => [
  uniqueIndex("submission_assignment_student_idx").on(table.assignmentId, table.studentId),
  index("submissions_student_idx").on(table.studentId),
  index("submissions_folder_idx").on(table.folderId),
]);

// Reserved now so Glassbook/Pellucide can later save authoritative online
// drafts without another ownership/security migration.
export const studentWork = sqliteTable("student_work", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["draft", "submitted", "locked"] }).notNull().default("draft"),
  stateR2Key: text("state_r2_key"),
  stateSize: integer("state_size").notNull().default(0),
  stateVersion: integer("state_version").notNull().default(0),
  finalPdfR2Key: text("final_pdf_r2_key"),
  finalPdfOriginalName: text("final_pdf_original_name"),
  finalPdfContentType: text("final_pdf_content_type"),
  finalPdfSize: integer("final_pdf_size").notNull().default(0),
  savedAt: text("saved_at"),
  submittedAt: text("submitted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
}, (table) => [
  uniqueIndex("student_work_assignment_student_idx").on(table.assignmentId, table.studentId),
  index("student_work_student_idx").on(table.studentId),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("audit_events_created_idx").on(table.createdAt),
  index("audit_events_actor_idx").on(table.actorId),
]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull(),
});

export const uploadSessions = sqliteTable("upload_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activityId: text("activity_id").notNull(),
  versionId: text("version_id").notNull(),
  r2Key: text("r2_key").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  folderId: text("folder_id"),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  partCount: integer("part_count").notNull(),
  status: text("status", { enum: ["uploading", "assembling", "completed"] }).notNull().default("uploading"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("upload_sessions_activity_idx").on(table.activityId),
  index("upload_sessions_user_status_idx").on(table.userId, table.status),
  index("upload_sessions_expiry_idx").on(table.expiresAt),
]);

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
});
