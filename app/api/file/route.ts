import { env } from "cloudflare:workers";
export const dynamic = "force-dynamic";

const hex = (b:Uint8Array)=>[...b].map(n=>n.toString(16).padStart(2,"0")).join("");
const hash=async(v:string)=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))));
const cookie=(r:Request)=>r.headers.get("cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith("monfrench_session="))?.slice("monfrench_session=".length);
const noStore={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const sessionCutoff=()=>new Date(Date.now()-12*60*60_000).toISOString();
const studentActivityName=(contentType:string)=>contentType.startsWith("text/html")?"activite.html":contentType==="application/pdf"?"document.pdf":contentType==="audio/mpeg"?"audio.mp3":contentType==="audio/mp4"?"audio.m4a":contentType==="audio/wav"?"audio.wav":"activite";

export async function GET(request:Request){
  const token=cookie(request); if(!token)return new Response("Non autorisé",{status:401,headers:noStore});
  const user=await env.DB.prepare(`SELECT u.id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>? AND s.created_at>? AND u.active=1`).bind(await hash(token),new Date().toISOString(),sessionCutoff()).first<{id:string;role:string}>(); if(!user)return new Response("Non autorisé",{status:401,headers:noStore});
  const url=new URL(request.url),kind=url.searchParams.get("kind"),recordId=url.searchParams.get("id"); let row:{r2_key:string|null;original_name:string|null;content_type:string|null}|null=null;
  if(kind==="activity") row=await env.DB.prepare(`SELECT ac.r2_key,ac.original_name,ac.content_type FROM activities ac ${user.role==="student"?"JOIN assignments a ON a.activity_id=ac.id JOIN assignment_students ast ON ast.assignment_id=a.id":""} WHERE ac.id=? ${user.role==="student"?"AND ast.student_id=?":""}`).bind(...(user.role==="student"?[recordId,user.id]:[recordId])).first();
  if(kind==="submission") row=await env.DB.prepare(`SELECT r2_key,original_name,content_type FROM submissions WHERE id=? AND (student_id=? OR ?='teacher')`).bind(recordId,user.id,user.role).first();
  if(!row?.r2_key)return new Response("Fichier introuvable",{status:404,headers:noStore}); const object=await env.FILES.get(row.r2_key); if(!object)return new Response("Fichier introuvable",{status:404,headers:noStore});
  const contentType=row.content_type||"application/octet-stream",responseName=kind==="activity"&&user.role==="student"?studentActivityName(contentType):row.original_name||"fichier",responseHeaders:Record<string,string>={...noStore,"Content-Type":contentType,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(responseName)}`};
  if(contentType.startsWith("text/html"))responseHeaders["Content-Security-Policy"]="sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads; default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  return new Response(object.body,{headers:responseHeaders});
}
