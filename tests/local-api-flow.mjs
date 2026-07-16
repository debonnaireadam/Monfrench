import assert from "node:assert/strict";

const base = process.env.MONFRENCH_TEST_URL ?? "http://localhost:3001";
const setupCode = process.env.MONFRENCH_TEST_SETUP_CODE ?? "local-chateau-setup";
class Client {
  cookies = new Map();
  async request(path, { method = "GET", body, expected = 200 } = {}) {
    const headers = new Headers();
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const csrf = this.cookies.get("monfrench_csrf"); if (csrf && method !== "GET") headers.set("x-csrf-token", csrf);
    if (body && !(body instanceof FormData)) { headers.set("content-type", "application/json"); body = JSON.stringify(body); }
    const response = await fetch(`${base}${path}`, { method, headers, body });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const item of setCookies) { const [pair] = item.split(";"); const index = pair.indexOf("="); this.cookies.set(pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))); }
    const result = await response.json().catch(() => ({}));
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  }
  post(action, values = {}, expected = 200) { return this.request("/api/portal", { method: "POST", body: { action, ...values }, expected }); }
}
const principal = new Client(), teacher = new Client(), student = new Client();
const initial = await principal.request("/api/portal");
assert.equal(initial.setupRequired, true);
await principal.post("setup", { setup_code: setupCode, display_name: "Claire", identifier: "claire", password: "PrincipalPass!2" });
let principalPortal = await principal.request("/api/portal");
assert.equal(principalPortal.user.role, "principal");

const teacherCreated = await principal.post("create_user", { role: "teacher", display_name: "Marc", identifier: "marc", password: "TeacherPass!2" });
const studentCreated = await principal.post("create_user", { role: "student", display_name: "Amina", identifier: "amina", password: "x", teacher_id: teacherCreated.user_id });
await principal.post("create_group", { name: "Groupe Migration", teacher_id: teacherCreated.user_id });
await principal.post("set_permission", { user_id: teacherCreated.user_id, kind: "upload_library", granted: true });
await principal.post("set_permission", { user_id: teacherCreated.user_id, kind: "reset_student_password", granted: true });
await teacher.post("login", { identifier: "marc", password: "TeacherPass!2" });
const teacherPortal = await teacher.request("/api/portal");
assert.equal(teacherPortal.permissions.upload, true);

const activityForm = new FormData();
activityForm.set("action", "create_activity"); activityForm.set("title", "Écouter au marché"); activityForm.set("description", "Activité de compréhension"); activityForm.set("category_id", teacherPortal.categories[0].id);
activityForm.set("file", new File([`<!doctype html><html lang="fr"><body><label>Réponse <input id="answer"></label><script>parent.postMessage({type:'monfrench-ready'},'*');answer.oninput=()=>parent.postMessage({type:'monfrench-save',state:{answer:answer.value}},'*');</script></body></html>`], "marche.html", { type: "text/html" }));
const uploaded = await teacher.request("/api/portal", { method: "POST", body: activityForm });
assert.equal(uploaded.publication_status, "pending_review");

principalPortal = await principal.request("/api/portal");
const publication = principalPortal.publicationReviews.find(row => row.activity_id === uploaded.activity_id);
assert.ok(publication);
await principal.post("review_publication", { publication_review_id: publication.id, decision: "approved" });
await principal.post("set_permission", { user_id: teacherCreated.user_id, kind: "direct_publish", granted: true });
const directForm = new FormData();
directForm.set("action", "create_activity"); directForm.set("title", "Vocabulaire en ville"); directForm.set("description", "Publication directe autorisée"); directForm.set("category_id", teacherPortal.categories[0].id);
directForm.set("file", new File(["<!doctype html><html lang=\"fr\"><body>Vocabulaire</body></html>"], "ville.html", { type: "text/html" }));
const directUpload = await teacher.request("/api/portal", { method: "POST", body: directForm });
assert.equal(directUpload.publication_status, "published");
const firstAssignment = await principal.post("create_assignment", { activity_id: uploaded.activity_id, activity_version_id: uploaded.version_id, student_ids: [studentCreated.user_id] });

await student.post("login", { identifier: "amina", password: "x" });
let studentPortal = await student.request("/api/portal");
assert.ok(studentPortal.assignments.some(row => row.id === firstAssignment.assignment_id));
await student.post("save_preferences", { theme: "nuit", text_size: "l" });
await student.post("save_work", { assignment_id: firstAssignment.assignment_id, state: { answer: "des pommes" }, progress: 50 });
studentPortal = await student.request("/api/portal");
const firstSavedWork = studentPortal.savedWork.find(row => row.assignment_id === firstAssignment.assignment_id);
assert.ok(firstSavedWork);
assert.deepEqual(JSON.parse(firstSavedWork.state_json), { answer: "des pommes" });
await student.post("submit_work", { assignment_id: firstAssignment.assignment_id, state: { answer: "des pommes" }, progress: 100 });
await student.post("save_work", { assignment_id: firstAssignment.assignment_id, state: { answer: "modifié" } }, 409);

let teacherAfterSubmit = await teacher.request("/api/portal");
const firstSubmission = teacherAfterSubmit.submissions.find(row => row.assignment_id === firstAssignment.assignment_id);
assert.ok(firstSubmission);
assert.deepEqual(JSON.parse(firstSubmission.submitted_state_json), { answer: "des pommes" });
await teacher.post("review_submission", { submission_id: firstSubmission.id, decision: "corrected", feedback: "Très bien !" });
studentPortal = await student.request("/api/portal");
assert.equal(studentPortal.preferences.theme, "nuit");
assert.ok(studentPortal.submissions.some(row => row.id === firstSubmission.id && row.status === "corrected"));

const secondAssignment = await teacher.post("create_assignment", { activity_id: uploaded.activity_id, activity_version_id: uploaded.version_id, student_ids: [studentCreated.user_id] });
await student.post("save_work", { assignment_id: secondAssignment.assignment_id, state: { answer: "premier essai" }, progress: 60 });
await student.post("submit_work", { assignment_id: secondAssignment.assignment_id, state: { answer: "premier essai" }, progress: 100 });
teacherAfterSubmit = await teacher.request("/api/portal");
const redoSubmission = teacherAfterSubmit.submissions.find(row => row.assignment_id === secondAssignment.assignment_id);
assert.ok(redoSubmission);
await teacher.post("review_submission", { submission_id: redoSubmission.id, decision: "redo", feedback: "Revoir la réponse." });
await student.post("save_work", { assignment_id: secondAssignment.assignment_id, state: { answer: "deuxième essai" }, progress: 80 });
await student.post("submit_work", { assignment_id: secondAssignment.assignment_id, state: { answer: "deuxième essai" }, progress: 100 });

const migrationRows = [
  { legacy_id: "legacy-1", identifier: "yusuf", display_name: "Yusuf", active: true, teacher_identifier: "marc" },
  { legacy_id: "legacy-2", identifier: "lea", display_name: "Léa", active: true, group: "Groupe Migration" },
  { legacy_id: "", identifier: "x", display_name: "", active: false },
];
const dryRun = await principal.post("migration_dry_run", { source_name: "students.json", rows: migrationRows });
assert.equal(dryRun.summary.valid, 2); assert.equal(dryRun.summary.failed, 1);
const imported = await principal.post("migration_import", { source_name: "students.json", rows: migrationRows });
assert.equal(imported.summary.imported, 2);
const teacherAfterMigration = await teacher.request("/api/portal");
assert.ok(teacherAfterMigration.users.some(row => row.identifier === "yusuf"));
assert.ok(teacherAfterMigration.users.some(row => row.identifier === "lea"));
const repeated = await principal.post("migration_import", { source_name: "students.json", rows: migrationRows });
assert.equal(repeated.idempotent, true); assert.equal(repeated.run_id, imported.run_id);
const rolledBack = await principal.post("migration_rollback", { run_id: imported.run_id });
assert.equal(rolledBack.removed, 2);

console.log(JSON.stringify({ ok: true, workflow: ["setup", "accounts", "permissions", "upload_review", "upload_direct_publish", "assignment", "autosave", "submit_lock", "correction", "redo_resubmit", "preferences", "migration_dry_run_import_idempotency_rollback"] }, null, 2));
