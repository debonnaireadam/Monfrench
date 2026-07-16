import test from "node:test";
import assert from "node:assert/strict";
import { collectTextFiles, combinedSource, readRepoFile } from "./helpers/source-tree.mjs";

const productFiles = collectTextFiles(["app", "lib", "worker", "db", "docs", "tools", ".openai", "package.json", "README.md"]);
const productSource = combinedSource(productFiles);

test("product files use Château de verre and Nuit parisienne without legacy design names", () => {
  const violations = [];
  const forbiddenLegacyName = /apple[\s_-]*glass|(["'`])verre\1|\b(?:th|theme)[-_ ]verre\b|\bGlassbook\b|\bPellucide\b|teacher-apps|private-apps|\brole\s*[:=]{1,3}\s*(["'`])owner\2/i;
  for (const file of productFiles) {
    if (forbiddenLegacyName.test(file.path) || forbiddenLegacyName.test(file.text)) violations.push(file.path);
  }
  assert.deepEqual(violations, [], `legacy design naming remains in: ${violations.join(", ")}`);
  assert.match(productSource, /Château de verre/);
  assert.match(productSource, /Nuit parisienne/);
});

test("all five primary interfaces have concrete product markers", () => {
  const markers = {
    login: [/name=["']identifier["']/, /name=["']password["']/],
    teacherDashboard: [/Teacher(?:Home|Dashboard)|teacher-dashboard/i, /Accueil/, /Élèves/],
    studentDashboard: [/Student(?:Home|Dashboard)|student-dashboard/i, /À faire/, /Envoyé/, /Corrigé/, /À refaire/],
    library: [/function\s+Library|library-interface|library-view/i, /Bibliothèque/, /Aperçu|Preview/, /Assigner|Assign/],
    activityViewer: [/function\s+Viewer|ActivityViewer|activity-viewer/i, /Retour|Back/, /Enregistré|Save/, /Soumettre|Submit/],
  };
  for (const [name, patterns] of Object.entries(markers)) {
    for (const pattern of patterns) assert.match(productSource, pattern, `${name} is missing ${pattern}`);
  }
});

test("the schema declares every required greenfield Château de verre entity", () => {
  const schema = readRepoFile("db/schema.ts");
  const requiredTables = [
    "users",
    "teacher_profiles",
    "student_profiles",
    "groups",
    "group_memberships",
    "teacher_student_links",
    "permissions",
    "categories",
    "collections",
    "units",
    "activities",
    "activity_versions",
    "publication_reviews",
    "assignments",
    "assignment_recipients",
    "saved_work",
    "submissions",
    "reviews",
    "user_preferences",
    "audit_events",
    "migration_runs",
    "migration_rows",
  ];
  const missing = requiredTables.filter((table) => !new RegExp(`sqliteTable\\(\\s*["']${table}["']`).test(schema));
  assert.deepEqual(missing, [], `missing required schema tables: ${missing.join(", ")}`);
});

test("the student import surface defaults to dry-run and refuses an unconfigured apply", () => {
  const importer = readRepoFile("tools/import-students.mjs");
  assert.match(importer, /shouldApply\s*=\s*args\.includes\(["']--apply["']\)/);
  assert.match(importer, /planStudentImport\(rows\)/);
  assert.match(importer, /row|results/i);
  assert.match(importer, /--apply requires --endpoint or MONFRENCH_STAGING_URL/i);
  assert.match(importer, /Production migration is intentionally blocked/i);
  assert.match(importer, /process\.exit\(3\)/);
  assert.doesNotMatch(importer, /assignments|activities|messages|progress/i);
});

test("the portal migration keeps generated passwords out of persisted payloads and restores optional ownership", () => {
  const portalRoute = readRepoFile("app/api/portal/route.ts");
  const migrationHandler = portalRoute.slice(portalRoute.indexOf("async function handleMigration"));
  assert.doesNotMatch(migrationHandler, /temporary_password\s*:/i);
  assert.match(migrationHandler, /INSERT INTO teacher_student_links/);
  assert.match(migrationHandler, /INSERT INTO group_memberships/);
});

test("the portal returns resumable student state and immutable submitted state", () => {
  const portalRoute = readRepoFile("app/api/portal/route.ts");
  assert.match(portalRoute, /savedWork\s*=.*state_json/);
  assert.match(portalRoute, /submitted_state_json/);
});

test("portal password hashing fails closed without the server-side pepper", () => {
  const portalRoute = readRepoFile("app/api/portal/route.ts");
  assert.match(portalRoute, /if\s*\(!pepper\)\s*throw new Error/);
  assert.doesNotMatch(portalRoute, /PASSWORD_PEPPER\s*\?\?\s*["']{2}/);
});
