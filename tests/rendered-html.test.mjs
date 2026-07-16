import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

async function applyMigration(db, path) {
  const sql = await readFile(path, "utf8");
  db.exec("BEGIN");
  try {
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("build contains the portal and protected API routes", async () => {
  await stat("dist/server/index.js");
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /Envoyer aux élèves/);
  assert.match(page, /Corbeille/);
  assert.match(page, /Corrections/);
  assert.match(page, /Accéder à l’activité en ligne/);
  assert.match(page, /setTab\(item\.tab\)/);
  assert.match(page, /teacher-section-grid/);
  assert.match(page, /teacher-home-link/);
  assert.doesNotMatch(page, /teacher-sidebar/);
  assert.match(page, /DisplaySettings/);
  assert.match(page, /monfrench-theme/);
  assert.match(page, /monfrench-display/);
  assert.match(page, /type="range"/);
  assert.match(page, /Personnaliser/);
  assert.match(page, /\+ Raccourci/);
  assert.match(page, /Clair/);
  assert.match(page, /Sombre/);
  assert.match(page, /activity-preview-button/);
  assert.ok((page.match(/label:"Aperçu"/g) || []).length >= 3);
  assert.match(page, /popup,width=1100,height=800/);
  assert.match(page, />Aperçu<\/button>/);
  assert.match(page, /compact onClose/);
  assert.match(page, /Dépôt multiple/);
  assert.match(page, /multiple onChange/);
  assert.match(page, /file\.name\.replace/);
  assert.match(page, /Description commune/);
  assert.match(page, /Consignes communes/);
  assert.match(page, /Google Drive ↔ MonFrench/);
  assert.match(page, /Télécharger l’activité/);
  assert.match(page, /Marquer comme révisé/);
  assert.doesNotMatch(page, /Joindre un fichier corrigé/);
  assert.match(page, /Voir l’espace de l’élève/);
});

test("authentication uses keyed password hashes, server sessions and CSRF", async () => {
  const route = await readFile("app/api/portal/route.ts", "utf8");
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(route, /PASSWORD_PEPPER/);
  assert.match(route, /HMAC/);
  assert.match(route, /secureEqual/);
  assert.match(route, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(route, /x-csrf-token/);
  assert.match(route, /siteverify/);
  assert.doesNotMatch(route, /password\.length\s*</);
  assert.doesNotMatch(page, /minLength=/);
  assert.match(route, /if\(!password\)/);
});

test("display preferences offer continuous typography controls and themes", async () => {
  const css = await readFile("app/globals.css", "utf8");
  assert.match(css, /--interface-scale/);
  assert.match(css, /--heading-scale/);
  assert.match(css, /--reading-scale/);
  assert.match(css, /--control-scale/);
  assert.match(css, /--spacing-scale/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /color-scheme: dark/);
});

test("private files require ownership or assignment access", async () => {
  const route = await readFile("app/api/file/route.ts", "utf8");
  assert.match(route, /assignment_students/);
  assert.match(route, /teacher_students/);
  assert.match(route, /staff\(user\)/);
  assert.match(route, /v\.id=a\.activity_version_id/);
  assert.match(route, /student_id=\?/);
  assert.match(route, /slice\("monfrench_session="\.length\)/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /const disposition = url\.searchParams\.get\("download"\).*"inline"/);
  assert.match(route, /sandbox allow-scripts allow-popups allow-downloads allow-forms allow-modals/);
});

test("large activity files use authenticated staged R2 uploads", async () => {
  const route = await readFile("app/api/portal/route.ts", "utf8");
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(route, /stagedUploadPrefix/);
  assert.match(route, /stagedPartKey/);
  assert.match(route, /upload_sessions/);
  assert.match(route, /request\.arrayBuffer\(\)/);
  assert.match(route, /new FixedLengthStream\(fileSize\)/);
  assert.match(route, /env\.FILES\.put\(key,fixed\.readable/);
  assert.match(route, /key\.startsWith\(`activities\/\$\{current\.id\}\//);
  assert.match(route, /complete_activity_upload/);
  assert.match(page, /chunkSize=512\*1024/);
  assert.match(page, /Content-Type":"application\/octet-stream/);
  assert.match(route, /uploadMode\(current\)==="none"/);
  assert.match(route, /update_teacher_upload_permission/);
  assert.match(route, /approve_activity/);
  assert.match(route, /publication_status='published'/);
});

test("roles, shared attribution, version pinning and safe deletion are present", async () => {
  const schema = await readFile("db/schema.ts", "utf8");
  const route = await readFile("app/api/portal/route.ts", "utf8");
  assert.match(schema, /enum: \["owner", "teacher", "student"\]/);
  assert.match(schema, /sqliteTable\("teacher_students"/);
  assert.match(schema, /sqliteTable\("activity_versions"/);
  assert.match(schema, /sqliteTable\("student_work"/);
  assert.match(schema, /sqliteTable\("audit_events"/);
  assert.match(route, /current\.role !== "owner"/);
  assert.match(route, /activity_version_id/);
  assert.match(route, /Suppression refusée/);
  assert.match(route, /storage_cleanup/);
  assert.match(route, /normalizedExternalUrl/);
  assert.match(route, /status='submitting'/);
  assert.match(route, /reopen_submission/);
  assert.match(route, /Transférez d’abord les élèves/);
});

test("login protection and client-side URL boundaries are wired", async () => {
  const route = await readFile("app/api/portal/route.ts", "utf8");
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(route, /login-ip:/);
  assert.match(route, /TURNSTILE_SECRET_KEY/);
  assert.match(page, /TURNSTILE_SITE_KEY|turnstileSiteKey/);
  assert.match(page, /challenges\.cloudflare\.com\/turnstile/);
  assert.match(page, /url\.protocol==="https:"&&!url\.username&&!url\.password/);
  assert.match(page, /activity_version_id\|\|a\.activity_id/);
});

test("the additive migration preserves existing assignments and submissions", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  await applyMigration(db, "drizzle/0000_nervous_wrecker.sql");
  db.exec(`
    INSERT INTO users(id,username,display_name,role,password_hash,password_salt,active,must_change_password,created_at)
      VALUES ('teacher-1','debonnaire','Debonnaire','teacher','hash','salt',1,0,'2026-01-01T00:00:00Z'),
             ('student-1','sveta','Sveta','student','hash','salt',1,0,'2026-01-02T00:00:00Z');
    INSERT INTO activities(id,title,category,description,instructions,r2_key,original_name,content_type,external_url,created_by,created_at)
      VALUES ('activity-1','Écoute','Écoute','','','activities/a.html','a.html','text/html',NULL,'teacher-1','2026-01-03T00:00:00Z');
    INSERT INTO assignments(id,activity_id,due_at,instructions,published_at,created_by)
      VALUES ('assignment-1','activity-1',NULL,'','2026-01-04T00:00:00Z','teacher-1');
    INSERT INTO assignment_students(assignment_id,student_id,status)
      VALUES ('assignment-1','student-1','submitted');
    INSERT INTO submissions(id,assignment_id,student_id,writing,r2_key,original_name,content_type,submitted_at)
      VALUES ('submission-1','assignment-1','student-1','Réponse','submissions/s.pdf','s.pdf','application/pdf','2026-01-05T00:00:00Z');
  `);
  await applyMigration(db, "drizzle/0001_wet_purple_man.sql");
  await applyMigration(db, "drizzle/0002_known_pandemic.sql");
  await applyMigration(db, "drizzle/0003_protected_debonnaire.sql");
  await applyMigration(db, "drizzle/0004_eager_human_fly.sql");
  await applyMigration(db, "drizzle/0005_upload_permissions.sql");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM assignments").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM assignment_students").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM submissions").get().count, 1);
  assert.equal(db.prepare("SELECT role FROM users WHERE username='debonnaire'").get().role, "owner");
  assert.equal(db.prepare("SELECT activity_version_id FROM assignments WHERE id='assignment-1'").get().activity_version_id, "legacy-activity-1");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM teacher_students WHERE student_id='student-1' AND teacher_id='teacher-1'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='upload_sessions'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='student_assignment_folders'").get().count, 1);
  assert.ok(db.prepare("PRAGMA table_info(submissions)").all().some(column => column.name === "corrected_original_name"));
  assert.equal(db.prepare("SELECT upload_permission FROM users WHERE id='teacher-1'").get().upload_permission, "none");
  assert.equal(db.prepare("SELECT publication_status FROM activities WHERE id='activity-1'").get().publication_status, "published");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM audit_events WHERE action='promote_owner' AND entity_id='teacher-1'").get().count, 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("owner promotion fails closed when the Debonnaire account is absent", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  await applyMigration(db, "drizzle/0000_nervous_wrecker.sql");
  db.exec(`INSERT INTO users(id,username,display_name,role,password_hash,password_salt,active,must_change_password,created_at)
    VALUES ('teacher-2','another-teacher','Another teacher','teacher','hash','salt',1,0,'2026-01-01T00:00:00Z')`);
  await applyMigration(db, "drizzle/0001_wet_purple_man.sql");
  await applyMigration(db, "drizzle/0002_known_pandemic.sql");
  await assert.rejects(() => applyMigration(db, "drizzle/0003_protected_debonnaire.sql"), /CHECK constraint failed/);
  assert.equal(db.prepare("SELECT role FROM users WHERE id='teacher-2'").get().role, "teacher");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name='monfrench_owner_promotion_guard_20260714'").get().count, 0);
  db.close();
});

test("Glassbook student exports can be saved into the activity library", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  const route = await readFile("app/api/teacher-apps/glassbook/route.ts", "utf8");
  const glassbookSource = await readFile("app/private-apps/glassbook2_teacher.html", "utf8");
  const glassbook = await stat("app/private-apps/glassbook2_teacher.html");
  assert.ok(glassbook.size > 2_000_000);
  assert.match(page, /tab:"apps",value:1/);
  assert.match(page, /\/api\/teacher-apps\/glassbook/);
  assert.match(page, /sandbox="allow-scripts allow-popups allow-downloads allow-forms allow-modals"/);
  assert.match(page, /monfrench:glassbook-build/);
  assert.match(page, /uploadActivityFile\(portal/);
  assert.match(page, /runtimeKind:"glassbook"/);
  assert.match(page, /monfrench:activity-connect/);
  assert.doesNotMatch(page, /build-submission-pdf/);
  assert.match(page, /save_progress/);
  assert.match(page, /Créer et enregistrer la version élève/);
  assert.match(route, /user\.role !== "owner" && user\.role !== "teacher"/);
  assert.match(route, /Content-Security-Policy/);
  assert.match(route, /Cache-Control": "private, no-store/);
  assert.match(glassbookSource, /monfrench:glassbook-connect/);
  assert.match(glassbookSource, /monfrench:glassbook-export/);
  assert.match(glassbookSource, /monfrench:teacher-connect/);
  assert.match(glassbookSource, /export-student-html/);
  assert.equal(createHash("sha256").update(glassbookSource).digest("hex").toUpperCase(), "A5E57F98DEB749DEF4067DDF5AE25785707CC739B0CBC8FBECCDE832441CBFB8");
});

test("Glassbook work is shared and completion creates no PDF", async () => {
  const route = await readFile("app/api/portal/route.ts", "utf8");
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(route, /complete_assignment/);
  assert.match(route, /INSERT INTO student_work/);
  assert.match(route, /glassbook\.student-state/);
  assert.match(route, /onlineCapable=runtimeKind==="glassbook"\?1:0/);
  assert.match(route, /UPDATE student_work SET status='submitted'/);
  assert.match(route, /expectedStateVersion/);
  assert.match(page, /teacherMode/);
  assert.match(page, /onlineGlassbook&&!readOnly/);
  assert.match(page, /Accéder à l’activité en ligne/);
  assert.match(page, /Travail terminé/);
  assert.doesNotMatch(page, /Faire l’activité en ligne/);
  assert.doesNotMatch(page, /build-submission-pdf/);
});

test("student folders, teacher preview and correction return are server-authorized", async () => {
  const route = await readFile("app/api/portal/route.ts", "utf8");
  const fileRoute = await readFile("app/api/file/route.ts", "utf8");
  assert.match(route, /create_student_folder/);
  assert.match(route, /move_student_assignment/);
  assert.match(route, /scope='student' AND created_by=\?/);
  assert.match(route, /view_student_space/);
  assert.match(route, /ownsStudent\(current,studentId\)/);
  assert.match(route, /return_correction/);
  assert.match(route, /corrected_original_name/);
  assert.match(route, /has_corrected_file/);
  assert.match(fileRoute, /s\.corrected_content_type/);
});

test("Google Drive access is teacher-only and uses a short-lived browser token", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  const route = await readFile("app/api/portal/route.ts", "utf8");
  assert.match(page, /initTokenClient/);
  assert.match(page, /https:\/\/www\.googleapis\.com\/auth\/drive/);
  assert.match(page, /application\/x-monfrench-transfer/);
  assert.match(page, /copyDriveToMon/);
  assert.match(page, /copyMonToDrive/);
  assert.match(route, /googleDriveClientId/);
  assert.doesNotMatch(route, /GOOGLE_DRIVE_CLIENT_SECRET/);
});
