import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type User = { id: string; username: string; display_name: string; role: "teacher" | "student"; must_change_password: number };
type Session = User & { csrf_token: string };

const json = (value: unknown, status = 200, headers?: HeadersInit) => Response.json(value, { status, headers });
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const bytesToHex = (bytes: Uint8Array) => [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
const randomToken = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (value: string) => bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));

async function passwordHash(password: string, saltHex?: string) {
  const pepper = env.PASSWORD_PEPPER as string | undefined;
  if (!pepper) throw new Error("PASSWORD_PEPPER is unavailable");
  const salt = saltHex ?? bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${salt}:${password}`));
  return { hash: bytesToHex(new Uint8Array(result)), salt };
}

function cookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

async function session(request: Request): Promise<Session | null> {
  const token = cookie(request, "monfrench_session");
  if (!token) return null;
  return (await env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.must_change_password,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>? AND u.active=1`).bind(await sha256(token), now()).first()) as Session | null;
}

async function requireSession(request: Request, role?: "teacher" | "student") {
  const current = await session(request);
  if (!current || (role && current.role !== role)) throw new Response("Non autorisé", { status: 401 });
  if (request.method !== "GET" && request.headers.get("x-csrf-token") !== current.csrf_token) throw new Response("Requête refusée", { status: 403 });
  return current;
}

async function turnstile(request: Request, token: string | null) {
  const secret = env.TURNSTILE_SECRET_KEY as string | undefined;
  if (!secret) return true;
  if (!token) return false;
  const body = new FormData(); body.set("secret", secret); body.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP"); if (ip) body.set("remoteip", ip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body }).then((r) => r.json()) as { success: boolean };
  return result.success;
}

const stagedUploadPrefix = (key: string, uploadId: string) => `${key}.upload-${uploadId}/`;
const stagedPartKey = (prefix: string, partNumber: number) => `${prefix}part-${String(partNumber).padStart(6, "0")}`;

async function deleteStagedUpload(prefix: string) {
  const listed = await env.FILES.list({ prefix });
  if (listed.objects.length) await env.FILES.delete(listed.objects.map((object: { key: string }) => object.key));
}

async function dashboard(current: Session) {
  if (current.role === "teacher") {
    const [students, activities, assignments, submissions] = await Promise.all([
      env.DB.prepare(`SELECT id,username,display_name,active,must_change_password,created_at FROM users WHERE role='student' ORDER BY display_name`).all(),
      env.DB.prepare(`SELECT id,title,category,description,instructions,original_name,external_url,created_at FROM activities ORDER BY created_at DESC`).all(),
      env.DB.prepare(`SELECT a.id,a.due_at,a.instructions,a.published_at,ac.title,ac.category,COUNT(ast.student_id) student_count FROM assignments a JOIN activities ac ON ac.id=a.activity_id LEFT JOIN assignment_students ast ON ast.assignment_id=a.id GROUP BY a.id ORDER BY a.published_at DESC`).all(),
      env.DB.prepare(`SELECT s.id,s.assignment_id,s.student_id,s.writing,s.original_name,s.submitted_at,s.feedback,s.corrected_at,u.display_name student_name,ac.title FROM submissions s JOIN users u ON u.id=s.student_id JOIN assignments a ON a.id=s.assignment_id JOIN activities ac ON ac.id=a.activity_id ORDER BY s.submitted_at DESC`).all(),
    ]);
    return { user: current, students: students.results, activities: activities.results, assignments: assignments.results, submissions: submissions.results };
  }
  const assignments = await env.DB.prepare(`SELECT a.id,ac.id activity_id,a.due_at,COALESCE(NULLIF(a.instructions,''),ac.instructions) instructions,ac.title,ac.category,ac.description,ac.original_name,ac.external_url,ast.status,s.writing,s.feedback,s.corrected_at FROM assignment_students ast JOIN assignments a ON a.id=ast.assignment_id JOIN activities ac ON ac.id=a.activity_id LEFT JOIN submissions s ON s.assignment_id=a.id AND s.student_id=ast.student_id WHERE ast.student_id=? ORDER BY a.published_at DESC`).bind(current.id).all();
  return { user: current, assignments: assignments.results };
}

export async function GET(request: Request) {
  try {
    const current = await session(request);
    const teachers = await env.DB.prepare(`SELECT COUNT(*) count FROM users WHERE role='teacher'`).first<{ count: number }>();
    if (!current) return json({ authenticated: false, setupRequired: !teachers?.count, turnstileSiteKey: (env.TURNSTILE_SITE_KEY as string | undefined) ?? null });
    return json({ authenticated: true, csrfToken: current.csrf_token, ...(await dashboard(current)) }, 200, { "Cache-Control": "no-store" });
  } catch (error) { return error instanceof Response ? error : json({ error: "Impossible de charger le portail." }, 500); }
}

export async function POST(request: Request) {
  try {
    const url=new URL(request.url);
    if(url.searchParams.get("action")==="upload_activity_part"){
      const current=await requireSession(request,"teacher"), key=String(url.searchParams.get("key")??""), uploadId=String(url.searchParams.get("uploadId")??""), partNumber=Number(url.searchParams.get("partNumber")??0), chunk=await request.arrayBuffer();
      if(!key.startsWith(`activities/${current.id}/`)||!uploadId||!Number.isInteger(partNumber)||partNumber<1||!chunk.byteLength)return json({error:"Partie de fichier invalide."},400);
      if(chunk.byteLength>768*1024)return json({error:"Partie de fichier trop volumineuse."},413);
      const prefix=stagedUploadPrefix(key,uploadId), part=await env.FILES.put(stagedPartKey(prefix,partNumber),chunk,{httpMetadata:{contentType:"application/octet-stream"}});
      return json({ok:true,partNumber,etag:part.etag});
    }
    const type = request.headers.get("content-type") ?? "";
    const data = type.includes("multipart/form-data") ? await request.formData() : await request.json() as Record<string, unknown>;
    const get = (key: string) => data instanceof FormData ? data.get(key) : data[key];
    const action = String(get("action") ?? "");

    if (action === "setup") {
      const existing = await env.DB.prepare(`SELECT COUNT(*) count FROM users WHERE role='teacher'`).first<{ count: number }>();
      if (existing?.count) return json({ error: "Le compte enseignant existe déjà." }, 409);
      const setupCode = env.TEACHER_SETUP_CODE as string | undefined;
      if (!setupCode || String(get("setupCode") ?? "") !== setupCode) return json({ error: "Code de configuration incorrect." }, 403);
      if (!(await turnstile(request, String(get("turnstileToken") ?? "") || null))) return json({ error: "Vérification de sécurité échouée." }, 400);
      const username = String(get("username") ?? "").trim().toLowerCase(); const password = String(get("password") ?? ""); const name = String(get("displayName") ?? "").trim();
      if (!/^[a-z0-9._@+-]{3,80}$/.test(username) || password.length < 12 || !name) return json({ error: "Utilisez un identifiant valide et un mot de passe d’au moins 12 caractères." }, 400);
      const hashed = await passwordHash(password);
      await env.DB.prepare(`INSERT INTO users(id,username,display_name,role,password_hash,password_salt,active,must_change_password,created_at) VALUES(?,?,?,?,?,?,1,0,?)`).bind(id(), username, name, "teacher", hashed.hash, hashed.salt, now()).run();
      return json({ ok: true });
    }

    if (action === "login") {
      const username = String(get("username") ?? "").trim().toLowerCase(); const password = String(get("password") ?? "");
      if (!(await turnstile(request, String(get("turnstileToken") ?? "") || null))) return json({ error: "Vérification de sécurité échouée." }, 400);
      const key = await sha256(`${request.headers.get("CF-Connecting-IP") ?? "local"}:${username}`);
      const attempt = await env.DB.prepare(`SELECT count,window_started_at FROM login_attempts WHERE key=?`).bind(key).first<{count:number;window_started_at:string}>();
      if (attempt && Date.now() - Date.parse(attempt.window_started_at) < 15 * 60_000 && attempt.count >= 8) return json({ error: "Trop de tentatives. Réessayez dans 15 minutes." }, 429);
      const user = await env.DB.prepare(`SELECT * FROM users WHERE username=? AND active=1`).bind(username).first<User & {password_hash:string;password_salt:string}>();
      const candidate = user ? await passwordHash(password, user.password_salt) : await passwordHash(password, "00000000000000000000000000000000");
      const valid = user ? crypto.subtle.timingSafeEqual(
        Uint8Array.from(candidate.hash.match(/.{2}/g)!.map((x) => parseInt(x, 16))),
        Uint8Array.from(user.password_hash.match(/.{2}/g)!.map((x) => parseInt(x, 16))),
      ) : false;
      if (!user || !valid) {
        await env.DB.prepare(`INSERT INTO login_attempts(key,count,window_started_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_started_at<? THEN 1 ELSE count+1 END,window_started_at=CASE WHEN window_started_at<? THEN excluded.window_started_at ELSE window_started_at END`).bind(key, now(), new Date(Date.now()-15*60_000).toISOString(), new Date(Date.now()-15*60_000).toISOString()).run();
        return json({ error: "Identifiant ou mot de passe incorrect." }, 401);
      }
      await env.DB.prepare(`DELETE FROM login_attempts WHERE key=?`).bind(key).run();
      const token = randomToken(); const csrf = randomToken();
      await env.DB.prepare(`INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)`).bind(await sha256(token), user.id, csrf, new Date(Date.now()+7*86400000).toISOString(), now()).run();
      return json({ ok: true }, 200, { "Set-Cookie": `monfrench_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`, "Cache-Control": "no-store" });
    }

    if (action === "logout") {
      const current = await requireSession(request); const token = cookie(request, "monfrench_session");
      if (token) await env.DB.prepare(`DELETE FROM sessions WHERE id_hash=?`).bind(await sha256(token)).run();
      return json({ ok: true }, 200, { "Set-Cookie": "monfrench_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" });
    }

    const current = await requireSession(request);
    if (action === "change_password") {
      const password = String(get("password") ?? ""); if (password.length < 10) return json({ error: "Le mot de passe doit contenir au moins 10 caractères." }, 400);
      const hashed = await passwordHash(password); await env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,must_change_password=0 WHERE id=?`).bind(hashed.hash, hashed.salt, current.id).run(); return json({ ok: true });
    }
    if (current.role !== "teacher" && !["open_assignment","submit"].includes(action)) return json({ error: "Réservé à l’enseignant." }, 403);

    if (action === "create_student") {
      const username = String(get("username") ?? "").trim().toLowerCase(); const name = String(get("displayName") ?? "").trim(); const password = String(get("password") ?? "");
      if (!/^[a-z0-9._-]{3,40}$/.test(username) || !name || password.length < 8) return json({ error: "Identifiant invalide ou mot de passe temporaire trop court." }, 400);
      const hashed = await passwordHash(password); await env.DB.prepare(`INSERT INTO users(id,username,display_name,role,password_hash,password_salt,active,must_change_password,created_at) VALUES(?,?,?,?,?,?,1,1,?)`).bind(id(), username, name, "student", hashed.hash, hashed.salt, now()).run(); return json({ ok: true });
    }
    if (action === "create_activity") {
      const title = String(get("title") ?? "").trim(); const category = String(get("category") ?? ""); const file = get("file"); const externalUrl = String(get("externalUrl") ?? "").trim() || null;
      if (!title || !["Grammaire","Conjugaison","Lecture","Écoute","Écriture"].includes(category)) return json({ error: "Titre ou catégorie invalide." }, 400);
      const activityId = id(); let r2Key: string | null = null; let originalName: string | null = null; let contentType: string | null = null;
      if (file instanceof File && file.size) { if (file.size > 50*1024*1024) return json({ error: "Fichier trop volumineux (50 Mo maximum)." }, 413); r2Key=`activities/${activityId}/${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`; originalName=file.name; contentType=file.type||"application/octet-stream"; await env.FILES.put(r2Key,file.stream(),{httpMetadata:{contentType}}); }
      if (!r2Key && !externalUrl && category !== "Écriture") return json({ error: "Ajoutez un fichier ou un lien." }, 400);
      await env.DB.prepare(`INSERT INTO activities(id,title,category,description,instructions,r2_key,original_name,content_type,external_url,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(activityId,title,category,String(get("description")??""),String(get("instructions")??""),r2Key,originalName,contentType,externalUrl,current.id,now()).run(); return json({ ok:true });
    }
    if (action === "init_activity_upload") {
      const title=String(get("title")??"").trim(), category=String(get("category")??""), fileName=String(get("fileName")??"activity.html"), contentType=String(get("contentType")??"application/octet-stream"), fileSize=Number(get("fileSize")??0);
      if(!title||!["Grammaire","Conjugaison","Lecture","Écoute","Écriture"].includes(category))return json({error:"Titre ou catégorie invalide."},400);
      if(!Number.isFinite(fileSize)||fileSize<1||fileSize>50*1024*1024)return json({error:"Le fichier doit faire moins de 50 Mo."},413);
      const activityId=id(), safeName=fileName.replace(/[^a-zA-Z0-9._-]/g,"_"), key=`activities/${current.id}/${activityId}/${safeName}`;
      return json({ok:true,activityId,key,uploadId:id()});
    }
    if (action === "complete_activity_upload") {
      const title=String(get("title")??"").trim(), category=String(get("category")??""), activityId=String(get("activityId")??""), key=String(get("key")??""), uploadId=String(get("uploadId")??""), originalName=String(get("fileName")??"activity.html"), contentType=String(get("contentType")??"application/octet-stream"), fileSize=Number(get("fileSize")??0), parts=get("parts") as Array<{partNumber:number;etag:string}>;
      if(!title||!["Grammaire","Conjugaison","Lecture","Écoute","Écriture"].includes(category)||!activityId||!key.startsWith(`activities/${current.id}/${activityId}/`)||!uploadId||!Number.isFinite(fileSize)||fileSize<1||fileSize>50*1024*1024||!Array.isArray(parts)||!parts.length)return json({error:"Téléversement incomplet."},400);
      const ordered=[...parts].sort((a,b)=>a.partNumber-b.partNumber);
      if(ordered.some((part,index)=>part.partNumber!==index+1||!part.etag))return json({error:"Parties de fichier invalides."},400);
      const prefix=stagedUploadPrefix(key,uploadId), keys=ordered.map((part)=>stagedPartKey(prefix,part.partNumber));
      const fixed=new FixedLengthStream(fileSize), writer=fixed.writable.getWriter(), finalUpload=env.FILES.put(key,fixed.readable,{httpMetadata:{contentType}});
      let uploadedSize=0;
      try{
        for(let index=0;index<keys.length;index++){
          const object=await env.FILES.get(keys[index]);if(!object||object.etag!==ordered[index].etag)throw json({error:"Une partie du fichier est manquante."},400);uploadedSize+=object.size;
          const partReader=object.body.getReader();while(true){const next=await partReader.read();if(next.done)break;await writer.write(next.value);}partReader.releaseLock();
        }
        if(uploadedSize!==fileSize)throw json({error:"Le fichier téléversé est incomplet."},400);
        await writer.close();await finalUpload;
      }catch(error){try{await writer.abort(error);}catch{}try{await finalUpload;}catch{}throw error;}
      try{await env.DB.prepare(`INSERT INTO activities(id,title,category,description,instructions,r2_key,original_name,content_type,external_url,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,NULL,?,?)`).bind(activityId,title,category,String(get("description")??""),String(get("instructions")??""),key,originalName,contentType,current.id,now()).run();}catch(error){const existing=await env.DB.prepare(`SELECT r2_key,created_by FROM activities WHERE id=?`).bind(activityId).first<{r2_key:string;created_by:string}>();if(!existing||existing.r2_key!==key||existing.created_by!==current.id)throw error;}
      try{await deleteStagedUpload(prefix);}catch{}
      return json({ok:true,activityId});
    }
    if (action === "abort_activity_upload") {
      const key=String(get("key")??""), uploadId=String(get("uploadId")??"");
      if(key.startsWith(`activities/${current.id}/`)&&uploadId)await deleteStagedUpload(stagedUploadPrefix(key,uploadId));
      return json({ok:true});
    }
    if (action === "assign") {
      const activityId=String(get("activityId")??""); const studentIds=Array.isArray(get("studentIds"))?get("studentIds") as string[]:[]; if(!activityId||!studentIds.length)return json({error:"Choisissez une activité et au moins un élève."},400);
      const assignmentId=id(); await env.DB.prepare(`INSERT INTO assignments(id,activity_id,due_at,instructions,published_at,created_by) VALUES(?,?,?,?,?,?)`).bind(assignmentId,activityId,String(get("dueAt")??"")||null,String(get("instructions")??""),now(),current.id).run();
      await env.DB.batch(studentIds.map((studentId)=>env.DB.prepare(`INSERT INTO assignment_students(assignment_id,student_id,status) VALUES(?,?,'assigned')`).bind(assignmentId,studentId))); return json({ok:true});
    }
    if (action === "open_assignment") { await env.DB.prepare(`UPDATE assignment_students SET status='opened',opened_at=COALESCE(opened_at,?) WHERE assignment_id=? AND student_id=?`).bind(now(),String(get("assignmentId")),current.id).run(); return json({ok:true}); }
    if (action === "submit") {
      const assignmentId=String(get("assignmentId")??""); const assigned=await env.DB.prepare(`SELECT 1 ok FROM assignment_students WHERE assignment_id=? AND student_id=?`).bind(assignmentId,current.id).first(); if(!assigned)return json({error:"Devoir introuvable."},404);
      const file=get("file"); let r2Key:null|string=null, originalName:null|string=null, contentType:null|string=null; if(file instanceof File&&file.size){if(file.size>25*1024*1024)return json({error:"Fichier trop volumineux (25 Mo maximum)."},413); r2Key=`submissions/${assignmentId}/${current.id}/${id()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`; originalName=file.name;contentType=file.type||"application/octet-stream";await env.FILES.put(r2Key,file.stream(),{httpMetadata:{contentType}});}
      await env.DB.prepare(`INSERT INTO submissions(id,assignment_id,student_id,writing,r2_key,original_name,content_type,submitted_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET writing=excluded.writing,r2_key=excluded.r2_key,original_name=excluded.original_name,content_type=excluded.content_type,submitted_at=excluded.submitted_at`).bind(id(),assignmentId,current.id,String(get("writing")??"")||null,r2Key,originalName,contentType,now()).run(); await env.DB.prepare(`UPDATE assignment_students SET status='submitted',completed_at=? WHERE assignment_id=? AND student_id=?`).bind(now(),assignmentId,current.id).run();return json({ok:true});
    }
    if (action === "feedback") { const submissionId=String(get("submissionId")??"");await env.DB.prepare(`UPDATE submissions SET feedback=?,corrected_at=? WHERE id=?`).bind(String(get("feedback")??""),now(),submissionId).run();return json({ok:true}); }
    return json({ error: "Action inconnue." }, 400);
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error && /UNIQUE/.test(error.message) ? "Cet identifiant existe déjà." : "Une erreur est survenue.";
    return json({ error: message }, 500);
  }
}
