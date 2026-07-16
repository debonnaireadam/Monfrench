import { env as cloudflareEnv } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type Role = "principal" | "teacher" | "student";
type Env = { DB: D1Database; FILES: R2Bucket; TEACHER_SETUP_CODE?: string; PASSWORD_PEPPER?: string };
type User = { id: string; identifier: string; display_name: string; role: Role; active: number; must_change_password: number };
type SessionUser = User & { id_hash: string; csrf_token_hash: string };
type Input = Record<string, unknown> | FormData;
const env = cloudflareEnv as unknown as Env;
const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
const bytes = (length = 32) => { const value = new Uint8Array(length); crypto.getRandomValues(value); return value; };
const hex = (value: Uint8Array) => [...value].map(byte => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async (value: string | ArrayBuffer) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value)));
const randomToken = () => hex(bytes(32));
const clean = (value: unknown, max = 160) => String(value ?? "").normalize("NFKC").trim().slice(0, max);
const identifier = (value: unknown) => clean(value, 80).toLocaleLowerCase("fr-CA");
const truthy = (value: unknown) => value === true || value === 1 || value === "1" || value === "true" || value === "yes" || value === "oui";
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => { const responseHeaders = new Headers(headers); responseHeaders.set("Cache-Control", "private, no-store"); return Response.json(body, { status, headers: responseHeaders }); };
const value = (input: Input, key: string) => input instanceof FormData ? input.get(key) : input[key];
const array = (input: Input, key: string) => input instanceof FormData ? input.getAll(key).map(String) : Array.isArray(input[key]) ? (input[key] as unknown[]).map(String) : input[key] ? [String(input[key])] : [];
const cookieMap = (request: Request) => new Map((request.headers.get("cookie") ?? "").split(";").map(part => part.trim()).filter(Boolean).map(part => { const index = part.indexOf("="); return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]; }));
const sessionCookie = (name: string, token: string, request: Request, maxAge: number, httpOnly: boolean) => `${name}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Strict${httpOnly ? "; HttpOnly" : ""}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;

async function passwordHash(password: string, salt = hex(bytes(16))) {
  const pepper = env.PASSWORD_PEPPER;
  if (!pepper) throw new Error("PASSWORD_PEPPER is unavailable");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password + pepper), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 210_000 }, material, 256);
  return { salt, hash: hex(new Uint8Array(derived)) };
}
async function verifyPassword(password: string, salt: string, expected: string) {
  const actual = (await passwordHash(password, salt)).hash;
  if (actual.length !== expected.length) return false;
  let difference = 0; for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
function validatePassword(password: string, role: Role) {
  if (!password.length) throw new Response("Mot de passe requis.", { status: 400 });
  if (role !== "student" && password.length < 10) throw new Response("Le mot de passe enseignant doit contenir au moins 10 caractères.", { status: 400 });
  if (password.length > 256) throw new Response("Mot de passe trop long.", { status: 400 });
}
async function audit(actorId: string | null, action: string, entityType: string, entityId: string | null, metadata: unknown = {}) {
  await env.DB.prepare(`INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)`).bind(id("audit"), actorId, action, entityType, entityId, JSON.stringify(metadata), now()).run();
}

async function sessionUser(request: Request) {
  const token = cookieMap(request).get("monfrench_session");
  if (!token) return null;
  return env.DB.prepare(`SELECT u.id,u.identifier,u.display_name,u.role,u.active,u.must_change_password,s.id_hash,s.csrf_token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND u.active=1 LIMIT 1`).bind(await sha256(token), now()).first<SessionUser>();
}
async function requireUser(request: Request) {
  const user = await sessionUser(request);
  if (!user) throw new Response("Non autorisé", { status: 401 });
  return user;
}
async function requireCsrf(request: Request, user: SessionUser) {
  const raw = cookieMap(request).get("monfrench_csrf") ?? "", header = request.headers.get("x-csrf-token") ?? "";
  if (!raw || !header || raw !== header || await sha256(raw) !== user.csrf_token_hash) throw new Response("Jeton de sécurité invalide.", { status: 403 });
}
async function permission(userId: string, kind: string) {
  const row = await env.DB.prepare(`SELECT granted FROM permissions WHERE user_id=? AND kind=?`).bind(userId, kind).first<{ granted: number }>();
  return row?.granted === 1;
}
async function linkedStudent(teacherId: string, studentId: string) {
  return Boolean(await env.DB.prepare(`SELECT 1 ok FROM teacher_student_links WHERE teacher_id=? AND student_id=? UNION SELECT 1 FROM groups g JOIN group_memberships gm ON gm.group_id=g.id WHERE g.teacher_id=? AND gm.student_id=? LIMIT 1`).bind(teacherId, studentId, teacherId, studentId).first());
}
async function assignmentAccess(assignmentId: string, studentId: string) {
  return env.DB.prepare(`SELECT a.id,a.activity_id,a.activity_version_id FROM assignments a WHERE a.id=? AND a.status='active' AND (EXISTS(SELECT 1 FROM assignment_recipients ar WHERE ar.assignment_id=a.id AND ar.recipient_type='student' AND ar.student_id=?) OR EXISTS(SELECT 1 FROM assignment_recipients ar JOIN group_memberships gm ON gm.group_id=ar.group_id WHERE ar.assignment_id=a.id AND ar.recipient_type='group' AND gm.student_id=?)) LIMIT 1`).bind(assignmentId, studentId, studentId).first<{ id: string; activity_id: string; activity_version_id: string }>();
}

async function parseInput(request: Request): Promise<Input> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 12 * 1024 * 1024) throw new Response("Requête trop volumineuse.", { status: 413 });
  return request.headers.get("content-type")?.includes("multipart/form-data") ? request.formData() : request.json();
}
async function rateLimit(request: Request, scope: "login" | "upload", maximum: number, windowSeconds: number) {
  const ip = request.headers.get("cf-connecting-ip") ?? "local", key = await sha256(`${scope}:${ip}`), current = Date.now();
  const row = await env.DB.prepare(`SELECT count,window_started_at FROM rate_limits WHERE bucket_key=? AND scope=?`).bind(key, scope).first<{ count: number; window_started_at: string }>();
  const started = row ? new Date(row.window_started_at).getTime() : 0;
  if (!row || current - started >= windowSeconds * 1000) await env.DB.prepare(`INSERT INTO rate_limits(bucket_key,scope,count,window_started_at,expires_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(bucket_key,scope) DO UPDATE SET count=1,window_started_at=excluded.window_started_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(key, scope, 1, now(), new Date(current + windowSeconds * 1000).toISOString(), now()).run();
  else { if (row.count >= maximum) throw new Response("Trop de tentatives. Réessayez plus tard.", { status: 429 }); await env.DB.prepare(`UPDATE rate_limits SET count=count+1,updated_at=? WHERE bucket_key=? AND scope=?`).bind(now(), key, scope).run(); }
}

async function preferences(userId: string) {
  return await env.DB.prepare(`SELECT theme,text_size,interface_scale,density,reduced_transparency,reduced_motion,solid_contrast,large_touch_targets,reading_width FROM user_preferences WHERE user_id=?`).bind(userId).first() ?? { theme: "chateau", text_size: "m", interface_scale: 100, density: "comfortable", reduced_transparency: 0, reduced_motion: 0, solid_contrast: 0, large_touch_targets: 0, reading_width: "standard" };
}
async function portalData(user: SessionUser, csrfToken: string) {
  const principal = user.role === "principal", teacher = user.role === "teacher";
  const permissionRows = principal ? [{ kind: "upload_library", granted: 1 }, { kind: "direct_publish", granted: 1 }, { kind: "reset_student_password", granted: 1 }] : teacher ? (await env.DB.prepare(`SELECT kind,granted FROM permissions WHERE user_id=?`).bind(user.id).all<{ kind: string; granted: number }>()).results : [];
  const permissionMap = Object.fromEntries(permissionRows.map(row => [row.kind === "upload_library" ? "upload" : row.kind, row.granted === 1]));
  let users: unknown[] = [], groups: unknown[] = [], activities: unknown[] = [], assignments: unknown[] = [], savedWork: unknown[] = [], submissions: unknown[] = [], publicationReviews: unknown[] = [];
  if (principal) {
    users = (await env.DB.prepare(`SELECT u.id,u.identifier,u.display_name,u.role,u.active,u.must_change_password,MAX(CASE WHEN p.kind='upload_library' THEN p.granted ELSE 0 END) upload_library,MAX(CASE WHEN p.kind='direct_publish' THEN p.granted ELSE 0 END) direct_publish FROM users u LEFT JOIN permissions p ON p.user_id=u.id GROUP BY u.id ORDER BY u.role,u.display_name`).all()).results;
    groups = (await env.DB.prepare(`SELECT g.*,u.display_name teacher_name FROM groups g JOIN users u ON u.id=g.teacher_id WHERE g.archived_at IS NULL ORDER BY g.name`).all()).results;
    activities = (await env.DB.prepare(`SELECT a.*,c.name category_name,v.id version_id,v.original_name,v.r2_key,1 file_available FROM activities a JOIN units un ON un.id=a.unit_id JOIN collections col ON col.id=un.collection_id JOIN categories c ON c.id=col.category_id LEFT JOIN activity_versions v ON v.id=a.current_version_id WHERE a.archived_at IS NULL ORDER BY c.sort_order,a.title`).all()).results;
    assignments = (await env.DB.prepare(`SELECT a.* FROM assignments a WHERE a.archived_at IS NULL ORDER BY a.created_at DESC`).all()).results;
    submissions = (await env.DB.prepare(`SELECT s.*,s.state_json submitted_state_json,u.display_name student_name,a.activity_id,activity.title activity_title,c.name category_name FROM submissions s JOIN users u ON u.id=s.student_id JOIN assignments a ON a.id=s.assignment_id JOIN activities activity ON activity.id=a.activity_id JOIN units un ON un.id=activity.unit_id JOIN collections col ON col.id=un.collection_id JOIN categories c ON c.id=col.category_id WHERE s.status='submitted' ORDER BY s.submitted_at`).all()).results;
    publicationReviews = (await env.DB.prepare(`SELECT pr.*,a.title activity_title,u.display_name requested_by_name FROM publication_reviews pr JOIN activities a ON a.id=pr.activity_id JOIN users u ON u.id=pr.requested_by WHERE pr.state='pending' ORDER BY pr.created_at`).all()).results;
  } else if (teacher) {
    users = (await env.DB.prepare(`SELECT DISTINCT u.id,u.identifier,u.display_name,u.role,u.active,u.must_change_password FROM users u WHERE u.id=? OR EXISTS(SELECT 1 FROM teacher_student_links l WHERE l.teacher_id=? AND l.student_id=u.id) OR EXISTS(SELECT 1 FROM groups g JOIN group_memberships gm ON gm.group_id=g.id WHERE g.teacher_id=? AND gm.student_id=u.id) ORDER BY u.role,u.display_name`).bind(user.id, user.id, user.id).all()).results;
    groups = (await env.DB.prepare(`SELECT * FROM groups WHERE teacher_id=? AND archived_at IS NULL ORDER BY name`).bind(user.id).all()).results;
    activities = (await env.DB.prepare(`SELECT a.*,c.name category_name,v.id version_id,v.original_name,v.r2_key,1 file_available FROM activities a JOIN units un ON un.id=a.unit_id JOIN collections col ON col.id=un.collection_id JOIN categories c ON c.id=col.category_id LEFT JOIN activity_versions v ON v.id=a.current_version_id WHERE a.archived_at IS NULL AND (a.publication_status='published' OR a.author_id=?) ORDER BY c.sort_order,a.title`).bind(user.id).all()).results;
    assignments = (await env.DB.prepare(`SELECT * FROM assignments WHERE assigned_by=? AND archived_at IS NULL ORDER BY created_at DESC`).bind(user.id).all()).results;
    submissions = (await env.DB.prepare(`SELECT s.*,s.state_json submitted_state_json,u.display_name student_name,a.activity_id,activity.title activity_title,c.name category_name FROM submissions s JOIN users u ON u.id=s.student_id JOIN assignments a ON a.id=s.assignment_id JOIN activities activity ON activity.id=a.activity_id JOIN units un ON un.id=activity.unit_id JOIN collections col ON col.id=un.collection_id JOIN categories c ON c.id=col.category_id WHERE s.status='submitted' AND (a.assigned_by=? OR EXISTS(SELECT 1 FROM teacher_student_links l WHERE l.teacher_id=? AND l.student_id=s.student_id)) ORDER BY s.submitted_at`).bind(user.id, user.id).all()).results;
  } else {
    activities = (await env.DB.prepare(`SELECT DISTINCT activity.*,c.name category_name,v.id version_id,v.original_name,v.r2_key,1 file_available FROM assignments a JOIN activities activity ON activity.id=a.activity_id JOIN activity_versions v ON v.id=a.activity_version_id JOIN units un ON un.id=activity.unit_id JOIN collections col ON col.id=un.collection_id JOIN categories c ON c.id=col.category_id WHERE a.status='active' AND activity.publication_status='published' AND (EXISTS(SELECT 1 FROM assignment_recipients ar WHERE ar.assignment_id=a.id AND ar.recipient_type='student' AND ar.student_id=?) OR EXISTS(SELECT 1 FROM assignment_recipients ar JOIN group_memberships gm ON gm.group_id=ar.group_id WHERE ar.assignment_id=a.id AND ar.recipient_type='group' AND gm.student_id=?)) ORDER BY a.created_at DESC`).bind(user.id, user.id).all()).results;
    assignments = (await env.DB.prepare(`SELECT DISTINCT a.*,COALESCE((SELECT s.status FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=? ORDER BY s.attempt_number DESC LIMIT 1),(SELECT CASE WHEN sw.autosaved_at IS NULL THEN 'assigned' ELSE 'draft' END FROM saved_work sw WHERE sw.assignment_id=a.id AND sw.student_id=?),'assigned') work_status,COALESCE((SELECT sw.progress FROM saved_work sw WHERE sw.assignment_id=a.id AND sw.student_id=?),0) progress,(SELECT s.id FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=? ORDER BY s.attempt_number DESC LIMIT 1) submission_id FROM assignments a WHERE a.status='active' AND (EXISTS(SELECT 1 FROM assignment_recipients ar WHERE ar.assignment_id=a.id AND ar.recipient_type='student' AND ar.student_id=?) OR EXISTS(SELECT 1 FROM assignment_recipients ar JOIN group_memberships gm ON gm.group_id=ar.group_id WHERE ar.assignment_id=a.id AND ar.recipient_type='group' AND gm.student_id=?)) ORDER BY a.created_at DESC`).bind(user.id, user.id, user.id, user.id, user.id, user.id).all()).results;
    savedWork = (await env.DB.prepare(`SELECT sw.id,sw.assignment_id,sw.student_id,sw.activity_version_id,sw.state_json,sw.annotations_json,sw.progress,sw.status,sw.revision,sw.autosaved_at,sw.updated_at FROM saved_work sw JOIN assignments a ON a.id=sw.assignment_id WHERE sw.student_id=? AND a.status='active' AND (EXISTS(SELECT 1 FROM assignment_recipients ar WHERE ar.assignment_id=a.id AND ar.recipient_type='student' AND ar.student_id=?) OR EXISTS(SELECT 1 FROM assignment_recipients ar JOIN group_memberships gm ON gm.group_id=ar.group_id WHERE ar.assignment_id=a.id AND ar.recipient_type='group' AND gm.student_id=?)) ORDER BY sw.updated_at DESC`).bind(user.id, user.id, user.id).all()).results;
    submissions = (await env.DB.prepare(`SELECT s.*,r.note feedback,r.status review_status FROM submissions s LEFT JOIN reviews r ON r.submission_id=s.id WHERE s.student_id=? ORDER BY s.submitted_at DESC`).bind(user.id).all()).results;
  }
  const [categories, collections, units] = await Promise.all([
    env.DB.prepare(`SELECT * FROM categories WHERE active=1 AND archived_at IS NULL ORDER BY sort_order,name`).all(),
    env.DB.prepare(`SELECT * FROM collections WHERE active=1 AND archived_at IS NULL ORDER BY sort_order,name`).all(),
    env.DB.prepare(`SELECT * FROM units WHERE active=1 AND archived_at IS NULL ORDER BY sort_order,name`).all(),
  ]);
  return { authenticated: true, csrfToken, user: { id: user.id, identifier: user.identifier, display_name: user.display_name, role: user.role, active: user.active, must_change_password: user.must_change_password }, permissions: permissionMap, preferences: await preferences(user.id), categories: categories.results, collections: collections.results, units: units.results, activities, assignments, recipients: [], savedWork, submissions, reviews: [], users, groups, publicationReviews };
}

export async function GET(request: Request) {
  try {
    const count = await env.DB.prepare(`SELECT COUNT(*) count FROM users`).first<{ count: number }>();
    const user = await sessionUser(request);
    if (!user) return json({ authenticated: false, setupRequired: !count?.count });
    const csrfToken = cookieMap(request).get("monfrench_csrf") ?? "";
    return json(await portalData(user, csrfToken));
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return json({ authenticated: false, setupRequired: true, databaseMigrationRequired: true });
    return json({ error: "Impossible de charger MonFrench." }, 500);
  }
}

async function createSession(user: User, request: Request) {
  const session = randomToken(), csrf = randomToken(), expires = 14 * 24 * 60 * 60;
  await env.DB.prepare(`INSERT INTO sessions(id_hash,user_id,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)`).bind(await sha256(session), user.id, await sha256(csrf), now(), now(), new Date(Date.now() + expires * 1000).toISOString()).run();
  const headers = new Headers(); headers.append("Set-Cookie", sessionCookie("monfrench_session", session, request, expires, true)); headers.append("Set-Cookie", sessionCookie("monfrench_csrf", csrf, request, expires, false)); return json({ ok: true }, 200, headers);
}
async function ensureDefaultLibrary(actorId: string) {
  let category = await env.DB.prepare(`SELECT id FROM categories WHERE active=1 ORDER BY sort_order LIMIT 1`).first<{ id: string }>();
  if (!category) { category = { id: id("cat") }; await env.DB.prepare(`INSERT INTO categories(id,name,description,sort_order,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(category.id, "Français", "", 0, 1, actorId, now(), now()).run(); }
  let collection = await env.DB.prepare(`SELECT id FROM collections WHERE category_id=? AND active=1 ORDER BY sort_order LIMIT 1`).bind(category.id).first<{ id: string }>();
  if (!collection) { collection = { id: id("col") }; await env.DB.prepare(`INSERT INTO collections(id,category_id,name,description,sort_order,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(collection.id, category.id, "Activités", "", 0, 1, actorId, now(), now()).run(); }
  let unit = await env.DB.prepare(`SELECT id FROM units WHERE collection_id=? AND active=1 ORDER BY sort_order LIMIT 1`).bind(collection.id).first<{ id: string }>();
  if (!unit) { unit = { id: id("unit") }; await env.DB.prepare(`INSERT INTO units(id,collection_id,name,description,sort_order,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(unit.id, collection.id, "Général", "", 0, 1, actorId, now(), now()).run(); }
  return { categoryId: category.id, collectionId: collection.id, unitId: unit.id };
}

export async function POST(request: Request) {
  try {
    const input = await parseInput(request), action = clean(value(input, "action"), 64);
    if (action === "setup") {
      const count = await env.DB.prepare(`SELECT COUNT(*) count FROM users`).first<{ count: number }>();
      if (count?.count) return json({ error: "MonFrench est déjà configuré." }, 409);
      if (!env.TEACHER_SETUP_CODE || clean(value(input, "setup_code"), 256) !== env.TEACHER_SETUP_CODE) return json({ error: "Code de configuration invalide." }, 403);
      const principalId = id("usr"), name = clean(value(input, "display_name"), 120), login = identifier(value(input, "identifier")), password = String(value(input, "password") ?? "");
      if (!name || !/^[\p{L}\p{N}._@-]{3,80}$/u.test(login)) return json({ error: "Nom ou identifiant invalide." }, 400); validatePassword(password, "principal"); const hashed = await passwordHash(password);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users(id,identifier,display_name,role,password_hash,password_salt,active,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(principalId, login, name, "principal", hashed.hash, hashed.salt, 1, 0, now(), now()),
        env.DB.prepare(`INSERT INTO teacher_profiles(user_id,created_at,updated_at) VALUES(?,?,?)`).bind(principalId, now(), now()),
        env.DB.prepare(`INSERT INTO user_preferences(user_id,created_at,updated_at) VALUES(?,?,?)`).bind(principalId, now(), now()),
      ]);
      await ensureDefaultLibrary(principalId); await audit(principalId, "setup", "user", principalId); return createSession({ id: principalId, identifier: login, display_name: name, role: "principal", active: 1, must_change_password: 0 }, request);
    }
    if (action === "login") {
      await rateLimit(request, "login", 10, 15 * 60); const login = identifier(value(input, "identifier")), password = String(value(input, "password") ?? "");
      const row = await env.DB.prepare(`SELECT id,identifier,display_name,role,active,must_change_password,password_hash,password_salt FROM users WHERE identifier=? AND active=1 LIMIT 1`).bind(login).first<User & { password_hash: string; password_salt: string }>();
      if (!row || !await verifyPassword(password, row.password_salt, row.password_hash)) return json({ error: "Identifiant ou mot de passe incorrect." }, 401);
      await env.DB.prepare(`UPDATE users SET last_login_at=?,updated_at=? WHERE id=?`).bind(now(), now(), row.id).run(); await audit(row.id, "login", "session", null); return createSession(row, request);
    }
    const user = await requireUser(request); await requireCsrf(request, user);
    if (action === "logout") { await env.DB.prepare(`UPDATE sessions SET revoked_at=? WHERE id_hash=?`).bind(now(), user.id_hash).run(); const headers = new Headers(); headers.append("Set-Cookie", sessionCookie("monfrench_session", "", request, 0, true)); headers.append("Set-Cookie", sessionCookie("monfrench_csrf", "", request, 0, false)); return json({ ok: true }, 200, headers); }
    if (action === "change_password") { const password = String(value(input, "password") ?? ""); validatePassword(password, user.role); const hashed = await passwordHash(password); await env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,must_change_password=0,password_changed_at=?,updated_at=? WHERE id=?`).bind(hashed.hash, hashed.salt, now(), now(), user.id).run(); await audit(user.id, action, "user", user.id); return json({ ok: true }); }
    if (action === "save_preferences") {
      const current = await preferences(user.id), theme = ["chateau", "nuit"].includes(String(value(input, "theme"))) ? String(value(input, "theme")) : current.theme, textSize = ["s", "m", "l"].includes(String(value(input, "text_size"))) ? String(value(input, "text_size")) : current.text_size;
      const reducedMotion = value(input, "reduced_motion") == null ? current.reduced_motion : truthy(value(input, "reduced_motion")), solidContrast = value(input, "solid_contrast") == null ? current.solid_contrast : truthy(value(input, "solid_contrast"));
      await env.DB.prepare(`INSERT INTO user_preferences(user_id,theme,text_size,reduced_motion,solid_contrast,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,text_size=excluded.text_size,reduced_motion=excluded.reduced_motion,solid_contrast=excluded.solid_contrast,updated_at=excluded.updated_at`).bind(user.id, theme, textSize, reducedMotion ? 1 : 0, solidContrast ? 1 : 0, now(), now()).run(); return json({ ok: true });
    }
    if (action === "create_user") {
      if (user.role !== "principal") return json({ error: "Réservé à l’enseignant principal." }, 403);
      const role = clean(value(input, "role")) as Role; if (!(["teacher", "student"] as Role[]).includes(role)) return json({ error: "Type de compte invalide." }, 400);
      const login = identifier(value(input, "identifier")), name = clean(value(input, "display_name"), 120); if (!/^[\p{L}\p{N}._@-]{3,80}$/u.test(login) || !name) return json({ error: "Nom ou identifiant invalide." }, 400);
      const supplied = String(value(input, "password") ?? ""), temporaryPassword = supplied || (role === "student" ? randomToken().slice(0, 6) : `${randomToken().slice(0, 12)}!Aa`); validatePassword(temporaryPassword, role); const hashed = await passwordHash(temporaryPassword), userId = id("usr");
      const statements = [env.DB.prepare(`INSERT INTO users(id,identifier,display_name,role,password_hash,password_salt,active,must_change_password,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(userId, login, name, role, hashed.hash, hashed.salt, 1, supplied ? 0 : 1, user.id, now(), now()), env.DB.prepare(`INSERT INTO user_preferences(user_id,created_at,updated_at) VALUES(?,?,?)`).bind(userId, now(), now())];
      if (role === "teacher") statements.push(env.DB.prepare(`INSERT INTO teacher_profiles(user_id,created_at,updated_at) VALUES(?,?,?)`).bind(userId, now(), now()));
      else { statements.push(env.DB.prepare(`INSERT INTO student_profiles(user_id,temporary_password,created_at,updated_at) VALUES(?,?,?,?)`).bind(userId, supplied ? 0 : 1, now(), now())); const teacherId = clean(value(input, "teacher_id")); if (teacherId) statements.push(env.DB.prepare(`INSERT INTO teacher_student_links(teacher_id,student_id,created_by,created_at) VALUES(?,?,?,?)`).bind(teacherId, userId, user.id, now())); const groupId = clean(value(input, "group_id")); if (groupId) statements.push(env.DB.prepare(`INSERT INTO group_memberships(group_id,student_id,added_by,added_at) VALUES(?,?,?,?)`).bind(groupId, userId, user.id, now())); }
      await env.DB.batch(statements); await audit(user.id, action, "user", userId, { role }); return json({ ok: true, user_id: userId, ...(supplied ? {} : { temporary_password: temporaryPassword }) });
    }
    if (action === "reset_password") {
      const targetId = clean(value(input, "user_id")), target = await env.DB.prepare(`SELECT role FROM users WHERE id=?`).bind(targetId).first<{ role: Role }>(); if (!target) return json({ error: "Compte introuvable." }, 404);
      const allowed = user.role === "principal" || (user.role === "teacher" && target.role === "student" && await permission(user.id, "reset_student_password") && await linkedStudent(user.id, targetId)); if (!allowed) return json({ error: "Permission refusée." }, 403);
      const temporaryPassword = target.role === "student" ? randomToken().slice(0, 6) : `${randomToken().slice(0, 12)}!Aa`, hashed = await passwordHash(temporaryPassword); await env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,must_change_password=1,password_changed_at=?,updated_at=? WHERE id=?`).bind(hashed.hash, hashed.salt, now(), now(), targetId).run(); await audit(user.id, action, "user", targetId); return json({ ok: true, temporary_password: temporaryPassword });
    }
    if (action === "set_permission") {
      if (user.role !== "principal") return json({ error: "Réservé à l’enseignant principal." }, 403); const targetId = clean(value(input, "user_id")), kind = clean(value(input, "kind"), 40); if (!["upload_library", "direct_publish", "reset_student_password"].includes(kind)) return json({ error: "Permission invalide." }, 400);
      await env.DB.prepare(`INSERT INTO permissions(user_id,kind,granted,granted_by,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET granted=excluded.granted,granted_by=excluded.granted_by,updated_at=excluded.updated_at`).bind(targetId, kind, truthy(value(input, "granted")) ? 1 : 0, user.id, now(), now()).run(); await audit(user.id, action, "permission", `${targetId}:${kind}`); return json({ ok: true });
    }
    if (action === "create_group") {
      if (user.role === "student") return json({ error: "Permission refusée." }, 403); const teacherId = user.role === "principal" ? clean(value(input, "teacher_id")) || user.id : user.id, groupId = id("grp"), name = clean(value(input, "name"), 120); if (!name) return json({ error: "Nom requis." }, 400); await env.DB.prepare(`INSERT INTO groups(id,name,teacher_id,created_by,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(groupId, name, teacherId, user.id, 1, now(), now()).run(); await audit(user.id, action, "group", groupId); return json({ ok: true, group_id: groupId });
    }
    if (["create_category", "create_collection", "create_unit"].includes(action)) {
      if (user.role !== "principal") return json({ error: "Réservé à l’enseignant principal." }, 403); const name = clean(value(input, "name"), 120), description = clean(value(input, "description"), 500); if (!name) return json({ error: "Nom requis." }, 400); let recordId = "";
      if (action === "create_category") { recordId = id("cat"); await env.DB.prepare(`INSERT INTO categories(id,name,description,sort_order,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(recordId, name, description, Number(value(input, "sort_order") ?? 0), 1, user.id, now(), now()).run(); }
      if (action === "create_collection") { recordId = id("col"); await env.DB.prepare(`INSERT INTO collections(id,category_id,name,description,sort_order,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(recordId, clean(value(input, "category_id")), name, description, Number(value(input, "sort_order") ?? 0), 1, user.id, now(), now()).run(); }
      if (action === "create_unit") { recordId = id("unit"); await env.DB.prepare(`INSERT INTO units(id,collection_id,name,description,sort_order,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(recordId, clean(value(input, "collection_id")), name, description, Number(value(input, "sort_order") ?? 0), 1, user.id, now(), now()).run(); }
      await audit(user.id, action, action.slice(7), recordId); return json({ ok: true, id: recordId });
    }
    if (action === "create_activity") {
      if (user.role === "student" || (user.role === "teacher" && !await permission(user.id, "upload_library"))) return json({ error: "Vous n’avez pas la permission d’importer." }, 403); await rateLimit(request, "upload", 20, 60 * 60);
      const file = value(input, "file"); if (!(file instanceof File)) return json({ error: "Fichier HTML requis." }, 400); if (file.size > 10 * 1024 * 1024) return json({ error: "Le fichier dépasse 10 Mo." }, 413); if (!/\.html?$/i.test(file.name) || !["text/html", "application/xhtml+xml", ""].includes(file.type)) return json({ error: "Format non accepté. Utilisez un fichier HTML." }, 415);
      const title = clean(value(input, "title"), 160), description = clean(value(input, "description"), 1000); if (!title) return json({ error: "Titre requis." }, 400); const buffer = await file.arrayBuffer(), checksum = await sha256(buffer), r2Key = `activities/${crypto.randomUUID()}/v1.html`, activityId = id("act"), versionId = id("ver");
      let unitId = clean(value(input, "unit_id")); if (!unitId) { const categoryId = clean(value(input, "category_id")); const found = categoryId ? await env.DB.prepare(`SELECT un.id FROM units un JOIN collections col ON col.id=un.collection_id WHERE col.category_id=? AND un.active=1 ORDER BY un.sort_order LIMIT 1`).bind(categoryId).first<{ id: string }>() : null; unitId = found?.id ?? (await ensureDefaultLibrary(user.id)).unitId; }
      const direct = user.role === "principal" || await permission(user.id, "direct_publish"), publicationStatus = direct ? "published" : "pending_review";
      await env.FILES.put(r2Key, buffer, { httpMetadata: { contentType: "text/html; charset=utf-8" }, customMetadata: { checksum, originalName: file.name } });
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO activities(id,unit_id,title,level,description,current_version_id,publication_status,author_id,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(activityId, unitId, title, clean(value(input, "level"), 30), description, null, publicationStatus, user.id, now(), now(), direct ? now() : null),
        env.DB.prepare(`INSERT INTO activity_versions(id,activity_id,version_number,r2_key,original_name,content_type,file_type,file_size,checksum_sha256,validation_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(versionId, activityId, 1, r2Key, file.name.slice(0, 180), "text/html", "html", file.size, checksum, JSON.stringify({ extension: "html", mime: file.type || "text/html", accepted: true }), user.id, now()),
        env.DB.prepare(`UPDATE activities SET current_version_id=? WHERE id=?`).bind(versionId, activityId),
      ]);
      if (!direct) await env.DB.prepare(`INSERT INTO publication_reviews(id,activity_id,activity_version_id,requested_by,state,note,created_at) VALUES(?,?,?,?,?,?,?)`).bind(id("pubrev"), activityId, versionId, user.id, "pending", "", now()).run(); await audit(user.id, action, "activity", activityId, { publicationStatus, checksum }); return json({ ok: true, activity_id: activityId, version_id: versionId, publication_status: publicationStatus });
    }
    if (action === "review_publication") {
      if (user.role !== "principal") return json({ error: "Réservé à l’enseignant principal." }, 403); const reviewId = clean(value(input, "publication_review_id")), decision = clean(value(input, "decision")); if (!["approved", "rejected"].includes(decision)) return json({ error: "Décision invalide." }, 400); const review = await env.DB.prepare(`SELECT activity_id FROM publication_reviews WHERE id=? AND state='pending'`).bind(reviewId).first<{ activity_id: string }>(); if (!review) return json({ error: "Demande introuvable." }, 404);
      await env.DB.batch([env.DB.prepare(`UPDATE publication_reviews SET state=?,reviewer_id=?,note=?,reviewed_at=? WHERE id=?`).bind(decision, user.id, clean(value(input, "note"), 1000), now(), reviewId), env.DB.prepare(`UPDATE activities SET publication_status=?,published_at=?,updated_at=? WHERE id=?`).bind(decision === "approved" ? "published" : "rejected", decision === "approved" ? now() : null, now(), review.activity_id)]); await audit(user.id, action, "activity", review.activity_id, { decision }); return json({ ok: true });
    }
    if (action === "create_assignment") {
      if (user.role === "student") return json({ error: "Permission refusée." }, 403); const activityId = clean(value(input, "activity_id")), versionId = clean(value(input, "activity_version_id")); const activity = await env.DB.prepare(`SELECT current_version_id,publication_status FROM activities WHERE id=?`).bind(activityId).first<{ current_version_id: string; publication_status: string }>(); if (!activity || activity.publication_status !== "published") return json({ error: "Seule une activité publiée peut être assignée." }, 409); const assignmentId = id("asn"), students = [...new Set(array(input, "student_ids").concat(array(input, "student_id")))], groups = [...new Set(array(input, "group_ids").concat(array(input, "group_id")))]; if (!students.length && !groups.length) return json({ error: "Choisissez au moins un élève ou groupe." }, 400);
      if (user.role === "teacher") { for (const studentId of students) if (!await linkedStudent(user.id, studentId)) return json({ error: "Un élève choisi ne vous est pas associé." }, 403); for (const groupId of groups) if (!await env.DB.prepare(`SELECT 1 FROM groups WHERE id=? AND teacher_id=?`).bind(groupId, user.id).first()) return json({ error: "Un groupe choisi ne vous appartient pas." }, 403); }
      const statements = [env.DB.prepare(`INSERT INTO assignments(id,activity_id,activity_version_id,assigned_by,due_at,instructions,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(assignmentId, activityId, versionId || activity.current_version_id, user.id, clean(value(input, "due_at")) || null, clean(value(input, "instructions"), 1000), "active", now(), now())]; students.forEach(studentId => statements.push(env.DB.prepare(`INSERT INTO assignment_recipients(id,assignment_id,recipient_type,student_id,created_at) VALUES(?,?,?,?,?)`).bind(id("rec"), assignmentId, "student", studentId, now()))); groups.forEach(groupId => statements.push(env.DB.prepare(`INSERT INTO assignment_recipients(id,assignment_id,recipient_type,group_id,created_at) VALUES(?,?,?,?,?)`).bind(id("rec"), assignmentId, "group", groupId, now()))); await env.DB.batch(statements); await audit(user.id, action, "assignment", assignmentId, { students: students.length, groups: groups.length }); return json({ ok: true, assignment_id: assignmentId });
    }
    if (action === "save_work") {
      if (user.role !== "student") return json({ error: "Réservé aux élèves." }, 403); const assignmentId = clean(value(input, "assignment_id")), access = await assignmentAccess(assignmentId, user.id); if (!access) return json({ error: "Activité non assignée." }, 403); const latest = await env.DB.prepare(`SELECT status FROM submissions WHERE assignment_id=? AND student_id=? ORDER BY attempt_number DESC LIMIT 1`).bind(assignmentId, user.id).first<{ status: string }>(); if (latest && latest.status !== "redo") return json({ error: "Ce travail est verrouillé après l’envoi." }, 409); const state = JSON.stringify(value(input, "state") ?? {}), annotations = JSON.stringify(value(input, "annotations") ?? []); if (state.length > 1_000_000 || annotations.length > 1_000_000) return json({ error: "Travail trop volumineux." }, 413); const progress = Math.max(0, Math.min(100, Number(value(input, "progress") ?? 0)));
      await env.DB.prepare(`INSERT INTO saved_work(id,assignment_id,student_id,activity_version_id,state_json,annotations_json,progress,status,revision,autosaved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET state_json=excluded.state_json,annotations_json=excluded.annotations_json,progress=excluded.progress,status='draft',revision=saved_work.revision+1,autosaved_at=excluded.autosaved_at,updated_at=excluded.updated_at`).bind(id("work"), assignmentId, user.id, access.activity_version_id, state, annotations, progress, "draft", 0, now(), now(), now()).run(); return json({ ok: true, autosaved_at: now() });
    }
    if (action === "submit_work") {
      if (user.role !== "student") return json({ error: "Réservé aux élèves." }, 403); const assignmentId = clean(value(input, "assignment_id")), access = await assignmentAccess(assignmentId, user.id); if (!access) return json({ error: "Activité non assignée." }, 403); const latest = await env.DB.prepare(`SELECT attempt_number,status FROM submissions WHERE assignment_id=? AND student_id=? ORDER BY attempt_number DESC LIMIT 1`).bind(assignmentId, user.id).first<{ attempt_number: number; status: string }>(); if (latest && latest.status !== "redo") return json({ error: "Ce travail est déjà envoyé et verrouillé." }, 409); const state = JSON.stringify(value(input, "state") ?? {}), annotations = JSON.stringify(value(input, "annotations") ?? []); if (state.length > 1_000_000) return json({ error: "Travail trop volumineux." }, 413); let work = await env.DB.prepare(`SELECT id FROM saved_work WHERE assignment_id=? AND student_id=?`).bind(assignmentId, user.id).first<{ id: string }>(); if (!work) { work = { id: id("work") }; await env.DB.prepare(`INSERT INTO saved_work(id,assignment_id,student_id,activity_version_id,state_json,annotations_json,progress,status,revision,autosaved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(work.id, assignmentId, user.id, access.activity_version_id, state, annotations, 100, "draft", 0, now(), now(), now()).run(); }
      const submissionId = id("sub"), attempt = (latest?.attempt_number ?? 0) + 1; await env.DB.batch([env.DB.prepare(`UPDATE saved_work SET state_json=?,annotations_json=?,progress=?,status='locked',revision=revision+1,autosaved_at=?,updated_at=? WHERE id=?`).bind(state, annotations, 100, now(), now(), work.id), env.DB.prepare(`INSERT INTO submissions(id,assignment_id,student_id,saved_work_id,activity_version_id,attempt_number,state_json,annotations_json,progress,status,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(submissionId, assignmentId, user.id, work.id, access.activity_version_id, attempt, state, annotations, 100, "submitted", now(), now())]); await audit(user.id, action, "submission", submissionId, { attempt }); return json({ ok: true, submission_id: submissionId });
    }
    if (action === "review_submission") {
      if (user.role === "student") return json({ error: "Permission refusée." }, 403); const submissionId = clean(value(input, "submission_id")), decision = clean(value(input, "decision")); if (!["corrected", "redo"].includes(decision)) return json({ error: "Décision invalide." }, 400); const submission = await env.DB.prepare(`SELECT s.student_id,s.saved_work_id,a.assigned_by FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=? AND s.status='submitted'`).bind(submissionId).first<{ student_id: string; saved_work_id: string; assigned_by: string }>(); if (!submission) return json({ error: "Copie introuvable." }, 404); if (user.role === "teacher" && submission.assigned_by !== user.id && !await linkedStudent(user.id, submission.student_id)) return json({ error: "Permission refusée." }, 403); const note = clean(value(input, "feedback"), 2000), reviewId = id("rev");
      await env.DB.batch([env.DB.prepare(`UPDATE submissions SET status=?,updated_at=? WHERE id=?`).bind(decision, now(), submissionId), env.DB.prepare(`INSERT INTO reviews(id,submission_id,reviewer_id,status,note,annotations_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET reviewer_id=excluded.reviewer_id,status=excluded.status,note=excluded.note,annotations_json=excluded.annotations_json,updated_at=excluded.updated_at`).bind(reviewId, submissionId, user.id, decision, note, JSON.stringify(value(input, "annotations") ?? []), now(), now()), env.DB.prepare(`UPDATE saved_work SET status=?,updated_at=? WHERE id=?`).bind(decision === "redo" ? "draft" : "locked", now(), submission.saved_work_id)]); await audit(user.id, action, "submission", submissionId, { decision }); return json({ ok: true });
    }
    if (["migration_dry_run", "migration_import", "migration_rollback"].includes(action)) return handleMigration(action, input, user);
    return json({ error: "Action inconnue." }, 400);
  } catch (error) {
    if (error instanceof Response) return error.headers.get("content-type")?.includes("application/json") ? error : json({ error: await error.text() }, error.status);
    console.error("portal_error", error);
    const message = error instanceof Error && /UNIQUE constraint failed/i.test(error.message) ? "Cet identifiant ou ce nom existe déjà." : "Une erreur est survenue.";
    return json({ error: message }, 500);
  }
}

type MigrationRowInput = { legacy_id?: unknown; identifier?: unknown; display_name?: unknown; active?: unknown; teacher_identifier?: unknown; group?: unknown; password_hash?: unknown };
function validateMigrationRows(rows: MigrationRowInput[]) {
  const seenIdentifiers = new Set<string>(), seenLegacy = new Set<string>();
  return rows.map((row, index) => { const errors: string[] = [], legacyId = clean(row.legacy_id, 120), login = identifier(row.identifier), displayName = clean(row.display_name, 120); if (!legacyId) errors.push("legacy_id_required"); if (!/^[\p{L}\p{N}._@-]{3,80}$/u.test(login)) errors.push("identifier_invalid"); if (!displayName) errors.push("display_name_required"); if (seenIdentifiers.has(login)) errors.push("identifier_duplicate"); if (seenLegacy.has(legacyId)) errors.push("legacy_id_duplicate"); seenIdentifiers.add(login); seenLegacy.add(legacyId); return { rowNumber: index + 1, legacyId, identifier: login, displayName, active: truthy(row.active), teacherIdentifier: identifier(row.teacher_identifier), group: clean(row.group, 120), errors }; });
}
const migrationGroupKey = (name: string) => clean(name, 120).toLocaleLowerCase("fr-CA");
async function handleMigration(action: string, input: Input, user: SessionUser) {
  if (user.role !== "principal") return json({ error: "Réservé à l’enseignant principal." }, 403);
  if (action === "migration_rollback") {
    const runId = clean(value(input, "run_id")), run = await env.DB.prepare(`SELECT status FROM migration_runs WHERE id=? AND mode='import'`).bind(runId).first<{ status: string }>(); if (!run || run.status === "rolled_back") return json({ error: "Lot d’import introuvable ou déjà annulé." }, 409);
    const imported = await env.DB.prepare(`SELECT user_id FROM migration_rows WHERE run_id=? AND status='imported' AND user_id IS NOT NULL`).bind(runId).all<{ user_id: string }>(); const statements = imported.results.map(row => env.DB.prepare(`DELETE FROM users WHERE id=?`).bind(row.user_id)); statements.push(env.DB.prepare(`UPDATE migration_rows SET status='rolled_back',updated_at=? WHERE run_id=? AND status='imported'`).bind(now(), runId), env.DB.prepare(`UPDATE migration_runs SET status='rolled_back',rolled_back_at=?,rolled_back_by=? WHERE id=?`).bind(now(), user.id, runId)); await env.DB.batch(statements); await audit(user.id, action, "migration_run", runId, { removed: imported.results.length }); return json({ ok: true, removed: imported.results.length });
  }
  const rawRows = value(input, "rows"); if (!Array.isArray(rawRows)) return json({ error: "Le fichier doit contenir une liste de comptes élèves." }, 400); if (rawRows.length > 10_000) return json({ error: "Maximum 10 000 lignes par lot." }, 413);
  const rows = validateMigrationRows(rawRows as MigrationRowInput[]), sourceName = clean(value(input, "source_name"), 180) || "student-accounts.json", checksum = await sha256(JSON.stringify(rawRows)), mode = action === "migration_import" ? "import" : "dry_run";
  if (mode === "import") { const existing = await env.DB.prepare(`SELECT id,summary_json FROM migration_runs WHERE mode='import' AND source_checksum=? AND status IN ('completed','completed_with_errors') ORDER BY created_at DESC LIMIT 1`).bind(checksum).first<{ id: string; summary_json: string }>(); if (existing) return json({ ok: true, idempotent: true, run_id: existing.id, summary: JSON.parse(existing.summary_json) }); }
  const existingUsers = new Set((await env.DB.prepare(`SELECT identifier FROM users`).all<{ identifier: string }>()).results.map(row => row.identifier)); rows.forEach(row => { if (existingUsers.has(row.identifier)) row.errors.push("identifier_collision"); }); const runId = id("mig"), valid = rows.filter(row => !row.errors.length), failed = rows.length - valid.length, summary = { total: rows.length, valid: valid.length, failed, imported: 0 };
  await env.DB.prepare(`INSERT INTO migration_runs(id,mode,status,source_type,source_name,source_checksum,started_by,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(runId, mode, "running", "json", sourceName, checksum, user.id, JSON.stringify(summary), now()).run();
  const rowStatements = rows.map(row => env.DB.prepare(`INSERT INTO migration_rows(id,run_id,row_number,legacy_id,identifier,status,payload_json,error_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id("migrow"), runId, row.rowNumber, row.legacyId, row.identifier, row.errors.length ? "collision" : "valid", JSON.stringify({ display_name: row.displayName, active: row.active, teacher_identifier: row.teacherIdentifier, group: row.group }), JSON.stringify(row.errors), now(), now())); if (rowStatements.length) await env.DB.batch(rowStatements);
  if (mode === "dry_run") { await env.DB.prepare(`UPDATE migration_runs SET status=?,summary_json=?,completed_at=? WHERE id=?`).bind(failed ? "completed_with_errors" : "completed", JSON.stringify(summary), now(), runId).run(); await audit(user.id, action, "migration_run", runId, summary); return json({ ok: true, run_id: runId, summary, rows }); }
  const migrationTeachers = (await env.DB.prepare(`SELECT id,identifier FROM users WHERE role IN ('principal','teacher')`).all<{ id: string; identifier: string }>()).results;
  const migrationGroups = (await env.DB.prepare(`SELECT id,name,teacher_id FROM groups WHERE archived_at IS NULL`).all<{ id: string; name: string; teacher_id: string }>()).results;
  const teachersByIdentifier = new Map(migrationTeachers.map(teacher => [identifier(teacher.identifier), teacher.id]));
  const groupsByName = new Map<string, typeof migrationGroups>();
  for (const group of migrationGroups) {
    const key = migrationGroupKey(group.name), matches = groupsByName.get(key) ?? [];
    matches.push(group); groupsByName.set(key, matches);
  }
  let imported = 0;
  for (const row of valid) {
    const bootstrapSecret = randomToken(), hashed = await passwordHash(bootstrapSecret), newUserId = id("usr");
    const teacherId = row.teacherIdentifier ? teachersByIdentifier.get(row.teacherIdentifier) : undefined;
    const groupMatches = row.group ? groupsByName.get(migrationGroupKey(row.group)) ?? [] : [];
    const group = teacherId ? groupMatches.find(candidate => candidate.teacher_id === teacherId) : groupMatches.length === 1 ? groupMatches[0] : undefined;
    const statements = [
      env.DB.prepare(`INSERT INTO users(id,identifier,display_name,role,password_hash,password_salt,active,must_change_password,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(newUserId, row.identifier, row.displayName, "student", hashed.hash, hashed.salt, row.active ? 1 : 0, 1, user.id, now(), now()),
      env.DB.prepare(`INSERT INTO student_profiles(user_id,legacy_id,temporary_password,created_at,updated_at) VALUES(?,?,?,?,?)`).bind(newUserId, row.legacyId, 1, now(), now()),
      env.DB.prepare(`INSERT INTO user_preferences(user_id,created_at,updated_at) VALUES(?,?,?)`).bind(newUserId, now(), now()),
      env.DB.prepare(`UPDATE migration_rows SET status='imported',user_id=?,payload_json=?,updated_at=? WHERE run_id=? AND row_number=?`).bind(newUserId, JSON.stringify({ display_name: row.displayName, active: row.active, teacher_identifier: row.teacherIdentifier, group: row.group, teacher_linked: Boolean(teacherId), group_linked: Boolean(group) }), now(), runId, row.rowNumber),
    ];
    if (teacherId) statements.push(env.DB.prepare(`INSERT INTO teacher_student_links(teacher_id,student_id,created_by,created_at) VALUES(?,?,?,?)`).bind(teacherId, newUserId, user.id, now()));
    if (group) statements.push(env.DB.prepare(`INSERT INTO group_memberships(group_id,student_id,added_by,added_at) VALUES(?,?,?,?)`).bind(group.id, newUserId, user.id, now()));
    try { await env.DB.batch(statements); imported++; } catch { await env.DB.prepare(`UPDATE migration_rows SET status='failed',error_json=?,updated_at=? WHERE run_id=? AND row_number=?`).bind(JSON.stringify(["import_failed"]), now(), runId, row.rowNumber).run(); }
  }
  summary.imported = imported; summary.failed = rows.length - imported; await env.DB.prepare(`UPDATE migration_runs SET status=?,summary_json=?,completed_at=? WHERE id=?`).bind(summary.failed ? "completed_with_errors" : "completed", JSON.stringify(summary), now(), runId).run(); await audit(user.id, action, "migration_run", runId, summary); return json({ ok: true, run_id: runId, summary });
}
