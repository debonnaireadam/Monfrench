import {createHash,randomBytes,scryptSync,timingSafeEqual} from "node:crypto";

export const ROLES=["principal","teacher","student"];
export const REVIEW_MODES=["none","required","direct"];
export const WORK_STATES=["assigned","draft","submitted","corrected","redo"];
export const BRIDGE_TYPES=new Set(["monfrench-ready","monfrench-load-state","monfrench-save","monfrench-submit","monfrench-resize","monfrench-progress","monfrench-download-request"]);

export function hashPassword(password,{salt=randomBytes(16).toString("hex"),pepper=""}={}){
  if(typeof password!=="string"||password.length<10)throw new Error("password_too_short");
  const hash=scryptSync(password+pepper,salt,64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(password,encoded,{pepper=""}={}){
  const [algorithm,salt,expected]=String(encoded).split("$");
  if(algorithm!=="scrypt"||!salt||!expected)return false;
  const actual=scryptSync(password+pepper,salt,64),wanted=Buffer.from(expected,"hex");
  return actual.length===wanted.length&&timingSafeEqual(actual,wanted);
}
export function can(role,permission){
  const map={principal:new Set(["accounts.manage","upload","publish","review.publication","assign","correct"]),teacher:new Set(["assign","correct"]),student:new Set(["work","submit"])};
  return map[role]?.has(permission)??false;
}
export function publicationStatus(mode){if(!REVIEW_MODES.includes(mode))throw new Error("invalid_review_mode");return mode==="direct"?"published":mode==="required"?"pending_review":"forbidden"}
export function transitionWork(current,event){
  const transitions={assigned:{save:"draft",submit:"submitted"},draft:{save:"draft",submit:"submitted"},submitted:{correct:"corrected",redo:"redo"},redo:{save:"draft",submit:"submitted"},corrected:{}};
  return transitions[current]?.[event]??null;
}
export function validateBridgeMessage(value){
  if(!value||typeof value!=="object"||!BRIDGE_TYPES.has(value.type))return {ok:false,error:"unsupported_type"};
  const serialized=JSON.stringify(value);if(serialized.length>1_000_000)return {ok:false,error:"payload_too_large"};
  if(value.type==="monfrench-resize"&&(!Number.isFinite(value.height)||value.height<200||value.height>5000))return {ok:false,error:"invalid_height"};
  if(value.type==="monfrench-progress"&&(!Number.isFinite(value.progress)||value.progress<0||value.progress>100))return {ok:false,error:"invalid_progress"};
  return {ok:true,value};
}
export function normalizeIdentifier(value){return String(value??"").trim().toLocaleLowerCase("fr-CA").normalize("NFKC")}
export function validateStudentRow(row,index=0){
  const errors=[],identifier=normalizeIdentifier(row.identifier),legacyId=String(row.legacy_id??"").trim(),displayName=String(row.display_name??"").trim();
  if(!legacyId)errors.push("legacy_id_required");if(!/^[a-z0-9._@-]{3,80}$/.test(identifier))errors.push("identifier_invalid");if(displayName.length<1||displayName.length>120)errors.push("display_name_invalid");
  const active=[true,1,"1","true","yes","oui"].includes(row.active);
  return {index,valid:errors.length===0,errors,value:{legacy_id:legacyId,identifier,display_name:displayName,active,teacher_identifier:normalizeIdentifier(row.teacher_identifier),group:String(row.group??"").trim()||null,must_change_password:!row.password_hash}};
}
export function planStudentImport(rows,existing=[]){
  const seen=new Set(existing.map(normalizeIdentifier)),legacySeen=new Set(),results=rows.map((row,index)=>{const result=validateStudentRow(row,index+1);if(result.valid&&seen.has(result.value.identifier))result.errors.push("identifier_collision");if(result.valid&&legacySeen.has(result.value.legacy_id))result.errors.push("duplicate_legacy_id");result.valid=result.errors.length===0;if(result.valid){seen.add(result.value.identifier);legacySeen.add(result.value.legacy_id)}return result});
  return {fingerprint:createHash("sha256").update(JSON.stringify(rows)).digest("hex"),total:results.length,valid:results.filter(x=>x.valid).length,failed:results.filter(x=>!x.valid).length,results};
}
