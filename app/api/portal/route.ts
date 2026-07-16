import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type Role = "owner" | "teacher" | "student";
type User = { id: string; username: string; display_name: string; role: Role; must_change_password: number; upload_permission: "none"|"review"|"immediate" };
type Session = User & { csrf_token: string };
type Input = FormData | Record<string, unknown>;

const json = (value: unknown, status = 200, headers?: HeadersInit) => Response.json(value, { status, headers });
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const bytesToHex = (bytes: Uint8Array) => [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
const randomToken = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (value: string) => bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const staff = (user: Pick<User, "role">) => user.role === "owner" || user.role === "teacher";
const uploadMode = (user: Pick<User, "role"|"upload_permission">) => user.role === "owner" ? "immediate" : user.upload_permission;
const placeholders = (values: unknown[]) => values.map(() => "?").join(",");
const safeFileName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");
const categories = ["Grammaire", "Conjugaison", "Lecture", "Écoute", "Écriture"];
const folderScopes = ["activities", "assignments", "corrections", "students"];
const entityKinds = ["activity", "assignment", "submission", "student", "teacher", "folder"];
const MAX_STUDENT_STATE_BYTES = 25 * 1024 * 1024;

const get = (data: Input, key: string) => data instanceof FormData ? data.get(key) : data[key];
const has = (data: Input, key: string) => data instanceof FormData ? data.has(key) : Object.prototype.hasOwnProperty.call(data, key);
function ids(value: unknown) {
  let values = value;
  if (typeof values === "string" && values.startsWith("[")) { try { values = JSON.parse(values); } catch { values = []; } }
  const list: unknown[] = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(list.map(String).filter(Boolean))].slice(0, 500);
}
function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function normalizedExternalUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid");
    return url.toString();
  } catch { throw new Response("Le lien externe doit être une adresse HTTPS valide.", { status: 400 }); }
}

async function passwordHash(password: string, saltHex?: string) {
  const pepper = env.PASSWORD_PEPPER as string | undefined;
  if (!pepper) throw new Error("PASSWORD_PEPPER is unavailable");
  const salt = saltHex ?? bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${salt}:${password}`));
  return { hash: bytesToHex(new Uint8Array(result)), salt };
}

function cookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

async function session(request: Request): Promise<Session | null> {
  const token = cookie(request, "monfrench_session");
  if (!token) return null;
  return (await env.DB.prepare(`SELECT u.id,u.username,u.display_name,CASE WHEN lower(u.username)='debonnaire' AND u.role='teacher' THEN 'owner' ELSE u.role END role,u.must_change_password,u.upload_permission,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>? AND u.active=1 AND u.trashed_at IS NULL`).bind(await sha256(token), now()).first()) as Session | null;
}

async function requireSession(request: Request, required?: "staff" | Role) {
  const current = await session(request);
  if (!current || (required === "staff" ? !staff(current) : required && current.role !== required)) throw new Response("Non autorisé", { status: 401 });
  if (request.method !== "GET" && request.headers.get("x-csrf-token") !== current.csrf_token) throw new Response("Requête refusée", { status: 403 });
  return current;
}

async function turnstile(request: Request, token: string | null) {
  const secret = env.TURNSTILE_SECRET_KEY as string | undefined;
  if (!secret) return true;
  if (!token) return false;
  const body = new FormData(); body.set("secret", secret); body.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP"); if (ip) body.set("remoteip", ip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body }).then((response) => response.json()) as { success: boolean };
  return result.success;
}

async function audit(actor: Session, action: string, entityType: string, entityId?: string | null, details: Record<string, unknown> = {}) {
  await env.DB.prepare(`INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)`).bind(id(), actor.id, action, entityType, entityId ?? null, JSON.stringify(details), now()).run();
}

async function ownsStudent(current: Session, studentId: string) {
  if (current.role === "owner") return !!(await env.DB.prepare(`SELECT 1 ok FROM users WHERE id=? AND role='student'`).bind(studentId).first());
  return !!(await env.DB.prepare(`SELECT 1 ok FROM teacher_students ts JOIN users u ON u.id=ts.student_id WHERE ts.student_id=? AND ts.teacher_id=? AND u.role='student'`).bind(studentId, current.id).first());
}

async function owns(current: Session, kind: string, recordId: string) {
  if (current.role === "owner") return true;
  if (current.role !== "teacher") return false;
  if (kind === "activity") return !!(await env.DB.prepare(`SELECT 1 ok FROM activities WHERE id=? AND created_by=?`).bind(recordId, current.id).first());
  if (kind === "assignment") return !!(await env.DB.prepare(`SELECT 1 ok FROM assignments a WHERE a.id=? AND a.created_by=? AND NOT EXISTS(SELECT 1 FROM assignment_students ast LEFT JOIN teacher_students ts ON ts.student_id=ast.student_id WHERE ast.assignment_id=a.id AND COALESCE(ts.teacher_id,'')<>?)`).bind(recordId, current.id, current.id).first());
  if (kind === "submission") return !!(await env.DB.prepare(`SELECT 1 ok FROM submissions s JOIN teacher_students ts ON ts.student_id=s.student_id WHERE s.id=? AND ts.teacher_id=?`).bind(recordId, current.id).first());
  if (kind === "student") return ownsStudent(current, recordId);
  if (kind === "folder") return !!(await env.DB.prepare(`SELECT 1 ok FROM folders WHERE id=? AND created_by=?`).bind(recordId, current.id).first());
  return false;
}

const stagedUploadPrefix = (key: string, uploadId: string) => `${key}.upload-${uploadId}/`;
const stagedPartKey = (prefix: string, partNumber: number) => `${prefix}part-${String(partNumber).padStart(6, "0")}`;
async function deleteStagedUpload(prefix: string) {
  let cursor: string | undefined;
  do {
    const listed = await env.FILES.list({ prefix, cursor });
    if (listed.objects.length) await env.FILES.delete(listed.objects.map((object: { key: string }) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

async function storageSummary(current: Session) {
  const activity = current.role === "owner"
    ? await env.DB.prepare(`SELECT COALESCE(SUM(file_size),0) bytes,COUNT(*) files FROM (SELECT r2_key,MAX(file_size) file_size FROM activity_versions WHERE r2_key IS NOT NULL GROUP BY r2_key)`).first<{ bytes: number; files: number }>()
    : await env.DB.prepare(`SELECT COALESCE(SUM(file_size),0) bytes,COUNT(*) files FROM (SELECT r2_key,MAX(file_size) file_size FROM activity_versions WHERE r2_key IS NOT NULL AND created_by=? GROUP BY r2_key)`).bind(current.id).first<{ bytes: number; files: number }>();
  const submission = current.role === "owner"
    ? await env.DB.prepare(`SELECT COALESCE(SUM(s.file_size+s.corrected_file_size),0) bytes,SUM(CASE WHEN s.r2_key IS NOT NULL THEN 1 ELSE 0 END)+SUM(CASE WHEN s.corrected_r2_key IS NOT NULL THEN 1 ELSE 0 END) files FROM submissions s`).first<{ bytes: number; files: number }>()
    : await env.DB.prepare(`SELECT COALESCE(SUM(s.file_size+s.corrected_file_size),0) bytes,SUM(CASE WHEN s.r2_key IS NOT NULL THEN 1 ELSE 0 END)+SUM(CASE WHEN s.corrected_r2_key IS NOT NULL THEN 1 ELSE 0 END) files FROM submissions s JOIN teacher_students ts ON ts.student_id=s.student_id WHERE ts.teacher_id=?`).bind(current.id).first<{ bytes: number; files: number }>();
  const work = current.role === "owner" ? await env.DB.prepare(`SELECT COALESCE(SUM(state_size+final_pdf_size),0) bytes,SUM(CASE WHEN state_r2_key IS NOT NULL THEN 1 ELSE 0 END)+SUM(CASE WHEN final_pdf_r2_key IS NOT NULL THEN 1 ELSE 0 END) files FROM student_work`).first<{ bytes: number; files: number }>() : { bytes: 0, files: 0 };
  return { trackedBytes: (activity?.bytes ?? 0) + (submission?.bytes ?? 0) + (work?.bytes ?? 0), activityBytes: activity?.bytes ?? 0, submissionBytes: submission?.bytes ?? 0, workBytes: work?.bytes ?? 0, trackedFiles: (activity?.files ?? 0) + (submission?.files ?? 0) + (work?.files ?? 0) };
}

async function staffDashboard(current: Session) {
  const owner = current.role === "owner";
  const [students, teachers, folders, activities, assignments, submissions, auditLogs, storage] = await Promise.all([
    (owner
      ? env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.active,u.must_change_password,u.folder_id,u.created_at,u.deactivated_at,u.archived_at,ts.teacher_id,t.display_name teacher_name,(SELECT COUNT(*) FROM assignment_students ast WHERE ast.student_id=u.id) assignment_count FROM users u LEFT JOIN teacher_students ts ON ts.student_id=u.id LEFT JOIN users t ON t.id=ts.teacher_id WHERE u.role='student' AND u.trashed_at IS NULL ORDER BY u.display_name`)
      : env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.active,u.must_change_password,u.folder_id,u.created_at,u.deactivated_at,u.archived_at,ts.teacher_id,? teacher_name,(SELECT COUNT(*) FROM assignment_students ast WHERE ast.student_id=u.id) assignment_count FROM users u JOIN teacher_students ts ON ts.student_id=u.id WHERE u.role='student' AND ts.teacher_id=? AND u.trashed_at IS NULL ORDER BY u.display_name`).bind(current.display_name, current.id)).all(),
    (owner ? env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.active,u.must_change_password,u.upload_permission,u.created_at,u.deactivated_at,(SELECT COUNT(*) FROM teacher_students ts WHERE ts.teacher_id=u.id) student_count FROM users u WHERE u.role IN ('owner','teacher') AND u.trashed_at IS NULL ORDER BY u.role,u.display_name`).all() : Promise.resolve({ results: [] })),
    (owner ? env.DB.prepare(`SELECT * FROM folders WHERE trashed_at IS NULL ORDER BY scope,name`) : env.DB.prepare(`SELECT * FROM folders WHERE trashed_at IS NULL AND (scope='activities' OR created_by=?) ORDER BY scope,name`).bind(current.id)).all(),
    (owner ? env.DB.prepare(`SELECT a.id,a.title,a.category,a.description,a.instructions,a.folder_id,a.current_version_id,a.created_by,a.created_at,a.updated_at,a.archived_at,a.publication_status,u.display_name creator_name,COALESCE(v.original_name,a.original_name) original_name,COALESCE(v.content_type,a.content_type) content_type,COALESCE(v.external_url,a.external_url) external_url,COALESCE(v.file_size,0) file_size,COALESCE(v.runtime_kind,'generic') runtime_kind,COALESCE(v.online_capable,0) online_capable,COALESCE(v.version_number,1) version_number FROM activities a JOIN users u ON u.id=a.created_by LEFT JOIN activity_versions v ON v.id=a.current_version_id WHERE a.trashed_at IS NULL ORDER BY a.created_at DESC`) : env.DB.prepare(`SELECT a.id,a.title,a.category,a.description,a.instructions,a.folder_id,a.current_version_id,a.created_by,a.created_at,a.updated_at,a.archived_at,a.publication_status,u.display_name creator_name,COALESCE(v.original_name,a.original_name) original_name,COALESCE(v.content_type,a.content_type) content_type,COALESCE(v.external_url,a.external_url) external_url,COALESCE(v.file_size,0) file_size,COALESCE(v.runtime_kind,'generic') runtime_kind,COALESCE(v.online_capable,0) online_capable,COALESCE(v.version_number,1) version_number FROM activities a JOIN users u ON u.id=a.created_by LEFT JOIN activity_versions v ON v.id=a.current_version_id WHERE a.trashed_at IS NULL AND (a.publication_status='published' OR a.created_by=?) ORDER BY a.created_at DESC`).bind(current.id)).all(),
    (owner ? env.DB.prepare(`SELECT a.id,a.activity_id,a.activity_version_id,a.folder_id,a.due_at,a.instructions,a.status,a.published_at,a.created_by,a.archived_at,COALESCE(v.title,ac.title) title,COALESCE(v.category,ac.category) category,COALESCE(v.description,ac.description) description,u.display_name creator_name,COUNT(ast.student_id) student_count FROM assignments a JOIN activities ac ON ac.id=a.activity_id JOIN users u ON u.id=a.created_by LEFT JOIN activity_versions v ON v.id=a.activity_version_id LEFT JOIN assignment_students ast ON ast.assignment_id=a.id WHERE a.trashed_at IS NULL GROUP BY a.id ORDER BY a.published_at DESC`) : env.DB.prepare(`SELECT a.id,a.activity_id,a.activity_version_id,a.folder_id,a.due_at,a.instructions,a.status,a.published_at,a.created_by,a.archived_at,COALESCE(v.title,ac.title) title,COALESCE(v.category,ac.category) category,COALESCE(v.description,ac.description) description,? creator_name,COUNT(ast.student_id) student_count FROM assignments a JOIN activities ac ON ac.id=a.activity_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id LEFT JOIN assignment_students ast ON ast.assignment_id=a.id WHERE a.created_by=? AND a.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM assignment_students ax LEFT JOIN teacher_students tx ON tx.student_id=ax.student_id WHERE ax.assignment_id=a.id AND COALESCE(tx.teacher_id,'')<>?) GROUP BY a.id ORDER BY a.published_at DESC`).bind(current.display_name, current.id, current.id)).all(),
    (owner ? env.DB.prepare(`SELECT s.*,u.display_name student_name,COALESCE(v.title,ac.title) title,a.created_by teacher_id,t.display_name teacher_name,a.activity_version_id,COALESCE(v.runtime_kind,'generic') runtime_kind,COALESCE(v.online_capable,0) online_capable,sw.saved_at work_saved_at,sw.state_version work_state_version FROM submissions s JOIN users u ON u.id=s.student_id JOIN assignments a ON a.id=s.assignment_id JOIN users t ON t.id=a.created_by JOIN activities ac ON ac.id=a.activity_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id LEFT JOIN student_work sw ON sw.assignment_id=s.assignment_id AND sw.student_id=s.student_id WHERE s.trashed_at IS NULL ORDER BY s.submitted_at DESC`) : env.DB.prepare(`SELECT s.*,u.display_name student_name,COALESCE(v.title,ac.title) title,a.created_by teacher_id,a.activity_version_id,COALESCE(v.runtime_kind,'generic') runtime_kind,COALESCE(v.online_capable,0) online_capable,sw.saved_at work_saved_at,sw.state_version work_state_version FROM submissions s JOIN users u ON u.id=s.student_id JOIN teacher_students ts ON ts.student_id=s.student_id JOIN assignments a ON a.id=s.assignment_id JOIN activities ac ON ac.id=a.activity_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id LEFT JOIN student_work sw ON sw.assignment_id=s.assignment_id AND sw.student_id=s.student_id WHERE ts.teacher_id=? AND s.trashed_at IS NULL ORDER BY s.submitted_at DESC`).bind(current.id)).all(),
    (owner ? env.DB.prepare(`SELECT ae.*,u.display_name actor_name FROM audit_events ae LEFT JOIN users u ON u.id=ae.actor_id ORDER BY ae.created_at DESC LIMIT 100`) : env.DB.prepare(`SELECT ae.*,? actor_name FROM audit_events ae WHERE ae.actor_id=? ORDER BY ae.created_at DESC LIMIT 50`).bind(current.display_name, current.id)).all(),
    storageSummary(current),
  ]);
  const trashQueries = owner ? [
    env.DB.prepare(`SELECT 'activity' kind,id,title name,trashed_at FROM activities WHERE trashed_at IS NOT NULL`),
    env.DB.prepare(`SELECT 'assignment' kind,a.id,COALESCE(v.title,ac.title) name,a.trashed_at FROM assignments a JOIN activities ac ON ac.id=a.activity_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id WHERE a.trashed_at IS NOT NULL`),
    env.DB.prepare(`SELECT 'submission' kind,s.id,u.display_name||' — '||COALESCE(v.title,ac.title) name,s.trashed_at FROM submissions s JOIN users u ON u.id=s.student_id JOIN assignments a ON a.id=s.assignment_id JOIN activities ac ON ac.id=a.activity_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id WHERE s.trashed_at IS NOT NULL`),
    env.DB.prepare(`SELECT CASE WHEN role='student' THEN 'student' ELSE 'teacher' END kind,id,display_name name,trashed_at FROM users WHERE trashed_at IS NOT NULL`),
    env.DB.prepare(`SELECT 'folder' kind,id,name,trashed_at FROM folders WHERE trashed_at IS NOT NULL`),
  ] : [
    env.DB.prepare(`SELECT 'activity' kind,id,title name,trashed_at FROM activities WHERE created_by=? AND trashed_at IS NOT NULL`).bind(current.id),
    env.DB.prepare(`SELECT 'assignment' kind,a.id,COALESCE(v.title,ac.title) name,a.trashed_at FROM assignments a JOIN activities ac ON ac.id=a.activity_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id WHERE a.created_by=? AND a.trashed_at IS NOT NULL`).bind(current.id),
    env.DB.prepare(`SELECT 'submission' kind,s.id,u.display_name||' — '||COALESCE(v.title,ac.title) name,s.trashed_at FROM submissions s JOIN users u ON u.id=s.student_id JOIN teacher_students ts ON ts.student_id=s.student_id JOIN assignments a ON a.id=s.assignment_id JOIN activities ac ON ac.id=a.activity_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id WHERE ts.teacher_id=? AND s.trashed_at IS NOT NULL`).bind(current.id),
    env.DB.prepare(`SELECT 'student' kind,u.id,u.display_name name,u.trashed_at FROM users u JOIN teacher_students ts ON ts.student_id=u.id WHERE ts.teacher_id=? AND u.role='student' AND u.trashed_at IS NOT NULL`).bind(current.id),
    env.DB.prepare(`SELECT 'folder' kind,id,name,trashed_at FROM folders WHERE created_by=? AND trashed_at IS NOT NULL`).bind(current.id),
  ];
  const trash = (await Promise.all(trashQueries.map((query) => query.all()))).flatMap((result) => result.results);
  const retention = await env.DB.prepare(`SELECT value FROM app_settings WHERE key='trash_retention_days'`).first<{ value: string }>();
  return { user: current, permissions: { isOwner: owner, canManageTeachers: owner, canPurge: owner, canUploadActivities: uploadMode(current)!=="none", uploadWorkflow: uploadMode(current) }, settings: { trash_retention_days: Number(retention?.value ?? 30) }, googleDriveClientId: (env.GOOGLE_DRIVE_CLIENT_ID as string | undefined) ?? null, students: students.results, teachers: teachers.results, folders: folders.results, activities: activities.results, assignments: assignments.results, submissions: submissions.results, trash, auditLogs: auditLogs.results, storage };
}

async function studentDashboard(studentId: string, student?: Pick<User, "id" | "username" | "display_name" | "role" | "must_change_password">) {
  const [assignments, folders, user] = await Promise.all([
    env.DB.prepare(`SELECT a.id,ac.id activity_id,a.activity_version_id,a.due_at,COALESCE(NULLIF(a.instructions,''),v.instructions,ac.instructions) instructions,COALESCE(NULLIF(saf.custom_title,''),v.title,ac.title) title,COALESCE(v.category,ac.category) category,COALESCE(v.description,ac.description) description,COALESCE(v.original_name,ac.original_name) original_name,COALESCE(v.content_type,ac.content_type) content_type,COALESCE(v.external_url,ac.external_url) external_url,COALESCE(v.runtime_kind,'generic') runtime_kind,COALESCE(v.online_capable,0) online_capable,ast.status,s.id submission_id,s.writing,s.original_name submission_original_name,s.feedback,s.corrected_at,CASE WHEN s.corrected_r2_key IS NOT NULL THEN 1 ELSE 0 END has_corrected_file,s.corrected_original_name,s.corrected_content_type,saf.folder_id student_folder_id FROM assignment_students ast JOIN assignments a ON a.id=ast.assignment_id JOIN activities ac ON ac.id=a.activity_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id LEFT JOIN submissions s ON s.assignment_id=a.id AND s.student_id=ast.student_id LEFT JOIN student_assignment_folders saf ON saf.assignment_id=a.id AND saf.student_id=ast.student_id WHERE ast.student_id=? AND a.status='published' AND a.trashed_at IS NULL AND saf.hidden_at IS NULL ORDER BY a.published_at DESC`).bind(studentId).all(),
    env.DB.prepare(`SELECT id,name,parent_id,created_at,updated_at FROM folders WHERE scope='student' AND created_by=? AND trashed_at IS NULL ORDER BY name`).bind(studentId).all(),
    student ? Promise.resolve(student) : env.DB.prepare(`SELECT id,username,display_name,role,must_change_password FROM users WHERE id=? AND role='student' AND active=1 AND trashed_at IS NULL`).bind(studentId).first<User>(),
  ]);
  return { user, assignments: assignments.results, folders: folders.results };
}

async function dashboard(current: Session) {
  if (staff(current)) return staffDashboard(current);
  return studentDashboard(current.id, current);
}

export async function GET(request: Request) {
  try {
    const current = await session(request);
    const teachers = await env.DB.prepare(`SELECT COUNT(*) count FROM users WHERE role IN ('owner','teacher')`).first<{ count: number }>();
    if (!current) return json({ authenticated: false, setupRequired: !teachers?.count, turnstileSiteKey: (env.TURNSTILE_SITE_KEY as string | undefined) ?? null });
    return json({ authenticated: true, csrfToken: current.csrf_token, ...(await dashboard(current)) }, 200, { "Cache-Control": "no-store" });
  } catch (error) { return error instanceof Response ? error : json({ error: "Impossible de charger le portail." }, 500); }
}

async function createVersion(current: Session, activityId: string, patch: Record<string, unknown>) {
  const source = await env.DB.prepare(`SELECT a.*,v.version_number,v.r2_key version_r2_key,v.original_name version_original_name,v.content_type version_content_type,v.external_url version_external_url,v.file_size,v.runtime_kind,v.online_capable,v.manifest_version FROM activities a LEFT JOIN activity_versions v ON v.id=a.current_version_id WHERE a.id=?`).bind(activityId).first<Record<string, unknown>>();
  if (!source || !(await owns(current, "activity", activityId))) throw new Response("Activité introuvable.", { status: 404 });
  const versionId = id(), created = now(), versionNumber = Number(source.version_number ?? 0) + 1;
  const value = (key: string, fallback: unknown) => Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : fallback;
  const title = String(value("title", source.title)).trim();
  const category = String(value("category", source.category));
  if (!title || !categories.includes(category)) throw new Response("Titre ou catégorie invalide.", { status: 400 });
  const description = String(value("description", source.description) ?? ""), instructions = String(value("instructions", source.instructions) ?? "");
  const externalUrl = normalizedExternalUrl(value("externalUrl", source.version_external_url ?? source.external_url));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO activity_versions(id,activity_id,version_number,title,category,description,instructions,r2_key,original_name,content_type,external_url,file_size,runtime_kind,online_capable,manifest_version,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(versionId, activityId, versionNumber, title, category, description, instructions, source.version_r2_key ?? source.r2_key ?? null, source.version_original_name ?? source.original_name ?? null, source.version_content_type ?? source.content_type ?? null, externalUrl, Number(source.file_size ?? 0), source.runtime_kind ?? "generic", Number(source.online_capable ?? 0), Number(source.manifest_version ?? 1), current.id, created),
    env.DB.prepare(`UPDATE activities SET title=?,category=?,description=?,instructions=?,external_url=?,current_version_id=?,updated_at=? WHERE id=?`).bind(title, category, description, instructions, externalUrl, versionId, created, activityId),
  ]);
  return versionId;
}

async function mutateItems(current: Session, action: string, kind: string, recordIds: string[], folderId: string | null) {
  if (!entityKinds.includes(kind) || !recordIds.length) throw new Response("Sélection invalide.", { status: 400 });
  if (kind === "student" || kind === "teacher") {
    const expectedRole = kind === "student" ? "student" : "teacher";
    for (const recordId of recordIds) {
      const target = await env.DB.prepare(`SELECT role FROM users WHERE id=?`).bind(recordId).first<{ role: Role }>();
      if (!target || target.role !== expectedRole || target.role === "owner") throw new Response("Compte protégé ou type de compte invalide.", { status: 403 });
    }
  }
  for (const recordId of recordIds) if (!(await owns(current, kind, recordId)) && !(current.role === "owner" && kind === "teacher")) throw new Response("Accès refusé.", { status: 403 });
  if (kind === "teacher" && current.role !== "owner") throw new Response("Accès refusé.", { status: 403 });
  const table = kind === "activity" ? "activities" : kind === "assignment" ? "assignments" : kind === "submission" ? "submissions" : kind === "folder" ? "folders" : "users";
  const marks = placeholders(recordIds), stamp = now();
  if (action === "move_items") {
    if (kind === "folder") {
      for (const recordId of recordIds) {
        if (folderId === recordId) throw new Response("Un dossier ne peut pas être son propre parent.", { status: 400 });
        const source = await env.DB.prepare(`SELECT scope FROM folders WHERE id=?`).bind(recordId).first<{ scope: string }>();
        if (!source) throw new Response("Dossier introuvable.", { status: 404 });
        if (folderId) {
          const parent = await env.DB.prepare(`SELECT scope,created_by FROM folders WHERE id=? AND trashed_at IS NULL`).bind(folderId).first<{ scope: string; created_by: string }>();
          if (!parent || parent.scope !== source.scope || (current.role !== "owner" && source.scope !== "activities" && parent.created_by !== current.id)) throw new Response("Dossier parent invalide.", { status: 400 });
          const cycle = await env.DB.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM folders WHERE parent_id=? UNION ALL SELECT f.id FROM folders f JOIN descendants d ON f.parent_id=d.id) SELECT 1 ok FROM descendants WHERE id=? LIMIT 1`).bind(recordId, folderId).first();
          if (cycle) throw new Response("Ce déplacement créerait une boucle de dossiers.", { status: 400 });
        }
        await env.DB.prepare(`UPDATE folders SET parent_id=?,updated_at=? WHERE id=?`).bind(folderId, stamp, recordId).run();
      }
      await audit(current, action, kind, null, { ids: recordIds, folderId });
      return;
    }
    const expectedScope = kind === "activity" ? "activities" : kind === "assignment" ? "assignments" : kind === "submission" ? "corrections" : kind === "student" ? "students" : null;
    if (!expectedScope) throw new Response("Ce type ne peut pas être déplacé.", { status: 400 });
    if (folderId) {
      const folder = await env.DB.prepare(`SELECT scope,created_by,trashed_at FROM folders WHERE id=?`).bind(folderId).first<{ scope: string; created_by: string; trashed_at: string | null }>();
      if (!folder || folder.scope !== expectedScope || folder.trashed_at || (current.role !== "owner" && folder.scope !== "activities" && folder.created_by !== current.id)) throw new Response("Dossier invalide.", { status: 400 });
    }
    await env.DB.prepare(`UPDATE ${table} SET folder_id=?${["activities","assignments","submissions","users"].includes(table) ? ",updated_at=?" : ",updated_at=?"} WHERE id IN (${marks})`).bind(folderId, stamp, ...recordIds).run();
  } else {
    const column = action === "trash_items" ? "trashed_at" : action === "archive_items" ? "archived_at" : null;
    if (action === "restore_items") await env.DB.prepare(`UPDATE ${table} SET trashed_at=NULL,archived_at=NULL${table === "users" ? ",active=1,deactivated_at=NULL" : ""} WHERE id IN (${marks})`).bind(...recordIds).run();
    else if (column) {
      if (kind === "teacher" && recordIds.includes(current.id)) throw new Response("Le compte principal ne peut pas être supprimé.", { status: 400 });
      if (kind === "teacher") {
        const assigned = await env.DB.prepare(`SELECT COUNT(*) count FROM teacher_students WHERE teacher_id IN (${marks})`).bind(...recordIds).first<{ count: number }>();
        if (assigned?.count) throw new Response("Transférez d’abord les élèves de cet enseignant.", { status: 409 });
      }
      await env.DB.prepare(`UPDATE ${table} SET ${column}=?${table === "users" ? ",active=0,deactivated_at=?" : ""} WHERE id IN (${marks})`).bind(stamp, ...(table === "users" ? [stamp] : []), ...recordIds).run();
      if (table === "users") await env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (${marks})`).bind(...recordIds).run();
    } else throw new Response("Action invalide.", { status: 400 });
  }
  await audit(current, action, kind, null, { ids: recordIds, folderId });
}

async function orphanedKeys(keys: string[]) {
  const result: string[] = [];
  for (const key of [...new Set(keys.filter(Boolean))]) {
    const used = await env.DB.prepare(`SELECT 1 ok FROM (SELECT r2_key key FROM activities UNION ALL SELECT r2_key FROM activity_versions UNION ALL SELECT r2_key FROM submissions UNION ALL SELECT corrected_r2_key FROM submissions UNION ALL SELECT state_r2_key FROM student_work UNION ALL SELECT final_pdf_r2_key FROM student_work) WHERE key=? LIMIT 1`).bind(key).first();
    if (!used) result.push(key);
  }
  return result;
}

async function purgeItems(current: Session, kind: string, recordIds: string[]) {
  if (current.role !== "owner") throw new Response("Réservé à l’administrateur principal.", { status: 403 });
  if (!entityKinds.includes(kind) || !recordIds.length) throw new Response("Sélection invalide.", { status: 400 });
  const keys: string[] = [];
  for (const recordId of recordIds) {
    if (kind === "activity") {
      const impact = await env.DB.prepare(`SELECT COUNT(*) count FROM assignments WHERE activity_id=?`).bind(recordId).first<{ count: number }>();
      if (impact?.count) throw new Response(`Suppression refusée : l’activité ${recordId} est utilisée par ${impact.count} devoir(s).`, { status: 409 });
      const files = await env.DB.prepare(`SELECT r2_key FROM activity_versions WHERE activity_id=? UNION SELECT r2_key FROM activities WHERE id=?`).bind(recordId, recordId).all<{ r2_key: string }>();
      keys.push(...files.results.map((row) => row.r2_key).filter(Boolean));
      await env.DB.prepare(`DELETE FROM activities WHERE id=? AND trashed_at IS NOT NULL`).bind(recordId).run();
    } else if (kind === "assignment") {
      const impact = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM submissions WHERE assignment_id=?)+(SELECT COUNT(*) FROM student_work WHERE assignment_id=?) count`).bind(recordId, recordId).first<{ count: number }>();
      if (impact?.count) throw new Response("Suppression refusée : ce devoir possède des travaux.", { status: 409 });
      await env.DB.prepare(`DELETE FROM assignments WHERE id=? AND trashed_at IS NOT NULL`).bind(recordId).run();
    } else if (kind === "submission") {
      const row = await env.DB.prepare(`SELECT r2_key,corrected_r2_key FROM submissions WHERE id=? AND trashed_at IS NOT NULL`).bind(recordId).first<{ r2_key: string | null; corrected_r2_key: string | null }>();
      if (row) keys.push(row.r2_key ?? "", row.corrected_r2_key ?? "");
      await env.DB.prepare(`DELETE FROM submissions WHERE id=? AND trashed_at IS NOT NULL`).bind(recordId).run();
    } else if (kind === "folder") {
      const impact = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM folders WHERE parent_id=?)+(SELECT COUNT(*) FROM activities WHERE folder_id=?)+(SELECT COUNT(*) FROM assignments WHERE folder_id=?)+(SELECT COUNT(*) FROM submissions WHERE folder_id=?)+(SELECT COUNT(*) FROM users WHERE folder_id=?) count`).bind(recordId, recordId, recordId, recordId, recordId).first<{ count: number }>();
      if (impact?.count) throw new Response("Suppression refusée : ce dossier n’est pas vide.", { status: 409 });
      await env.DB.prepare(`DELETE FROM folders WHERE id=? AND trashed_at IS NOT NULL`).bind(recordId).run();
    } else {
      const row = await env.DB.prepare(`SELECT role FROM users WHERE id=? AND trashed_at IS NOT NULL`).bind(recordId).first<{ role: Role }>();
      const expectedRole = kind === "student" ? "student" : kind === "teacher" ? "teacher" : null;
      if (!row || !expectedRole || row.role !== expectedRole || row.role === "owner") throw new Response("Compte protégé ou type de compte invalide.", { status: 400 });
      const impact = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM assignment_students WHERE student_id=?)+(SELECT COUNT(*) FROM submissions WHERE student_id=?)+(SELECT COUNT(*) FROM student_work WHERE student_id=?)+(SELECT COUNT(*) FROM teacher_students WHERE teacher_id=?)+(SELECT COUNT(*) FROM activities WHERE created_by=?)+(SELECT COUNT(*) FROM assignments WHERE created_by=?) count`).bind(recordId, recordId, recordId, recordId, recordId, recordId).first<{ count: number }>();
      if (impact?.count) throw new Response("Suppression refusée : ce compte possède encore des données.", { status: 409 });
      await env.DB.prepare(`DELETE FROM users WHERE id=?`).bind(recordId).run();
    }
  }
  const orphaned = await orphanedKeys(keys);
  if (orphaned.length) await env.FILES.delete(orphaned);
  await audit(current, "purge_items", kind, null, { ids: recordIds, deletedFiles: orphaned.length });
}

async function duplicateItems(current: Session, kind: string, recordIds: string[]) {
  if (!recordIds.length || !["activity", "assignment"].includes(kind)) throw new Response("Sélection invalide.", { status: 400 });
  const created: string[] = [];
  for (const recordId of recordIds) {
    if (kind === "activity") {
      const source = await env.DB.prepare(`SELECT a.*,v.id version_id,v.r2_key version_r2_key,v.original_name version_original_name,v.content_type version_content_type,v.external_url version_external_url,v.file_size,v.runtime_kind,v.online_capable,v.manifest_version FROM activities a LEFT JOIN activity_versions v ON v.id=a.current_version_id WHERE a.id=? AND a.trashed_at IS NULL`).bind(recordId).first<Record<string, unknown>>();
      if (!source) throw new Response("Activité introuvable.", { status: 404 });
      const activityId = id(), versionId = id(), stamp = now(), title = `${source.title} — copie`, publicationStatus = source.publication_status==="pending"&&current.role!=="owner"?"pending":"published";
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO activities(id,title,category,description,instructions,r2_key,original_name,content_type,external_url,current_version_id,folder_id,created_by,created_at,publication_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(activityId,title,source.category,source.description,source.instructions,source.version_r2_key ?? source.r2_key ?? null,source.version_original_name ?? source.original_name ?? null,source.version_content_type ?? source.content_type ?? null,source.version_external_url ?? source.external_url ?? null,versionId,source.folder_id ?? null,current.id,stamp,publicationStatus),
        env.DB.prepare(`INSERT INTO activity_versions(id,activity_id,version_number,title,category,description,instructions,r2_key,original_name,content_type,external_url,file_size,runtime_kind,online_capable,manifest_version,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(versionId,activityId,1,title,source.category,source.description,source.instructions,source.version_r2_key ?? source.r2_key ?? null,source.version_original_name ?? source.original_name ?? null,source.version_content_type ?? source.content_type ?? null,source.version_external_url ?? source.external_url ?? null,Number(source.file_size ?? 0),source.runtime_kind ?? "generic",Number(source.online_capable ?? 0),Number(source.manifest_version ?? 1),current.id,stamp),
      ]);
      created.push(activityId);
    } else {
      if (!(await owns(current, "assignment", recordId))) throw new Response("Accès refusé.", { status: 403 });
      const source = await env.DB.prepare(`SELECT * FROM assignments WHERE id=?`).bind(recordId).first<Record<string, unknown>>();
      if (!source) throw new Response("Devoir introuvable.", { status: 404 });
      const assignmentId = id(), stamp = now();
      await env.DB.prepare(`INSERT INTO assignments(id,activity_id,activity_version_id,folder_id,due_at,instructions,status,published_at,created_by) VALUES(?,?,?,?,?,?,?, ?,?)`).bind(assignmentId,source.activity_id,source.activity_version_id,source.folder_id,source.due_at,source.instructions,"published",stamp,current.id).run();
      const recipients = await env.DB.prepare(`SELECT ast.student_id FROM assignment_students ast ${current.role === "owner" ? "" : "JOIN teacher_students ts ON ts.student_id=ast.student_id"} WHERE ast.assignment_id=? ${current.role === "owner" ? "" : "AND ts.teacher_id=?"}`).bind(...(current.role === "owner" ? [recordId] : [recordId,current.id])).all<{student_id:string}>();
      if (recipients.results.length) await env.DB.batch(recipients.results.map((row) => env.DB.prepare(`INSERT INTO assignment_students(assignment_id,student_id,status,assigned_at) VALUES(?,?,'assigned',?)`).bind(assignmentId,row.student_id,stamp)));
      created.push(assignmentId);
    }
  }
  await audit(current, "duplicate_items", kind, null, { sourceIds: recordIds, createdIds: created });
  return created;
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("action") === "upload_activity_part") {
      const current = await requireSession(request, "staff"), key = String(url.searchParams.get("key") ?? ""), uploadId = String(url.searchParams.get("uploadId") ?? ""), partNumber = Number(url.searchParams.get("partNumber") ?? 0), chunk = await request.arrayBuffer();
      if(uploadMode(current)==="none")return json({error:"L’administrateur doit autoriser le dépôt d’activités."},403);
      const grant = await env.DB.prepare(`SELECT file_size,part_count FROM upload_sessions WHERE id=? AND user_id=? AND r2_key=? AND status='uploading' AND expires_at>?`).bind(uploadId,current.id,key,now()).first<{file_size:number;part_count:number}>();
      if (!grant || !key.startsWith(`activities/${current.id}/`) || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > grant.part_count || !chunk.byteLength) return json({ error: "Partie de fichier invalide ou session expirée." }, 400);
      const chunkSize=512*1024, expectedSize=partNumber<grant.part_count?chunkSize:grant.file_size-chunkSize*(grant.part_count-1);
      if (chunk.byteLength !== expectedSize) return json({ error: "Taille de partie invalide." }, 400);
      const prefix = stagedUploadPrefix(key, uploadId), part = await env.FILES.put(stagedPartKey(prefix, partNumber), chunk, { httpMetadata: { contentType: "application/octet-stream" } });
      return json({ ok: true, partNumber, etag: part.etag });
    }
    const type = request.headers.get("content-type") ?? "";
    const data: Input = type.includes("multipart/form-data") ? await request.formData() : await request.json() as Record<string, unknown>;
    const action = String(get(data, "action") ?? "");

    if (action === "setup") {
      const existing = await env.DB.prepare(`SELECT COUNT(*) count FROM users WHERE role IN ('owner','teacher')`).first<{ count: number }>();
      if (existing?.count) return json({ error: "Le compte enseignant existe déjà." }, 409);
      const setupCode = env.TEACHER_SETUP_CODE as string | undefined;
      if (!setupCode || String(get(data, "setupCode") ?? "") !== setupCode) return json({ error: "Code de configuration incorrect." }, 403);
      if (!(await turnstile(request, String(get(data, "turnstileToken") ?? "") || null))) return json({ error: "Vérification de sécurité échouée." }, 400);
      const username = String(get(data, "username") ?? "").trim().toLowerCase(), password = String(get(data, "password") ?? ""), name = String(get(data, "displayName") ?? "").trim();
      if (!/^[a-z0-9._@+-]{3,80}$/.test(username) || !password || !name) return json({ error: "Identifiant, nom ou mot de passe manquant." }, 400);
      const hashed = await passwordHash(password);
      await env.DB.prepare(`INSERT INTO users(id,username,display_name,role,password_hash,password_salt,active,must_change_password,created_at) VALUES(?,?,?,?,?,?,1,0,?)`).bind(id(),username,name,"owner",hashed.hash,hashed.salt,now()).run();
      return json({ ok: true });
    }

    if (action === "login") {
      const username = String(get(data, "username") ?? "").trim().toLowerCase(), password = String(get(data, "password") ?? "");
      if (!(await turnstile(request, String(get(data, "turnstileToken") ?? "") || null))) return json({ error: "Vérification de sécurité échouée." }, 400);
      const ip=request.headers.get("CF-Connecting-IP")??"local",key=await sha256(`login:${ip}:${username}`),ipKey=await sha256(`login-ip:${ip}`),cutoff=new Date(Date.now()-15*60_000).toISOString();
      await env.DB.prepare(`DELETE FROM login_attempts WHERE window_started_at<?`).bind(cutoff).run();
      const [attempt,ipAttempt]=await Promise.all([env.DB.prepare(`SELECT count,window_started_at FROM login_attempts WHERE key=?`).bind(key).first<{count:number;window_started_at:string}>(),env.DB.prepare(`SELECT count,window_started_at FROM login_attempts WHERE key=?`).bind(ipKey).first<{count:number;window_started_at:string}>()]);
      if ((attempt?.count??0)>=8||(ipAttempt?.count??0)>=30) return json({ error: "Trop de tentatives. Réessayez dans 15 minutes." }, 429);
      const user = await env.DB.prepare(`SELECT * FROM users WHERE username=? AND active=1 AND trashed_at IS NULL`).bind(username).first<User & {password_hash:string;password_salt:string}>();
      const candidate = user ? await passwordHash(password,user.password_salt) : await passwordHash(password,"00000000000000000000000000000000");
      const valid = user ? secureEqual(candidate.hash, user.password_hash) : false;
      if (!user || !valid) {
        await env.DB.batch([key,ipKey].map(attemptKey=>env.DB.prepare(`INSERT INTO login_attempts(key,count,window_started_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1`).bind(attemptKey,now())));
        return json({ error: "Identifiant ou mot de passe incorrect." }, 401);
      }
      await env.DB.prepare(`DELETE FROM login_attempts WHERE key IN (?,?)`).bind(key,ipKey).run();
      const token = randomToken(), csrf = randomToken();
      await env.DB.prepare(`INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)`).bind(await sha256(token),user.id,csrf,new Date(Date.now()+7*86400000).toISOString(),now()).run();
      return json({ ok: true },200,{ "Set-Cookie":`monfrench_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`,"Cache-Control":"no-store" });
    }

    const current = await requireSession(request);
    if (action === "logout") {
      const token = cookie(request,"monfrench_session"); if (token) await env.DB.prepare(`DELETE FROM sessions WHERE id_hash=?`).bind(await sha256(token)).run();
      return json({ok:true},200,{"Set-Cookie":"monfrench_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"});
    }
    if (action === "change_password") {
      const password=String(get(data,"password")??""); if(!password)return json({error:"Mot de passe requis."},400);
      const hashed=await passwordHash(password); await env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,must_change_password=0,updated_at=? WHERE id=?`).bind(hashed.hash,hashed.salt,now(),current.id).run(); await env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND id_hash<>?`).bind(current.id,await sha256(cookie(request,"monfrench_session")!)).run(); return json({ok:true});
    }
    const studentActions=["open_assignment","get_progress","save_progress","complete_assignment","submit","create_student_folder","rename_student_folder","move_student_assignment","trash_student_folder"];
    if (!staff(current) && !studentActions.includes(action)) return json({error:"Réservé à l’enseignant."},403);

    if(action==="create_student_folder"){
      const studentId=staff(current)?String(get(data,"studentId")??""):current.id;if(staff(current)&&!await ownsStudent(current,studentId))return json({error:"Accès refusé."},403);
      const name=String(get(data,"name")??"").trim(),parentId=String(get(data,"parentId")??"")||null;
      if(!name||name.length>120)return json({error:"Nom de dossier invalide."},400);
      if(parentId&&!await env.DB.prepare(`SELECT 1 ok FROM folders WHERE id=? AND scope='student' AND created_by=? AND trashed_at IS NULL`).bind(parentId,studentId).first())return json({error:"Dossier parent invalide."},400);
      const folderId=id();await env.DB.prepare(`INSERT INTO folders(id,name,scope,parent_id,created_by,created_at) VALUES(?,?,'student',?,?,?)`).bind(folderId,name,parentId,studentId,now()).run();return json({ok:true,id:folderId});
    }
    if(action==="rename_student_folder"){
      const studentId=staff(current)?String(get(data,"studentId")??""):current.id;if(staff(current)&&!await ownsStudent(current,studentId))return json({error:"Accès refusé."},403);
      const folderId=String(get(data,"folderId")??""),name=String(get(data,"name")??"").trim();if(!folderId||!name||name.length>120)return json({error:"Dossier invalide."},400);
      const result=await env.DB.prepare(`UPDATE folders SET name=?,updated_at=? WHERE id=? AND scope='student' AND created_by=? AND trashed_at IS NULL`).bind(name,now(),folderId,studentId).run();if(!result.meta.changes)return json({error:"Dossier introuvable."},404);return json({ok:true});
    }
    if(action==="move_student_assignment"){
      const studentId=staff(current)?String(get(data,"studentId")??""):current.id;if(staff(current)&&!await ownsStudent(current,studentId))return json({error:"Accès refusé."},403);
      const assignmentId=String(get(data,"assignmentId")??""),folderId=String(get(data,"folderId")??"")||null;
      if(!await env.DB.prepare(`SELECT 1 ok FROM assignment_students ast JOIN assignments a ON a.id=ast.assignment_id WHERE ast.assignment_id=? AND ast.student_id=? AND a.status='published' AND a.trashed_at IS NULL`).bind(assignmentId,studentId).first())return json({error:"Devoir introuvable."},404);
      if(folderId&&!await env.DB.prepare(`SELECT 1 ok FROM folders WHERE id=? AND scope='student' AND created_by=? AND trashed_at IS NULL`).bind(folderId,studentId).first())return json({error:"Dossier invalide."},400);
      await env.DB.prepare(`INSERT INTO student_assignment_folders(assignment_id,student_id,folder_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET folder_id=excluded.folder_id,updated_at=excluded.updated_at`).bind(assignmentId,studentId,folderId,now()).run();return json({ok:true});
    }
    if(action==="trash_student_folder"){
      const studentId=staff(current)?String(get(data,"studentId")??""):current.id;if(staff(current)&&!await ownsStudent(current,studentId))return json({error:"Accès refusé."},403);
      const folderId=String(get(data,"folderId")??"");if(!folderId)return json({error:"Dossier invalide."},400);
      const owned=await env.DB.prepare(`SELECT 1 ok FROM folders WHERE id=? AND scope='student' AND created_by=? AND trashed_at IS NULL`).bind(folderId,studentId).first();if(!owned)return json({error:"Dossier introuvable."},404);
      const stamp=now();await env.DB.batch([env.DB.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM folders WHERE id=? AND scope='student' AND created_by=? UNION ALL SELECT f.id FROM folders f JOIN tree t ON f.parent_id=t.id WHERE f.scope='student' AND f.created_by=?) UPDATE student_assignment_folders SET folder_id=NULL,updated_at=? WHERE student_id=? AND folder_id IN (SELECT id FROM tree)`).bind(folderId,studentId,studentId,stamp,studentId),env.DB.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM folders WHERE id=? AND scope='student' AND created_by=? UNION ALL SELECT f.id FROM folders f JOIN tree t ON f.parent_id=t.id WHERE f.scope='student' AND f.created_by=?) UPDATE folders SET trashed_at=?,updated_at=? WHERE id IN (SELECT id FROM tree)`).bind(folderId,studentId,studentId,stamp,stamp)]);return json({ok:true});
    }

    if(staff(current)&&(action==="rename_student_assignment"||action==="delete_student_assignment")){
      const studentId=String(get(data,"studentId")??""),assignmentId=String(get(data,"assignmentId")??"");
      if(!await ownsStudent(current,studentId))return json({error:"Accès refusé."},403);
      const assigned=await env.DB.prepare(`SELECT 1 ok FROM assignment_students ast JOIN assignments a ON a.id=ast.assignment_id WHERE ast.assignment_id=? AND ast.student_id=? AND a.trashed_at IS NULL`).bind(assignmentId,studentId).first();
      if(!assigned)return json({error:"Activité introuvable."},404);
      const stamp=now();
      if(action==="rename_student_assignment"){
        const name=String(get(data,"name")??"").trim();if(!name||name.length>180)return json({error:"Nom invalide."},400);
        await env.DB.prepare(`INSERT INTO student_assignment_folders(assignment_id,student_id,custom_title,updated_at) VALUES(?,?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET custom_title=excluded.custom_title,updated_at=excluded.updated_at`).bind(assignmentId,studentId,name,stamp).run();
      }else{
        await env.DB.prepare(`INSERT INTO student_assignment_folders(assignment_id,student_id,hidden_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET hidden_at=excluded.hidden_at,updated_at=excluded.updated_at`).bind(assignmentId,studentId,stamp,stamp).run();
      }
      await audit(current,action,"assignment",assignmentId,{studentId});return json({ok:true});
    }

    if(staff(current)&&action==="view_student_space"){
      const studentId=String(get(data,"studentId")??"");if(!(await ownsStudent(current,studentId)))return json({error:"Accès refusé."},403);
      const student=await env.DB.prepare(`SELECT id,username,display_name,role,must_change_password FROM users WHERE id=? AND role='student' AND active=1 AND trashed_at IS NULL`).bind(studentId).first<User>();if(!student)return json({error:"Élève introuvable."},404);
      return json({ok:true,portal:{authenticated:true,csrfToken:current.csrf_token,...await studentDashboard(studentId,student)}});
    }

    if (action === "get_progress" || action === "save_progress") {
      const assignmentId=String(get(data,"assignmentId")??"");
      const studentId=staff(current)?String(get(data,"studentId")??""):current.id;
      if(staff(current)&&!await ownsStudent(current,studentId))return json({error:"Accès refusé."},403);
      const assignment=await env.DB.prepare(`SELECT COALESCE(v.runtime_kind,'generic') runtime_kind,COALESCE(v.online_capable,0) online_capable FROM assignment_students ast JOIN assignments a ON a.id=ast.assignment_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id WHERE ast.assignment_id=? AND ast.student_id=? AND a.status='published' AND a.trashed_at IS NULL`).bind(assignmentId,studentId).first<{runtime_kind:string;online_capable:number}>();
      if(!assignment)return json({error:"Devoir introuvable."},404);
      if(assignment.runtime_kind!=="glassbook"||Number(assignment.online_capable)!==1)return json({error:"Cette activité a été créée avec une ancienne version de Glassbook. Votre enseignant doit l’exporter de nouveau pour activer la sauvegarde et la remise en ligne."},409);
      const work=await env.DB.prepare(`SELECT id,status,state_r2_key,state_size,state_version,saved_at FROM student_work WHERE assignment_id=? AND student_id=?`).bind(assignmentId,studentId).first<{id:string;status:string;state_r2_key:string|null;state_size:number;state_version:number;saved_at:string|null}>();
      if(action==="get_progress"){
        if(!work?.state_r2_key)return json({ok:true,envelope:null,status:work?.status??"draft",stateVersion:work?.state_version??0,savedAt:work?.saved_at??null});
        if(work.state_size>MAX_STUDENT_STATE_BYTES)return json({error:"Le travail enregistré dépasse la taille autorisée."},413);
        const object=await env.FILES.get(work.state_r2_key);if(!object)return json({error:"Le travail enregistré est introuvable."},404);
        const text=await object.text();if(new TextEncoder().encode(text).byteLength>MAX_STUDENT_STATE_BYTES)return json({error:"Le travail enregistré dépasse la taille autorisée."},413);
        try{return json({ok:true,envelope:JSON.parse(text),status:work.status,stateVersion:work.state_version,savedAt:work.saved_at});}catch{return json({error:"Le travail enregistré est endommagé."},500);}
      }
      const envelope=get(data,"envelope") as Record<string,unknown>|null;
      if(!envelope||envelope.schema!=="glassbook.student-state"||Number(envelope.schemaVersion)!==1||envelope.app!=="glassbook"||typeof envelope.documentId!=="string"||!envelope.documentId||typeof envelope.state!=="object"||envelope.state===null)return json({error:"État Glassbook invalide."},400);
      const serialized=JSON.stringify(envelope),stateSize=new TextEncoder().encode(serialized).byteLength;if(stateSize>MAX_STUDENT_STATE_BYTES)return json({error:"Le travail dépasse la taille maximale de 25 Mo."},413);
      if(!staff(current)&&(work?.status==="submitted"||work?.status==="locked"))return json({error:"Ce travail est terminé. Votre professeur doit le rouvrir avant toute modification."},409);
      const expectedVersion=Number(get(data,"expectedStateVersion")??work?.state_version??0);if(work&&expectedVersion!==work.state_version)return json({error:"Une version plus récente a été enregistrée. Rechargez le travail avant de continuer.",stateVersion:work.state_version},409);
      const stamp=now(),stateKey=`student-work/${assignmentId}/${studentId}/state.json`,stateVersion=(work?.state_version??0)+1,nextStatus=staff(current)?(work?.status??"draft"):"draft";
      await env.FILES.put(stateKey,serialized,{httpMetadata:{contentType:"application/json; charset=utf-8"}});
      await env.DB.batch([env.DB.prepare(`INSERT INTO student_work(id,assignment_id,student_id,status,state_r2_key,state_size,state_version,saved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET status=excluded.status,state_r2_key=excluded.state_r2_key,state_size=excluded.state_size,state_version=excluded.state_version,saved_at=excluded.saved_at,updated_at=excluded.updated_at`).bind(work?.id??id(),assignmentId,studentId,nextStatus,stateKey,stateSize,stateVersion,stamp,stamp,stamp),env.DB.prepare(`UPDATE assignment_students SET status=CASE WHEN status='assigned' THEN 'opened' ELSE status END,opened_at=COALESCE(opened_at,?) WHERE assignment_id=? AND student_id=?`).bind(stamp,assignmentId,studentId)]);
      return json({ok:true,stateVersion,savedAt:stamp});
    }

    if (action === "create_student" || action === "create_teacher") {
      if (action === "create_teacher" && current.role !== "owner") return json({error:"Réservé à l’administrateur principal."},403);
      const username=String(get(data,"username")??"").trim().toLowerCase(),name=String(get(data,"displayName")??"").trim(),password=String(get(data,"password")??"");
      if(!/^[a-z0-9._@+-]{3,80}$/.test(username)||!name||!password)return json({error:"Identifiant, nom ou mot de passe manquant."},400);
      const role:Role=action==="create_teacher"?"teacher":"student", userId=id(), hashed=await passwordHash(password),stamp=now(),folderId=role==="student"?(String(get(data,"folderId")??"")||null):null;
      const teacherId=role==="student"&&current.role==="owner"&&String(get(data,"teacherId")??"")?String(get(data,"teacherId")):current.id;
      if(role==="student"){const teacher=await env.DB.prepare(`SELECT 1 ok FROM users WHERE id=? AND role IN ('owner','teacher') AND active=1`).bind(teacherId).first();if(!teacher)return json({error:"Enseignant invalide."},400);}
      if(folderId){const folder=await env.DB.prepare(`SELECT created_by FROM folders WHERE id=? AND scope='students' AND trashed_at IS NULL`).bind(folderId).first<{created_by:string}>();if(!folder||(current.role!=="owner"&&folder.created_by!==current.id))return json({error:"Dossier invalide."},400);}
      const statements=[env.DB.prepare(`INSERT INTO users(id,username,display_name,role,password_hash,password_salt,active,must_change_password,folder_id,created_by,created_at) VALUES(?,?,?,?,?,?,1,1,?,?,?)`).bind(userId,username,name,role,hashed.hash,hashed.salt,folderId,current.id,stamp)];
      if(role==="student")statements.push(env.DB.prepare(`INSERT INTO teacher_students(student_id,teacher_id,assigned_at,assigned_by) VALUES(?,?,?,?)`).bind(userId,teacherId,stamp,current.id));
      await env.DB.batch(statements); await audit(current,action,role,userId,{teacherId:role==="student"?teacherId:undefined}); return json({ok:true,id:userId});
    }

    if(action==="update_teacher_upload_permission"){
      if(current.role!=="owner")return json({error:"Réservé à l’administrateur principal."},403);
      const teacherId=String(get(data,"teacherId")??""),permission=String(get(data,"permission")??"");
      if(!["none","review","immediate"].includes(permission))return json({error:"Permission invalide."},400);
      const result=await env.DB.prepare(`UPDATE users SET upload_permission=?,updated_at=? WHERE id=? AND role='teacher'`).bind(permission,now(),teacherId).run();
      if(!result.meta.changes)return json({error:"Enseignant introuvable."},404);
      await audit(current,action,"teacher",teacherId,{permission});return json({ok:true});
    }

    if(action==="approve_activity"){
      if(current.role!=="owner")return json({error:"Réservé à l’administrateur principal."},403);
      const activityId=String(get(data,"activityId")??""),result=await env.DB.prepare(`UPDATE activities SET publication_status='published',updated_at=? WHERE id=? AND publication_status='pending' AND trashed_at IS NULL`).bind(now(),activityId).run();
      if(!result.meta.changes)return json({error:"Activité introuvable ou déjà publiée."},404);
      await audit(current,action,"activity",activityId);return json({ok:true});
    }

    if (["update_teacher","deactivate_teacher","reset_password","transfer_students"].includes(action)) {
      if (action === "update_teacher" || action === "deactivate_teacher" || action === "transfer_students") if(current.role!=="owner")return json({error:"Réservé à l’administrateur principal."},403);
      if(action==="reset_password"){
        const userId=String(get(data,"userId")??""),password=String(get(data,"password")??""); if(!password)return json({error:"Mot de passe requis."},400);
        const target=await env.DB.prepare(`SELECT role FROM users WHERE id=?`).bind(userId).first<{role:Role}>(); if(!target||target.role==="owner"&&userId!==current.id||current.role==="teacher"&&!(await ownsStudent(current,userId)))return json({error:"Accès refusé."},403);
        const hashed=await passwordHash(password);await env.DB.batch([env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,must_change_password=1,updated_at=? WHERE id=?`).bind(hashed.hash,hashed.salt,now(),userId),env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(userId)]);await audit(current,action,"user",userId);return json({ok:true});
      }
      if(action==="transfer_students"){
        const studentIds=ids(get(data,"studentIds")),teacherId=String(get(data,"teacherId")??""),teacher=await env.DB.prepare(`SELECT 1 ok FROM users WHERE id=? AND role IN ('owner','teacher') AND active=1`).bind(teacherId).first();if(!studentIds.length||!teacher)return json({error:"Transfert invalide."},400);
        const marks=placeholders(studentIds),valid=await env.DB.prepare(`SELECT COUNT(*) count FROM users WHERE id IN (${marks}) AND role='student'`).bind(...studentIds).first<{count:number}>();if(valid?.count!==studentIds.length)return json({error:"La sélection contient un compte invalide."},400);
        await env.DB.batch([...studentIds.map(studentId=>env.DB.prepare(`INSERT INTO teacher_students(student_id,teacher_id,assigned_at,assigned_by) VALUES(?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET teacher_id=excluded.teacher_id,assigned_at=excluded.assigned_at,assigned_by=excluded.assigned_by`).bind(studentId,teacherId,now(),current.id)),env.DB.prepare(`UPDATE users SET folder_id=NULL,updated_at=? WHERE id IN (${marks})`).bind(now(),...studentIds)]);await audit(current,action,"student",null,{studentIds,teacherId});return json({ok:true});
      }
      const teacherId=String(get(data,"teacherId")??""); if(teacherId===current.id)return json({error:"Le compte principal est protégé."},400);
      if(action==="deactivate_teacher"){const students=await env.DB.prepare(`SELECT COUNT(*) count FROM teacher_students WHERE teacher_id=?`).bind(teacherId).first<{count:number}>();if(students?.count)return json({error:"Transférez d’abord les élèves de cet enseignant."},409);await env.DB.batch([env.DB.prepare(`UPDATE users SET active=0,deactivated_at=?,updated_at=? WHERE id=? AND role='teacher'`).bind(now(),now(),teacherId),env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(teacherId)]);}
      else {const name=String(get(data,"displayName")??"").trim(),username=String(get(data,"username")??"").trim().toLowerCase();if(!name||!/^[a-z0-9._@+-]{3,80}$/.test(username))return json({error:"Informations invalides."},400);await env.DB.prepare(`UPDATE users SET display_name=?,username=?,updated_at=? WHERE id=? AND role='teacher'`).bind(name,username,now(),teacherId).run();}
      await audit(current,action,"teacher",teacherId);return json({ok:true});
    }

    if(action==="create_folder"){
      const name=String(get(data,"name")??"").trim(),rawScope=String(get(data,"scope")??""),scope=rawScope==="submissions"?"corrections":rawScope,parentId=String(get(data,"parentId")??"")||null;if(!name||!folderScopes.includes(scope))return json({error:"Dossier invalide."},400);
      if(parentId){const parent=await env.DB.prepare(`SELECT scope,created_by FROM folders WHERE id=? AND trashed_at IS NULL`).bind(parentId).first<{scope:string;created_by:string}>();if(!parent||parent.scope!==scope||(current.role!=="owner"&&scope!=="activities"&&parent.created_by!==current.id))return json({error:"Dossier parent invalide."},400);}
      const folderId=id();await env.DB.prepare(`INSERT INTO folders(id,name,scope,parent_id,created_by,created_at) VALUES(?,?,?,?,?,?)`).bind(folderId,name,scope,parentId,current.id,now()).run();await audit(current,action,"folder",folderId,{scope,parentId});return json({ok:true,id:folderId});
    }

    if(action==="update_item"&&String(get(data,"kind")??"")==="settings"){
      if(current.role!=="owner")return json({error:"Réservé à l’administrateur principal."},403);const days=Number(get(data,"trashRetentionDays")??get(data,"trash_retention_days")??30);if(!Number.isInteger(days)||days<1||days>365)return json({error:"La durée doit être comprise entre 1 et 365 jours."},400);await env.DB.prepare(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES('trash_retention_days',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(String(days),current.id,now()).run();await audit(current,"update_settings","settings",null,{trashRetentionDays:days});return json({ok:true,settings:{trash_retention_days:days}});
    }
    if(action==="rename_item"||action==="update_item"){
      const kind=String(get(data,"kind")??""),recordId=String(get(data,"id")??"");if(!entityKinds.includes(kind)||!recordId)return json({error:"Élément invalide."},400);
      if(kind==="student"||kind==="teacher"){const target=await env.DB.prepare(`SELECT role FROM users WHERE id=?`).bind(recordId).first<{role:Role}>(),expected=kind==="student"?"student":"teacher";if(!target||target.role!==expected||target.role==="owner")return json({error:"Compte protégé ou type de compte invalide."},403);}
      if(kind==="teacher"){if(current.role!=="owner")return json({error:"Accès refusé."},403);}else if(!(await owns(current,kind,recordId)))return json({error:"Accès refusé."},403);
      if(kind==="activity"){
        const patch:Record<string,unknown>={};for(const key of ["title","category","description","instructions","externalUrl"])if(has(data,key))patch[key]=get(data,key);if(action==="rename_item")patch.title=String(get(data,"name")??"");await createVersion(current,recordId,patch);
      }else if(kind==="assignment"){
        const status=has(data,"status")?String(get(data,"status")):null;if(status&&!["published","paused","cancelled"].includes(status))return json({error:"Statut invalide."},400);
        const row=await env.DB.prepare(`SELECT due_at,instructions,status,folder_id FROM assignments WHERE id=?`).bind(recordId).first<Record<string,unknown>>();await env.DB.prepare(`UPDATE assignments SET due_at=?,instructions=?,status=?,folder_id=?,updated_at=? WHERE id=?`).bind(has(data,"dueAt")?String(get(data,"dueAt")??"")||null:row?.due_at,has(data,"instructions")?String(get(data,"instructions")??""):row?.instructions,status??row?.status,has(data,"folderId")?String(get(data,"folderId")??"")||null:row?.folder_id,now(),recordId).run();
      }else if(kind==="student"||kind==="teacher"){
        const name=String(action==="rename_item"?get(data,"name"):get(data,"displayName")??"").trim();const username=has(data,"username")?String(get(data,"username")??"").trim().toLowerCase():null;if(!name)return json({error:"Nom invalide."},400);if(username&&!/^[a-z0-9._@+-]{3,80}$/.test(username))return json({error:"Identifiant invalide."},400);await env.DB.prepare(`UPDATE users SET display_name=?,username=COALESCE(?,username),updated_at=? WHERE id=?`).bind(name,username,now(),recordId).run();
      }else if(kind==="submission"){
        const status=String(get(data,"status")??"");if(!["submitted","corrected"].includes(status))return json({error:"Statut invalide."},400);await env.DB.prepare(`UPDATE submissions SET corrected_at=?,updated_at=? WHERE id=?`).bind(status==="corrected"?now():null,now(),recordId).run();
      }else if(kind==="folder"){
        const name=String(action==="rename_item"?get(data,"name"):get(data,"name")??"").trim();if(!name)return json({error:"Nom invalide."},400);await env.DB.prepare(`UPDATE folders SET name=?,updated_at=? WHERE id=?`).bind(name,now(),recordId).run();
      }else return json({error:"Modification non prise en charge."},400);
      await audit(current,action,kind,recordId);return json({ok:true});
    }

    if(["move_items","trash_items","archive_items","restore_items"].includes(action)){const kind=String(get(data,"kind")??""),recordIds=ids(get(data,"ids"));await mutateItems(current,action,kind,recordIds,String(get(data,"folderId")??"")||null);return json({ok:true});}
    if(action==="purge_items"){await purgeItems(current,String(get(data,"kind")??""),ids(get(data,"ids")));return json({ok:true});}
    if(action==="duplicate_items"){const createdIds=await duplicateItems(current,String(get(data,"kind")??""),ids(get(data,"ids")));return json({ok:true,createdIds});}
    if(action==="update_settings"){
      if(current.role!=="owner")return json({error:"Réservé à l’administrateur principal."},403);const days=Number(get(data,"trashRetentionDays")??get(data,"trash_retention_days")??30);if(!Number.isInteger(days)||days<1||days>365)return json({error:"La durée doit être comprise entre 1 et 365 jours."},400);await env.DB.prepare(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES('trash_retention_days',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(String(days),current.id,now()).run();await audit(current,action,"settings",null,{trashRetentionDays:days});return json({ok:true,settings:{trash_retention_days:days}});
    }

    if(action==="create_activity"){
      if(uploadMode(current)==="none")return json({error:"L’administrateur doit autoriser le dépôt d’activités."},403);
      const title=String(get(data,"title")??"").trim(),category=String(get(data,"category")??""),file=get(data,"file"),externalUrl=normalizedExternalUrl(get(data,"externalUrl")),folderId=String(get(data,"folderId")??"")||null;if(!title||!categories.includes(category))return json({error:"Titre ou catégorie invalide."},400);
      if(folderId&&!await env.DB.prepare(`SELECT 1 ok FROM folders WHERE id=? AND scope='activities' AND trashed_at IS NULL`).bind(folderId).first())return json({error:"Dossier invalide."},400);
      const activityId=id(),versionId=id(),stamp=now();let r2Key:string|null=null,originalName:string|null=null,contentType:string|null=null,fileSize=0;
      if(file instanceof File&&file.size){if(file.size>50*1024*1024)return json({error:"Fichier trop volumineux (50 Mo maximum)."},413);fileSize=file.size;r2Key=`activities/${current.id}/${activityId}/v1/${safeFileName(file.name)}`;originalName=file.name;contentType=(file.type||"application/octet-stream").replace(/[\r\n]/g,"").slice(0,200)||"application/octet-stream";await env.FILES.put(r2Key,file.stream(),{httpMetadata:{contentType}});}
      if(!r2Key&&!externalUrl&&category!=="Écriture")return json({error:"Ajoutez un fichier ou un lien."},400);
      const description=String(get(data,"description")??""),instructions=String(get(data,"instructions")??""),runtimeKind=["glassbook","pellucide"].includes(String(get(data,"runtimeKind")))?String(get(data,"runtimeKind")):"generic",onlineCapable=runtimeKind==="glassbook"?1:0;
      const publicationStatus=uploadMode(current)==="review"?"pending":"published";
      try{await env.DB.batch([env.DB.prepare(`INSERT INTO activities(id,title,category,description,instructions,r2_key,original_name,content_type,external_url,current_version_id,folder_id,created_by,created_at,publication_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(activityId,title,category,description,instructions,r2Key,originalName,contentType,externalUrl,versionId,folderId,current.id,stamp,publicationStatus),env.DB.prepare(`INSERT INTO activity_versions(id,activity_id,version_number,title,category,description,instructions,r2_key,original_name,content_type,external_url,file_size,runtime_kind,online_capable,manifest_version,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).bind(versionId,activityId,1,title,category,description,instructions,r2Key,originalName,contentType,externalUrl,fileSize,runtimeKind,onlineCapable,current.id,stamp)]);}catch(error){if(r2Key)await env.FILES.delete(r2Key);throw error;}await audit(current,action,"activity",activityId,{publicationStatus});return json({ok:true,activityId,publicationStatus});
    }

    if(action==="init_activity_upload"){
      if(uploadMode(current)==="none")return json({error:"L’administrateur doit autoriser le dépôt d’activités."},403);
      const title=String(get(data,"title")??"").trim(),category=String(get(data,"category")??""),fileName=String(get(data,"fileName")??"activity.html"),fileSize=Number(get(data,"fileSize")??0),description=String(get(data,"description")??""),instructions=String(get(data,"instructions")??""),folderId=String(get(data,"folderId")??"")||null,contentType=String(get(data,"contentType")??"application/octet-stream").replace(/[\r\n]/g,"").slice(0,200)||"application/octet-stream";if(!title||!categories.includes(category))return json({error:"Titre ou catégorie invalide."},400);if(!Number.isInteger(fileSize)||fileSize<1||fileSize>50*1024*1024)return json({error:"Le fichier doit faire moins de 50 Mo."},413);
      if(folderId&&!await env.DB.prepare(`SELECT 1 ok FROM folders WHERE id=? AND scope='activities' AND trashed_at IS NULL`).bind(folderId).first())return json({error:"Dossier invalide."},400);
      await env.DB.prepare(`DELETE FROM upload_sessions WHERE user_id=? AND status<>'completed' AND expires_at<=?`).bind(current.id,now()).run();
      const activeUploads=await env.DB.prepare(`SELECT COUNT(*) count FROM upload_sessions WHERE user_id=? AND status<>'completed' AND expires_at>?`).bind(current.id,now()).first<{count:number}>();if((activeUploads?.count??0)>=3)return json({error:"Terminez ou annulez un téléversement en cours avant d’en commencer un autre."},429);
      const activityId=id(),versionId=id(),key=`activities/${current.id}/${activityId}/v1/${safeFileName(fileName)}`,uploadId=id(),partCount=Math.ceil(fileSize/(512*1024)),stamp=now();
      await env.DB.prepare(`INSERT INTO upload_sessions(id,user_id,activity_id,version_id,r2_key,title,category,description,instructions,folder_id,original_name,content_type,file_size,part_count,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'uploading',?,?)`).bind(uploadId,current.id,activityId,versionId,key,title,category,description,instructions,folderId,fileName,contentType,fileSize,partCount,new Date(Date.now()+60*60_000).toISOString(),stamp).run();return json({ok:true,activityId,versionId,key,uploadId});
    }
    if(action==="complete_activity_upload"){
      if(uploadMode(current)==="none")return json({error:"L’autorisation de dépôt a été retirée."},403);
      const activityId=String(get(data,"activityId")??""),key=String(get(data,"key")??""),uploadId=String(get(data,"uploadId")??""),parts=get(data,"parts") as Array<{partNumber:number;etag:string}>;
      const grant=await env.DB.prepare(`SELECT * FROM upload_sessions WHERE id=? AND user_id=? AND status='uploading' AND expires_at>?`).bind(uploadId,current.id,now()).first<Record<string,unknown>>();
      if(!grant||grant.activity_id!==activityId||grant.r2_key!==key||!key.startsWith(`activities/${current.id}/${activityId}/v1/`)||!Array.isArray(parts)||parts.length!==Number(grant.part_count))return json({error:"Téléversement incomplet ou session expirée."},400);
      if(await env.DB.prepare(`SELECT 1 ok FROM activities WHERE id=?`).bind(activityId).first())return json({error:"Cette activité existe déjà."},409);
      const ordered=[...parts].sort((a,b)=>a.partNumber-b.partNumber);if(ordered.some((part,index)=>part.partNumber!==index+1||!part.etag))return json({error:"Parties de fichier invalides."},400);
      const claimed=await env.DB.prepare(`UPDATE upload_sessions SET status='assembling' WHERE id=? AND user_id=? AND status='uploading'`).bind(uploadId,current.id).run();if(!claimed.meta.changes)return json({error:"Cette session de téléversement a déjà été utilisée."},409);
      const fileSize=Number(grant.file_size),contentType=String(grant.content_type),prefix=stagedUploadPrefix(key,uploadId),keys=ordered.map(part=>stagedPartKey(prefix,part.partNumber)),fixed=new FixedLengthStream(fileSize),writer=fixed.writable.getWriter(),finalUpload=env.FILES.put(key,fixed.readable,{httpMetadata:{contentType}});let uploadedSize=0;
      try{for(let index=0;index<keys.length;index++){const object=await env.FILES.get(keys[index]);if(!object||object.etag!==ordered[index].etag)throw new Response("Une partie du fichier est manquante.",{status:400});uploadedSize+=object.size;const reader=object.body.getReader();while(true){const next=await reader.read();if(next.done)break;await writer.write(next.value);}reader.releaseLock();}if(uploadedSize!==fileSize)throw new Response("Le fichier téléversé est incomplet.",{status:400});await writer.close();await finalUpload;}catch(error){try{await writer.abort(error);}catch{}try{await finalUpload;}catch{}await env.DB.prepare(`UPDATE upload_sessions SET status='uploading' WHERE id=? AND status='assembling'`).bind(uploadId).run();throw error;}
      const versionId=String(grant.version_id),stamp=now(),title=String(grant.title),category=String(grant.category),description=String(grant.description??""),instructions=String(grant.instructions??""),runtimeKind=["glassbook","pellucide"].includes(String(get(data,"runtimeKind")))?String(get(data,"runtimeKind")):"generic",onlineCapable=runtimeKind==="glassbook"?1:0,folderId=grant.folder_id?String(grant.folder_id):null,originalName=String(grant.original_name);
      const publicationStatus=uploadMode(current)==="review"?"pending":"published";
      try{await env.DB.batch([env.DB.prepare(`INSERT INTO activities(id,title,category,description,instructions,r2_key,original_name,content_type,current_version_id,folder_id,created_by,created_at,publication_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(activityId,title,category,description,instructions,key,originalName,contentType,versionId,folderId,current.id,stamp,publicationStatus),env.DB.prepare(`INSERT INTO activity_versions(id,activity_id,version_number,title,category,description,instructions,r2_key,original_name,content_type,file_size,runtime_kind,online_capable,manifest_version,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).bind(versionId,activityId,1,title,category,description,instructions,key,originalName,contentType,fileSize,runtimeKind,onlineCapable,current.id,stamp),env.DB.prepare(`UPDATE upload_sessions SET status='completed' WHERE id=? AND status='assembling'`).bind(uploadId)]);}catch(error){await env.FILES.delete(key);await env.DB.prepare(`UPDATE upload_sessions SET status='uploading' WHERE id=? AND status='assembling'`).bind(uploadId).run();throw error;}
      try{await deleteStagedUpload(prefix);}catch{}await audit(current,action,"activity",activityId,{publicationStatus});return json({ok:true,activityId,publicationStatus});
    }
    if(action==="abort_activity_upload"){const key=String(get(data,"key")??""),uploadId=String(get(data,"uploadId")??""),grant=await env.DB.prepare(`SELECT r2_key,status FROM upload_sessions WHERE id=? AND user_id=?`).bind(uploadId,current.id).first<{r2_key:string;status:string}>();if(grant&&grant.r2_key===key&&grant.status!=="completed"){await deleteStagedUpload(stagedUploadPrefix(key,uploadId));await env.DB.prepare(`DELETE FROM upload_sessions WHERE id=? AND user_id=? AND status<>'completed'`).bind(uploadId,current.id).run();}return json({ok:true});}

    if(action==="assign"){
      const activityIds=ids(get(data,"activityIds")).length?ids(get(data,"activityIds")):ids(get(data,"activityId")),studentIds=ids(get(data,"studentIds")),folderId=String(get(data,"folderId")??"")||null;if(!activityIds.length||!studentIds.length)return json({error:"Choisissez une activité et au moins un élève."},400);
      for(const studentId of studentIds)if(!(await ownsStudent(current,studentId)))return json({error:"Un élève ne vous appartient pas."},403);
      if(folderId){const folder=await env.DB.prepare(`SELECT created_by FROM folders WHERE id=? AND scope='assignments' AND trashed_at IS NULL`).bind(folderId).first<{created_by:string}>();if(!folder||(current.role!=="owner"&&folder.created_by!==current.id))return json({error:"Dossier invalide."},400);}
      const createdIds:string[]=[],stamp=now();for(const activityId of activityIds){const activity=await env.DB.prepare(`SELECT a.current_version_id FROM activities a JOIN activity_versions v ON v.id=a.current_version_id AND v.activity_id=a.id WHERE a.id=? AND a.publication_status='published' AND a.trashed_at IS NULL AND a.archived_at IS NULL`).bind(activityId).first<{current_version_id:string}>();if(!activity?.current_version_id)return json({error:"Cette activité doit être publiée avant d’être envoyée."},409);const assignmentId=id();await env.DB.batch([env.DB.prepare(`INSERT INTO assignments(id,activity_id,activity_version_id,folder_id,due_at,instructions,status,published_at,created_by) VALUES(?,?,?,?,?,?,'published',?,?)`).bind(assignmentId,activityId,activity.current_version_id,folderId,String(get(data,"dueAt")??"")||null,String(get(data,"instructions")??""),stamp,current.id),...studentIds.map(studentId=>env.DB.prepare(`INSERT INTO assignment_students(assignment_id,student_id,status,assigned_at) VALUES(?,?,'assigned',?)`).bind(assignmentId,studentId,stamp))]);createdIds.push(assignmentId);}await audit(current,action,"assignment",null,{activityIds,studentIds,createdIds,folderId});return json({ok:true,createdIds});
    }
    if(action==="open_assignment"){
      const assignmentId=String(get(data,"assignmentId")??"");const result=await env.DB.prepare(`UPDATE assignment_students SET status=CASE WHEN status='assigned' THEN 'opened' ELSE status END,opened_at=COALESCE(opened_at,?) WHERE assignment_id=? AND student_id=? AND EXISTS(SELECT 1 FROM assignments a WHERE a.id=? AND a.status='published' AND a.trashed_at IS NULL)`).bind(now(),assignmentId,current.id,assignmentId).run();if(!result.meta.changes)return json({error:"Devoir introuvable."},404);return json({ok:true});
    }
    if(action==="complete_assignment"){
      const assignmentId=String(get(data,"assignmentId")??""),stamp=now();
      const work=await env.DB.prepare(`SELECT id FROM student_work WHERE assignment_id=? AND student_id=? AND state_r2_key IS NOT NULL`).bind(assignmentId,current.id).first<{id:string}>();if(!work)return json({error:"Enregistrez votre travail avant de le terminer."},409);
      const result=await env.DB.prepare(`UPDATE assignment_students SET status='submitted',completed_at=? WHERE assignment_id=? AND student_id=? AND status IN ('assigned','opened') AND EXISTS(SELECT 1 FROM assignments a WHERE a.id=? AND a.status='published' AND a.trashed_at IS NULL)`).bind(stamp,assignmentId,current.id,assignmentId).run();if(!result.meta.changes)return json({error:"Ce travail est déjà signalé comme terminé."},409);
      const existing=await env.DB.prepare(`SELECT id FROM submissions WHERE assignment_id=? AND student_id=?`).bind(assignmentId,current.id).first<{id:string}>(),submissionId=existing?.id??id();
      await env.DB.batch([env.DB.prepare(`INSERT INTO submissions(id,assignment_id,student_id,writing,r2_key,original_name,content_type,file_size,submitted_at,updated_at) VALUES(?,?,?,NULL,NULL,NULL,NULL,0,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,corrected_at=NULL,trashed_at=NULL`).bind(submissionId,assignmentId,current.id,stamp,stamp),env.DB.prepare(`UPDATE student_work SET status='submitted',submitted_at=?,updated_at=? WHERE assignment_id=? AND student_id=?`).bind(stamp,stamp,assignmentId,current.id)]);
      return json({ok:true,submissionId});
    }
    if(action==="submit"){
      const assignmentId=String(get(data,"assignmentId")??""),stamp=now(),stale=new Date(Date.now()-15*60_000).toISOString();
      const locked=await env.DB.prepare(`UPDATE assignment_students SET status='submitting',opened_at=? WHERE assignment_id=? AND student_id=? AND (status IN ('assigned','opened') OR (status='submitting' AND opened_at<?)) AND EXISTS(SELECT 1 FROM assignments a WHERE a.id=? AND a.status='published' AND a.trashed_at IS NULL)`).bind(stamp,assignmentId,current.id,stale,assignmentId).run();
      if(!locked.meta.changes)return json({error:"Ce travail a déjà été envoyé. Votre professeur doit le rouvrir avant toute modification."},409);
      const old=await env.DB.prepare(`SELECT id,r2_key FROM submissions WHERE assignment_id=? AND student_id=?`).bind(assignmentId,current.id).first<{id:string;r2_key:string|null}>(),file=get(data,"file");let r2Key:string|null=null,originalName:string|null=null,contentType:string|null=null,fileSize=0;
      try{
        if(file instanceof File&&file.size){if(file.size>25*1024*1024)throw new Response("Fichier trop volumineux (25 Mo maximum).",{status:413});r2Key=`submissions/${assignmentId}/${current.id}/${id()}-${safeFileName(file.name)}`;originalName=file.name;contentType=(file.type||"application/octet-stream").replace(/[\r\n]/g,"").slice(0,200);fileSize=file.size;await env.FILES.put(r2Key,file.stream(),{httpMetadata:{contentType}});}
        const submissionId=old?.id??id();await env.DB.batch([env.DB.prepare(`INSERT INTO submissions(id,assignment_id,student_id,writing,r2_key,original_name,content_type,file_size,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET writing=excluded.writing,r2_key=COALESCE(excluded.r2_key,submissions.r2_key),original_name=COALESCE(excluded.original_name,submissions.original_name),content_type=COALESCE(excluded.content_type,submissions.content_type),file_size=CASE WHEN excluded.r2_key IS NULL THEN submissions.file_size ELSE excluded.file_size END,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,trashed_at=NULL`).bind(submissionId,assignmentId,current.id,String(get(data,"writing")??"")||null,r2Key,originalName,contentType,fileSize,stamp,stamp),env.DB.prepare(`UPDATE assignment_students SET status='submitted',completed_at=? WHERE assignment_id=? AND student_id=? AND status='submitting'`).bind(stamp,assignmentId,current.id),env.DB.prepare(`UPDATE student_work SET status='submitted',submitted_at=?,updated_at=? WHERE assignment_id=? AND student_id=?`).bind(stamp,stamp,assignmentId,current.id)]);if(r2Key&&old?.r2_key&&old.r2_key!==r2Key)await env.FILES.delete(old.r2_key);return json({ok:true});
      }catch(error){if(r2Key)await env.FILES.delete(r2Key);await env.DB.prepare(`UPDATE assignment_students SET status='opened' WHERE assignment_id=? AND student_id=? AND status='submitting'`).bind(assignmentId,current.id).run();throw error;}
    }
    if(action==="reopen_submission"){
      const submissionId=String(get(data,"submissionId")??"");if(!(await owns(current,"submission",submissionId)))return json({error:"Accès refusé."},403);const row=await env.DB.prepare(`SELECT assignment_id,student_id FROM submissions WHERE id=?`).bind(submissionId).first<{assignment_id:string;student_id:string}>();if(!row)return json({error:"Travail introuvable."},404);await env.DB.batch([env.DB.prepare(`UPDATE assignment_students SET status='opened',completed_at=NULL WHERE assignment_id=? AND student_id=?`).bind(row.assignment_id,row.student_id),env.DB.prepare(`UPDATE submissions SET corrected_at=NULL,updated_at=? WHERE id=?`).bind(now(),submissionId),env.DB.prepare(`UPDATE student_work SET status='draft',submitted_at=NULL,updated_at=? WHERE assignment_id=? AND student_id=?`).bind(now(),row.assignment_id,row.student_id)]);await audit(current,action,"submission",submissionId);return json({ok:true});
    }
    if(action==="feedback"||action==="return_correction"){
      const submissionId=String(get(data,"submissionId")??"");if(!(await owns(current,"submission",submissionId)))return json({error:"Accès refusé."},403);
      const existing=await env.DB.prepare(`SELECT corrected_r2_key,feedback FROM submissions WHERE id=?`).bind(submissionId).first<{corrected_r2_key:string|null;feedback:string|null}>();if(!existing)return json({error:"Travail introuvable."},404);
      const correctedFile=get(data,"correctedFile");let correctedKey:string|null=null,correctedName:string|null=null,correctedType:string|null=null,correctedSize=0;
      if(correctedFile instanceof File&&correctedFile.size){if(correctedFile.size>25*1024*1024)return json({error:"Fichier corrigé trop volumineux (25 Mo maximum)."},413);correctedName=correctedFile.name;correctedType=(correctedFile.type||"application/octet-stream").replace(/[\r\n]/g,"").slice(0,200);correctedSize=correctedFile.size;correctedKey=`corrections/${submissionId}/${id()}-${safeFileName(correctedFile.name)}`;await env.FILES.put(correctedKey,correctedFile.stream(),{httpMetadata:{contentType:correctedType}});}
      const feedback=String(get(data,"feedback")??"").trim();if(!feedback&&!correctedKey&&!existing.corrected_r2_key)return json({error:"Ajoutez un commentaire ou un fichier corrigé avant de l’envoyer."},400);
      const stamp=now();try{await env.DB.prepare(`UPDATE submissions SET feedback=?,corrected_r2_key=COALESCE(?,corrected_r2_key),corrected_original_name=COALESCE(?,corrected_original_name),corrected_content_type=COALESCE(?,corrected_content_type),corrected_file_size=CASE WHEN ? IS NULL THEN corrected_file_size ELSE ? END,corrected_at=?,updated_at=? WHERE id=?`).bind(feedback,correctedKey,correctedName,correctedType,correctedKey,correctedSize,stamp,stamp,submissionId).run();}catch(error){if(correctedKey)await env.FILES.delete(correctedKey);throw error;}
      if(correctedKey&&existing.corrected_r2_key&&existing.corrected_r2_key!==correctedKey)await env.FILES.delete(existing.corrected_r2_key);await audit(current,"return_correction","submission",submissionId,{hasCorrectedFile:Boolean(correctedKey)});return json({ok:true});
    }
    if(action==="storage_cleanup"){
      if(current.role!=="owner")return json({error:"Réservé à l’administrateur principal."},403);
      const sizeUpdates:Array<ReturnType<typeof env.DB.prepare>>=[];
      const legacyActivities=await env.DB.prepare(`SELECT DISTINCT r2_key FROM activity_versions WHERE r2_key IS NOT NULL AND file_size=0 LIMIT 200`).all<{r2_key:string}>();
      for(const row of legacyActivities.results){const object=await env.FILES.head(row.r2_key);if(object)sizeUpdates.push(env.DB.prepare(`UPDATE activity_versions SET file_size=? WHERE r2_key=? AND file_size=0`).bind(object.size,row.r2_key));}
      const legacySubmissions=await env.DB.prepare(`SELECT id,r2_key,corrected_r2_key FROM submissions WHERE (r2_key IS NOT NULL AND file_size=0) OR (corrected_r2_key IS NOT NULL AND corrected_file_size=0) LIMIT 200`).all<{id:string;r2_key:string|null;corrected_r2_key:string|null}>();
      for(const row of legacySubmissions.results){if(row.r2_key){const object=await env.FILES.head(row.r2_key);if(object)sizeUpdates.push(env.DB.prepare(`UPDATE submissions SET file_size=? WHERE id=?`).bind(object.size,row.id));}if(row.corrected_r2_key){const object=await env.FILES.head(row.corrected_r2_key);if(object)sizeUpdates.push(env.DB.prepare(`UPDATE submissions SET corrected_file_size=? WHERE id=?`).bind(object.size,row.id));}}
      if(sizeUpdates.length)await env.DB.batch(sizeUpdates);
      const referenced=await env.DB.prepare(`SELECT r2_key key FROM activities WHERE r2_key IS NOT NULL UNION SELECT r2_key FROM activity_versions WHERE r2_key IS NOT NULL UNION SELECT r2_key FROM submissions WHERE r2_key IS NOT NULL UNION SELECT corrected_r2_key FROM submissions WHERE corrected_r2_key IS NOT NULL UNION SELECT state_r2_key FROM student_work WHERE state_r2_key IS NOT NULL UNION SELECT final_pdf_r2_key FROM student_work WHERE final_pdf_r2_key IS NOT NULL`).all<{key:string}>(),keep=new Set(referenced.results.map(row=>row.key)),candidates:string[]=[];let cursor:string|undefined;do{const listed=await env.FILES.list({cursor});for(const object of listed.objects)if(!keep.has(object.key)&&Date.now()-object.uploaded.getTime()>24*60*60_000)candidates.push(object.key);cursor=listed.truncated?listed.cursor:undefined;}while(cursor);
      const confirm=get(data,"confirm")===true||String(get(data,"confirm"))==="true";if(confirm&&candidates.length)await env.FILES.delete(candidates);if(confirm){await env.DB.prepare(`DELETE FROM upload_sessions WHERE status='completed' OR (status<>'completed' AND expires_at<?)`).bind(now()).run();await audit(current,action,"storage",null,{deletedFiles:candidates.length,reconciledFiles:sizeUpdates.length});}return json({ok:true,dryRun:!confirm,candidateCount:candidates.length,deletedCount:confirm?candidates.length:0,reconciledCount:sizeUpdates.length});
    }
    return json({error:"Action inconnue."},400);
  } catch (error) {
    if(error instanceof Response)return error.headers.get("content-type")?.includes("application/json")?error:json({error:await error.text()},error.status);
    const message=error instanceof Error&&/UNIQUE/.test(error.message)?"Cet identifiant existe déjà.":"Une erreur est survenue.";
    return json({error:message},500);
  }
}
