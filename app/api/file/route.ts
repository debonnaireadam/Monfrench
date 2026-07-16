import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type User = { id: string; role: "principal" | "teacher" | "student" };
type FileRow = { r2_key: string; original_name: string; content_type: string; file_type: "html" | "zip" };
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
const sessionToken = (request: Request) => request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith("monfrench_session="))?.slice("monfrench_session=".length);

async function currentUser(request: Request) {
  const token = sessionToken(request);
  if (!token) return null;
  return env.DB.prepare(`SELECT u.id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND u.active=1 LIMIT 1`).bind(await hash(token), new Date().toISOString()).first<User>();
}

async function authorizedActivity(user: User, recordId: string) {
  if (user.role === "principal") {
    return env.DB.prepare(`SELECT v.r2_key,v.original_name,v.content_type,v.file_type FROM activity_versions v JOIN activities a ON a.id=v.activity_id WHERE (v.id=? OR (a.id=? AND v.id=a.current_version_id)) LIMIT 1`).bind(recordId, recordId).first<FileRow>();
  }
  if (user.role === "teacher") {
    return env.DB.prepare(`SELECT DISTINCT v.r2_key,v.original_name,v.content_type,v.file_type FROM activity_versions v JOIN activities a ON a.id=v.activity_id WHERE (v.id=? OR (a.id=? AND v.id=a.current_version_id)) AND (a.publication_status='published' OR a.author_id=? OR EXISTS(SELECT 1 FROM assignments teacher_assignment WHERE teacher_assignment.activity_version_id=v.id AND teacher_assignment.assigned_by=? AND teacher_assignment.status='active')) LIMIT 1`).bind(recordId, recordId, user.id, user.id).first<FileRow>();
  }
  return env.DB.prepare(`SELECT DISTINCT v.r2_key,v.original_name,v.content_type,v.file_type FROM assignments a JOIN activity_versions v ON v.id=a.activity_version_id JOIN activities activity ON activity.id=a.activity_id WHERE a.status='active' AND activity.publication_status='published' AND (v.id=? OR activity.id=?) AND (EXISTS(SELECT 1 FROM assignment_recipients direct_recipient WHERE direct_recipient.assignment_id=a.id AND direct_recipient.recipient_type='student' AND direct_recipient.student_id=?) OR EXISTS(SELECT 1 FROM assignment_recipients group_recipient JOIN group_memberships gm ON gm.group_id=group_recipient.group_id WHERE group_recipient.assignment_id=a.id AND group_recipient.recipient_type='group' AND gm.student_id=?)) LIMIT 1`).bind(recordId, recordId, user.id, user.id).first<FileRow>();
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return new Response("Non autorisé", { status: 401, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url), kind = url.searchParams.get("kind"), recordId = url.searchParams.get("id") ?? "";
  if (kind !== "activity" || !recordId) return new Response("Fichier introuvable", { status: 404 });
  const row = await authorizedActivity(user, recordId);
  if (!row?.r2_key) return new Response("Fichier introuvable", { status: 404 });
  const object = await env.FILES.get(row.r2_key);
  if (!object) return new Response("Fichier introuvable", { status: 404 });
  const html = row.file_type === "html" && (/text\/html/i.test(row.content_type) || /\.html?$/i.test(row.original_name));
  const download = url.searchParams.get("download") === "1" || !html;
  return new Response(object.body, { headers: {
    "Content-Type": html ? "text/html; charset=utf-8" : row.content_type || "application/octet-stream",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": html
      ? "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-downloads"
      : "default-src 'none'; sandbox",
  } });
}
