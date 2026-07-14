import { env } from "cloudflare:workers";
export const dynamic = "force-dynamic";

type User = { id: string; role: "owner" | "teacher" | "student" };
type FileRow = { r2_key: string | null; original_name: string | null; content_type: string | null };
const hex = (bytes: Uint8Array) => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const cookie = (request: Request) => request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("monfrench_session="))?.slice("monfrench_session=".length);
const staff = (user: User) => user.role === "owner" || user.role === "teacher";

async function activityFile(user: User, recordId: string) {
  if (staff(user)) {
    return env.DB.prepare(`SELECT COALESCE(v.r2_key,a.r2_key) r2_key,COALESCE(v.original_name,a.original_name) original_name,COALESCE(v.content_type,a.content_type) content_type FROM activities a LEFT JOIN activity_versions v ON v.id=CASE WHEN EXISTS(SELECT 1 FROM activity_versions requested WHERE requested.id=? AND requested.activity_id=a.id) THEN ? ELSE a.current_version_id END WHERE (a.id=? OR v.id=?) AND a.trashed_at IS NULL LIMIT 1`).bind(recordId, recordId, recordId, recordId).first<FileRow>();
  }
  return env.DB.prepare(`SELECT COALESCE(v.r2_key,ac.r2_key) r2_key,COALESCE(v.original_name,ac.original_name) original_name,COALESCE(v.content_type,ac.content_type) content_type FROM assignment_students ast JOIN assignments a ON a.id=ast.assignment_id JOIN activities ac ON ac.id=a.activity_id LEFT JOIN activity_versions v ON v.id=a.activity_version_id WHERE ast.student_id=? AND a.status='published' AND a.trashed_at IS NULL AND (ac.id=? OR v.id=?) ORDER BY a.published_at DESC LIMIT 1`).bind(user.id, recordId, recordId).first<FileRow>();
}

async function submissionFile(user: User, recordId: string, corrected: boolean) {
  const key = corrected ? "s.corrected_r2_key" : "s.r2_key";
  const name = corrected ? "COALESCE('correction-'||s.original_name,'correction.pdf')" : "s.original_name";
  const content = corrected ? "COALESCE(s.content_type,'application/pdf')" : "s.content_type";
  if (user.role === "owner") return env.DB.prepare(`SELECT ${key} r2_key,${name} original_name,${content} content_type FROM submissions s WHERE s.id=?`).bind(recordId).first<FileRow>();
  if (user.role === "teacher") return env.DB.prepare(`SELECT ${key} r2_key,${name} original_name,${content} content_type FROM submissions s JOIN teacher_students ts ON ts.student_id=s.student_id WHERE s.id=? AND ts.teacher_id=?`).bind(recordId, user.id).first<FileRow>();
  return env.DB.prepare(`SELECT ${key} r2_key,${name} original_name,${content} content_type FROM submissions s WHERE s.id=? AND s.student_id=?`).bind(recordId, user.id).first<FileRow>();
}

export async function GET(request: Request) {
  const token = cookie(request);
  if (!token) return new Response("Non autorisé", { status: 401 });
  const user = await env.DB.prepare(`SELECT u.id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>? AND u.active=1 AND u.trashed_at IS NULL`).bind(await hash(token), new Date().toISOString()).first<User>();
  if (!user) return new Response("Non autorisé", { status: 401 });
  const url = new URL(request.url), kind = url.searchParams.get("kind"), recordId = url.searchParams.get("id") ?? "";
  let row: FileRow | null = null;
  if (kind === "activity") row = await activityFile(user, recordId);
  else if (kind === "submission") row = await submissionFile(user, recordId, false);
  else if (kind === "correction") row = await submissionFile(user, recordId, true);
  if (!row?.r2_key) return new Response("Fichier introuvable", { status: 404 });
  const object = await env.FILES.get(row.r2_key);
  if (!object) return new Response("Fichier introuvable", { status: 404 });
  const contentType = row.content_type || object.httpMetadata?.contentType || "application/octet-stream";
  const html = /text\/html|application\/xhtml\+xml/i.test(contentType) || /\.html?$/i.test(row.original_name ?? "");
  const disposition = html || url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(object.body, { headers: {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(row.original_name || "fichier")}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
  } });
}
