import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["teacher", "student"] }).notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("users_username_idx").on(table.username)]);

export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  csrfToken: text("csrf_token").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("sessions_user_idx").on(table.userId)]);

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  r2Key: text("r2_key"),
  originalName: text("original_name"),
  contentType: text("content_type"),
  externalUrl: text("external_url"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
});

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  dueAt: text("due_at"),
  instructions: text("instructions").notNull().default(""),
  publishedAt: text("published_at").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
});

export const assignmentStudents = sqliteTable("assignment_students", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("assigned"),
  openedAt: text("opened_at"),
  completedAt: text("completed_at"),
}, (table) => [uniqueIndex("assignment_student_idx").on(table.assignmentId, table.studentId)]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  writing: text("writing"),
  r2Key: text("r2_key"),
  originalName: text("original_name"),
  contentType: text("content_type"),
  submittedAt: text("submitted_at").notNull(),
  feedback: text("feedback"),
  correctedR2Key: text("corrected_r2_key"),
  correctedAt: text("corrected_at"),
}, (table) => [uniqueIndex("submission_assignment_student_idx").on(table.assignmentId, table.studentId)]);

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
});
