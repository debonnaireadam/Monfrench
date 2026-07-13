import { env } from "cloudflare:workers";
import glassbookHtml from "../../../private-apps/glassbook2_teacher.html?raw";

export const dynamic = "force-dynamic";

const hex = (bytes: Uint8Array) => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const sessionToken = (request: Request) => request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("monfrench_session="))?.slice("monfrench_session=".length);

export async function GET(request: Request) {
  const token = sessionToken(request);
  if (!token) return new Response("Non autorisé", { status: 401 });
  const user = await env.DB.prepare(`SELECT u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>? AND u.active=1`).bind(await hash(token), new Date().toISOString()).first<{ role: string }>();
  if (!user) return new Response("Non autorisé", { status: 401 });
  if (user.role !== "teacher") return new Response("Réservé à l’enseignant", { status: 403 });
  return new Response(glassbookHtml, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Disposition": "inline; filename=glassbook2_teacher.html",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; child-src blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-popups allow-downloads allow-forms allow-modals",
  } });
}
