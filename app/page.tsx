"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Role = "principal" | "teacher" | "student";
type View = "student" | "teacher" | "students" | "library" | "viewer";
type WorkStatus = "assigned" | "draft" | "submitted" | "corrected" | "redo";
type RecordRow = Record<string, unknown> & { id: string };
type User = RecordRow & { identifier: string; display_name: string; role: Role; active: number | boolean; must_change_password?: number | boolean };
type Preference = { theme?: "chateau" | "nuit"; text_size?: "s" | "m" | "l"; solid_contrast?: number | boolean; reduced_motion?: number | boolean };
type Portal = {
  authenticated: boolean;
  setupRequired?: boolean;
  csrfToken?: string;
  user?: User;
  permissions?: Record<string, boolean>;
  preferences?: Preference;
  categories?: RecordRow[];
  collections?: RecordRow[];
  units?: RecordRow[];
  activities?: RecordRow[];
  assignments?: RecordRow[];
  recipients?: RecordRow[];
  savedWork?: RecordRow[];
  submissions?: RecordRow[];
  reviews?: RecordRow[];
  users?: User[];
  groups?: RecordRow[];
  publicationReviews?: RecordRow[];
};
type Activity = {
  id: string;
  versionId?: string;
  assignmentId?: string;
  submissionId?: string;
  title: string;
  category: string;
  description: string;
  status: WorkStatus;
  progress: number;
  fileAvailable: boolean;
  initialState?: unknown;
  feedback?: string;
};
type ReviewItem = { id: string; studentId: string; student: string; activity: Activity; submittedAt: string };
type Send = (body: Record<string, unknown> | FormData, options?: { reload?: boolean }) => Promise<Record<string, unknown> | null>;

const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value : fallback;
const bool = (value: unknown) => value === true || value === 1 || value === "1";
const statusOf = (value: unknown): WorkStatus => ["assigned", "draft", "submitted", "corrected", "redo"].includes(String(value)) ? value as WorkStatus : "assigned";
const dateLabel = (value: unknown) => value ? new Date(String(value)).toLocaleString("fr-CA", { dateStyle: "medium", timeStyle: "short" }) : "—";
const stateOf = (value: unknown): unknown => {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value); } catch { return {}; }
};

export default function Home() {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [view, setView] = useState<View>("student");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Activity | null>(null);
  const [reviewing, setReviewing] = useState<ReviewItem | null>(null);
  const [from, setFrom] = useState<View>("student");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };

  const load = useCallback(async () => {
    const response = await fetch("/api/portal", { cache: "no-store" });
    const data = await response.json() as Portal;
    setPortal(data);
    if (data.authenticated && data.user) setView(data.user.role === "student" ? "student" : "teacher");
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { load().catch(() => setError("Impossible de charger MonFrench.")); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const csrfToken = portal?.csrfToken;
  const send = useCallback(async (body: Record<string, unknown> | FormData, options: { reload?: boolean } = {}) => {
    setBusy(true); setError("");
    const isForm = body instanceof FormData;
    const response = await fetch("/api/portal", {
      method: "POST",
      headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
      body: isForm ? body : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({ error: "La requête a échoué." })) as Record<string, unknown>;
    setBusy(false);
    if (!response.ok) { setError(text(result.error, "La requête a échoué.")); return null; }
    if (options.reload !== false) await load();
    return result;
  }, [csrfToken, load]);

  const preference = portal?.preferences ?? {};
  const theme = preference.theme ?? "chateau";
  const fontSize = ({ s: 0, m: 1, l: 2 } as const)[preference.text_size ?? "m"];
  useEffect(() => {
    document.documentElement.style.setProperty("--fs", ["14.5px", "16px", "18px"][fontSize]);
    document.body.className = [theme === "nuit" ? "nuit" : "", bool(preference.solid_contrast) ? "solid" : "", bool(preference.reduced_motion) ? "calm" : ""].filter(Boolean).join(" ");
  }, [fontSize, preference.reduced_motion, preference.solid_contrast, theme]);

  const activities = useMemo(() => normalizeActivities(portal), [portal]);
  const queue = useMemo(() => normalizeQueue(portal, activities), [portal, activities]);
  const open = (activity: Activity, source: View, review?: ReviewItem) => { setActive(activity); setFrom(source); setReviewing(review ?? null); setView("viewer"); };
  const logout = async () => { await send({ action: "logout" }); setSettingsOpen(false); setPortal({ authenticated: false }); };

  if (!portal) return <Loading message={error || "Préparation de votre espace…"} />;
  if (!portal.authenticated) return <Shell toast={toast}><Login setup={!!portal.setupRequired} busy={busy} error={error} send={send} /></Shell>;
  if (portal.user?.must_change_password) return <Shell toast={toast}><PasswordChange role={portal.user.role} busy={busy} error={error} send={send} /></Shell>;

  const role = portal.user!.role;
  return <Shell toast={toast}>
    <AppBar role={role} view={view} go={setView} logout={logout} settings={() => setSettingsOpen(value => !value)} />
    {settingsOpen && <Settings preference={preference} save={async update => { const result = await send({ action: "save_preferences", ...update }); if (result) notify("Réglages enregistrés"); }} />}
    {error && <div className="error-banner" role="alert">{error}</div>}
    <main className={view === "viewer" ? "viewer-main" : ""}>
      {view === "student" && <StudentHome user={portal.user!} activities={activities} open={activity => open(activity, "student")} />}
      {view === "teacher" && <TeacherHome portal={portal} queue={queue} open={item => open(item.activity, "teacher", item)} go={setView} />}
      {view === "students" && <Students portal={portal} busy={busy} send={send} notify={notify} />}
      {view === "library" && <Library portal={portal} activities={activities} busy={busy} open={activity => open(activity, "library")} send={send} notify={notify} />}
      {view === "viewer" && active && <Viewer role={role} activity={active} review={reviewing} leave={() => setView(from)} send={send} notify={notify} onComplete={() => setView(role === "student" ? "student" : "teacher")} />}
    </main>
  </Shell>;
}

function Shell({ children, toast }: { children: React.ReactNode; toast: string }) {
  return <><div className="bg"><i className="blob b1" /><i className="blob b2" /><i className="blob b3" /><i className="blob b4" /></div>{children}<div className={`toast glass2 ${toast ? "on" : ""}`} role="status">{toast}</div></>;
}
function Loading({ message }: { message: string }) { return <Shell toast=""><main className="login"><div className="login-card glass"><Wordmark /><p className="sub">{message}</p></div></main></Shell>; }
function Wordmark() { return <div className="wordmark">Mon<b>French</b></div>; }

function Login({ setup, busy, error, send }: { setup: boolean; busy: boolean; error: string; send: Send }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    await send({ action: setup ? "setup" : "login", identifier: values.get("identifier"), password: values.get("password"), display_name: values.get("display_name"), setup_code: values.get("setup_code") });
  };
  return <main className="login"><section className="login-card glass"><Wordmark /><p className="sub">Votre espace de français, simplement.</p>{error && <p className="form-error">{error}</p>}<form onSubmit={submit}>{setup && <><label>Code de configuration<input name="setup_code" type="password" required /></label><label>Nom affiché<input name="display_name" required autoComplete="name" /></label></>}<label>Identifiant<input name="identifier" required autoComplete="username" autoCapitalize="none" /></label><label>Mot de passe<input name="password" type="password" minLength={setup ? 12 : 1} required autoComplete={setup ? "new-password" : "current-password"} /></label><button className="btn btn-primary wide" disabled={busy}>{busy ? "Veuillez patienter…" : setup ? "Créer le compte principal" : "Se connecter"}</button></form><p className="tiny lock">Accès privé · Données protégées</p></section></main>;
}
function PasswordChange({ role, busy, error, send }: { role: Role; busy: boolean; error: string; send: Send }) {
  return <main className="login"><section className="login-card glass"><Wordmark /><h2>Choisissez votre mot de passe</h2><p className="sub">Le mot de passe temporaire doit être remplacé avant de continuer.</p>{error && <p className="form-error">{error}</p>}<form onSubmit={event => { event.preventDefault(); send({ action: "change_password", password: new FormData(event.currentTarget).get("password") }); }}><label>Nouveau mot de passe<input name="password" type="password" minLength={role === "student" ? 1 : 10} required autoComplete="new-password" /></label><button className="btn btn-primary wide" disabled={busy}>Enregistrer</button></form></section></main>;
}

function AppBar({ role, view, go, logout, settings }: { role: Role; view: View; go: (view: View) => void; logout: () => void; settings: () => void }) {
  return <header className="app glass"><Wordmark /><span className="grow" />{role !== "student" && view !== "viewer" && <nav className="seg" aria-label="Navigation principale"><button className={view === "teacher" ? "on" : ""} onClick={() => go("teacher")}>Accueil</button><button className={view === "students" ? "on" : ""} onClick={() => go("students")}>Élèves</button><button className={view === "library" ? "on" : ""} onClick={() => go("library")}>Bibliothèque</button></nav>}<button className="iconbtn" onClick={settings} aria-label="Réglages">⚙</button><button className="btn btn-ghost" onClick={logout}>Quitter</button></header>;
}

function normalizeActivities(portal: Portal | null): Activity[] {
  if (!portal) return [];
  const activities = portal.activities ?? [];
  const assignments = portal.assignments ?? [];
  const savedWork = portal.savedWork ?? [];
  const submissions = portal.submissions ?? [];
  const normalized = (row: RecordRow, assignment?: RecordRow): Activity => {
    const work = assignment ? savedWork.find(item => String(item.assignment_id) === assignment.id) : undefined;
    const submission = assignment ? submissions.find(item => item.id === String(assignment.submission_id) || String(item.assignment_id) === assignment.id) : undefined;
    return { id: row.id, versionId: text(assignment?.activity_version_id ?? row.current_version_id ?? row.version_id) || undefined, assignmentId: assignment?.id, submissionId: text(assignment?.submission_id) || undefined, title: text(row.title, "Activité sans titre"), category: text(row.category_name ?? row.category, "Français"), description: text(row.description ?? row.instructions, "Activité interactive"), status: statusOf(assignment?.work_status ?? assignment?.recipient_status ?? row.work_status), progress: Number(assignment?.progress ?? row.progress ?? 0), fileAvailable: bool(row.file_available ?? row.r2_key ?? row.original_name), initialState: stateOf(work?.state_json ?? submission?.state_json), feedback: text(submission?.feedback) || undefined };
  };
  if (portal.user?.role === "student") return assignments.map(assignment => { const row = activities.find(item => item.id === String(assignment.activity_id)) ?? ({ id: String(assignment.activity_id), title: assignment.activity_title } as RecordRow); return normalized(row, assignment); });
  return activities.map(row => normalized(row, assignments.find(item => String(item.activity_id) === row.id)));
}
function normalizeQueue(portal: Portal | null, activities: Activity[]): ReviewItem[] {
  if (!portal) return [];
  return (portal.submissions ?? []).filter(row => !row.review_state || row.review_state === "pending").map(row => {
    const activity = activities.find(item => item.id === String(row.activity_id)) ?? { id: String(row.activity_id ?? row.assignment_id), assignmentId: String(row.assignment_id), title: text(row.activity_title, "Activité"), category: text(row.category_name, "Français"), description: "", status: "submitted", progress: 100, fileAvailable: false };
    return { id: row.id, studentId: String(row.student_id), student: text(row.student_name ?? row.display_name, "Élève"), activity: { ...activity, assignmentId: String(row.assignment_id), submissionId: row.id, initialState: stateOf(row.state_json) }, submittedAt: dateLabel(row.submitted_at) };
  });
}

function StudentHome({ user, activities, open }: { user: User; activities: Activity[]; open: (activity: Activity) => void }) {
  const [pile, setPile] = useState<"todo" | "sent" | "done">("todo");
  const filtered = activities.filter(activity => pile === "todo" ? ["assigned", "draft", "redo"].includes(activity.status) : pile === "sent" ? activity.status === "submitted" : activity.status === "corrected");
  const counts = { todo: activities.filter(activity => ["assigned", "draft", "redo"].includes(activity.status)).length, sent: activities.filter(activity => activity.status === "submitted").length, done: activities.filter(activity => activity.status === "corrected").length };
  return <section className="view on"><div className="hero"><div><p className="sub">Bonjour {user.display_name}</p><h1>Mon travail</h1></div></div><div className="glass card"><div className="pilltab"><button className={pile === "todo" ? "on" : ""} onClick={() => setPile("todo")}>À faire <span className="count">{counts.todo}</span></button><button className={pile === "sent" ? "on" : ""} onClick={() => setPile("sent")}>Envoyé <span className="count">{counts.sent}</span></button><button className={pile === "done" ? "on" : ""} onClick={() => setPile("done")}>Corrigé <span className="count">{counts.done}</span></button></div>{filtered.length ? filtered.map(activity => <ActivityRow key={`${activity.id}-${activity.assignmentId}`} activity={activity} onClick={() => open(activity)} />) : <p className="sub empty">Rien ici pour l’instant.</p>}</div></section>;
}
function ActivityRow({ activity, onClick }: { activity: Activity; onClick: () => void }) {
  const labels: Record<WorkStatus, [string, string]> = { assigned: ["gy", "À faire"], draft: ["b", "En cours"], submitted: ["am", "Envoyé"], corrected: ["gr", "Corrigé"], redo: ["b", "À refaire"] }; const badge = labels[activity.status];
  return <button className="act" onClick={onClick}><span className="thumb">◉</span><span className="grow"><span className="tag">{activity.category}</span><strong>{activity.title}</strong><small>{activity.status === "draft" ? `En cours · ${activity.progress} %` : activity.description}</small>{activity.feedback && ["corrected", "redo"].includes(activity.status) && <small className="correction-feedback">Retour : {activity.feedback}</small>}{activity.status === "draft" && activity.progress > 0 && activity.progress < 100 ? <span className="bar"><i style={{ width: `${activity.progress}%` }} /></span> : null}</span><span className={`badge ${badge[0]}`}>{badge[1]}</span></button>;
}

function TeacherHome({ portal, queue, open, go }: { portal: Portal; queue: ReviewItem[]; open: (item: ReviewItem) => void; go: (view: View) => void }) {
  const students = (portal.users ?? []).filter(user => user.role === "student" && bool(user.active)).length;
  const published = (portal.activities ?? []).filter(activity => activity.publication_status === "published" || activity.status === "published").length;
  return <section className="view on"><div className="hero"><div><p className="sub">Bonjour {portal.user?.display_name}</p><h1>Vue d’ensemble</h1></div><button className="btn btn-primary" onClick={() => go("library")}>Assigner une activité</button></div><div className="grid g3 stats"><article className="glass card stat"><span className="n">{queue.length}</span><span className="sub">copies à corriger</span></article><article className="glass card stat"><span className="n">{students}</span><span className="sub">élèves actifs</span></article><article className="glass card stat"><span className="n">{published}</span><span className="sub">activités publiées</span></article></div><section className="glass card block"><div className="row"><div className="grow"><h2>À corriger</h2><p className="sub">{queue.length ? `${queue.length} copie${queue.length > 1 ? "s" : ""} attend${queue.length > 1 ? "ent" : ""} votre correction.` : "Tout est corrigé. Belle journée !"}</p></div><span className="badge am">{queue.length}</span></div><hr />{queue.map(item => <button className="act" key={item.id} onClick={() => open(item)}><span className="thumb amber">✎</span><span className="grow"><strong>{item.student} · {item.activity.title}</strong><small>{item.submittedAt}</small></span><span className="btn">Corriger</span></button>)}</section></section>;
}

function Students({ portal, busy, send, notify }: { portal: Portal; busy: boolean; send: Send; notify: (message: string) => void }) {
  const [creating, setCreating] = useState(false);
  const students = (portal.users ?? []).filter(user => user.role === "student");
  const teachers = (portal.users ?? []).filter(user => user.role === "teacher");
  const create = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget), role = String(data.get("role") ?? "student"); const result = await send({ action: "create_user", role, identifier: data.get("identifier"), display_name: data.get("display_name"), password: data.get("password"), teacher_id: data.get("teacher_id"), group_id: data.get("group_id") }); if (result) { setCreating(false); notify(text(result.temporary_password) ? `Compte créé · mot de passe temporaire : ${text(result.temporary_password)}` : "Compte créé"); } };
  const setPermission = async (userId: string, kind: string, granted: boolean) => { const result = await send({ action: "set_permission", user_id: userId, kind, granted }); if (result) notify("Permission mise à jour"); };
  return <section className="view on"><div className="hero"><div><p className="sub">Administration simple</p><h1>Élèves</h1></div>{portal.user?.role === "principal" && <button className="btn btn-primary" onClick={() => setCreating(true)}>Nouveau compte</button>}</div>{creating && <form className="glass card inline-form" onSubmit={create}><label>Type de compte<select name="role"><option value="student">Élève</option><option value="teacher">Enseignant</option></select></label><label>Nom affiché<input name="display_name" required /></label><label>Identifiant<input name="identifier" required autoCapitalize="none" /></label><label>Mot de passe initial<input name="password" type="password" minLength={1} placeholder="Laisser vide pour en générer un" /></label><label>Enseignant responsable<select name="teacher_id"><option value="">Aucun</option>{teachers.map(user => <option value={user.id} key={user.id}>{user.display_name}</option>)}</select></label><label>Groupe<select name="group_id"><option value="">Aucun</option>{(portal.groups ?? []).map(group => <option value={group.id} key={group.id}>{text(group.name)}</option>)}</select></label><button className="btn btn-primary" disabled={busy}>Créer</button><button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>Annuler</button></form>}{portal.user?.role === "principal" && teachers.length > 0 && <section className="glass card block"><h2>Enseignants</h2>{teachers.map(user => <div className="teacher-permissions row" key={user.id}><span className="avatar">{user.display_name[0]}</span><span className="grow"><strong>{user.display_name}</strong><small>{user.identifier}</small></span><label className="check"><input type="checkbox" checked={bool(user.upload_library)} onChange={event => setPermission(user.id, "upload_library", event.target.checked)} />Importer</label><label className="check"><input type="checkbox" checked={bool(user.direct_publish)} onChange={event => setPermission(user.id, "direct_publish", event.target.checked)} />Publier directement</label></div>)}</section>}<div className="grid g2 block">{students.map(user => <article className="glass card row" key={user.id}><span className="avatar">{user.display_name[0]}</span><span className="grow"><strong>{user.display_name}</strong><small>{user.identifier} · {bool(user.active) ? "actif" : "inactif"}</small></span><button className="btn btn-ghost" onClick={async () => { const result = await send({ action: "reset_password", user_id: user.id }); if (result) notify(text(result.temporary_password) ? `Nouveau mot de passe temporaire : ${text(result.temporary_password)}` : "Mot de passe temporaire généré"); }}>Réinitialiser</button></article>)}</div></section>;
}

function Library({ portal, activities, busy, open, send, notify }: { portal: Portal; activities: Activity[]; busy: boolean; open: (activity: Activity) => void; send: Send; notify: (message: string) => void }) {
  const [uploading, setUploading] = useState(false), [assigning, setAssigning] = useState<Activity | null>(null), [query, setQuery] = useState("");
  const uploadAllowed = portal.user?.role === "principal" || portal.permissions?.upload === true;
  const visible = activities.filter(activity => `${activity.title} ${activity.category}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr")));
  const upload = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set("action", "create_activity"); const result = await send(form); if (result) { setUploading(false); notify(text(result.publication_status) === "pending_review" ? "Activité envoyée pour approbation" : "Activité publiée"); } };
  const assign = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!assigning) return; const form = new FormData(event.currentTarget); const result = await send({ action: "create_assignment", activity_id: assigning.id, activity_version_id: assigning.versionId, student_ids: form.getAll("student_id"), group_ids: form.getAll("group_id"), due_at: form.get("due_at") }); if (result) { setAssigning(null); notify("Activité assignée"); } };
  const reviewPublication = async (id: string, decision: "approved" | "rejected") => { const result = await send({ action: "review_publication", publication_review_id: id, decision }); if (result) notify(decision === "approved" ? "Activité approuvée" : "Activité refusée"); };
  return <section className="view on"><div className="hero"><div><p className="sub">Activités disponibles</p><h1>Bibliothèque</h1></div>{uploadAllowed && <button className="btn btn-primary" onClick={() => setUploading(true)}>Importer une activité</button>}</div>{portal.user?.role === "principal" && (portal.publicationReviews ?? []).length > 0 && <section className="glass card block"><h2>À approuver</h2>{portal.publicationReviews!.map(review => <div className="act" key={review.id}><span className="thumb amber">⌛</span><span className="grow"><strong>{text(review.activity_title, "Nouvelle activité")}</strong><small>Importée par {text(review.requested_by_name, "un enseignant")}</small></span><button className="btn" onClick={() => reviewPublication(review.id, "rejected")}>Refuser</button><button className="btn btn-primary" onClick={() => reviewPublication(review.id, "approved")}>Approuver</button></div>)}</section>}{uploading && <form className="glass card inline-form" onSubmit={upload}><label>Titre<input name="title" required /></label><label>Catégorie<select name="category_id" required>{(portal.categories ?? []).map(category => <option value={category.id} key={category.id}>{text(category.name)}</option>)}</select></label><label>Fichier HTML<input name="file" type="file" accept=".html,text/html" required /></label><label>Description<input name="description" /></label><button className="btn btn-primary" disabled={busy}>Importer</button><button className="btn btn-ghost" type="button" onClick={() => setUploading(false)}>Annuler</button></form>}<div className="glass card"><div className="row filters"><input aria-label="Rechercher" placeholder="Rechercher une activité…" value={query} onChange={event => setQuery(event.target.value)} /></div><hr />{visible.map(activity => <div className="act" key={activity.id}><span className="thumb">◉</span><span className="grow"><span className="tag">{activity.category}</span><strong>{activity.title}</strong><small>{activity.description}</small></span><button className="btn" onClick={() => open(activity)}>Aperçu</button><button className="btn btn-primary" onClick={() => setAssigning(activity)}>Assigner</button></div>)}</div>{assigning && <div className="overlay"><form className="modal glass" onSubmit={assign}><h2>Assigner l’activité</h2><p className="sub">{assigning.title}</p><fieldset><legend>Élèves</legend>{(portal.users ?? []).filter(user => user.role === "student" && bool(user.active)).map(user => <label className="check" key={user.id}><input type="checkbox" name="student_id" value={user.id} />{user.display_name}</label>)}</fieldset>{(portal.groups ?? []).length > 0 && <fieldset><legend>Groupes</legend>{portal.groups!.map(group => <label className="check" key={group.id}><input type="checkbox" name="group_id" value={group.id} />{text(group.name)}</label>)}</fieldset>}<label>Échéance<input name="due_at" type="datetime-local" /></label><div className="row end"><button className="btn btn-ghost" type="button" onClick={() => setAssigning(null)}>Annuler</button><button className="btn btn-primary" disabled={busy}>Assigner</button></div></form></div>}</section>;
}

function Viewer({ role, activity, review, leave, send, notify, onComplete }: { role: Role; activity: Activity; review: ReviewItem | null; leave: () => void; send: Send; notify: (message: string) => void; onComplete: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null), timer = useRef<number | undefined>(undefined), latestState = useRef<unknown>(activity.initialState ?? {});
  const [saved, setSaved] = useState(true), [progress, setProgress] = useState(activity.progress), [confirm, setConfirm] = useState(false), [note, setNote] = useState(""), [frameHeight, setFrameHeight] = useState<number | null>(null);
  const save = useCallback(async (state: unknown, nextProgress = progress) => { if (role !== "student" || !activity.assignmentId || review) return; setSaved(false); const result = await send({ action: "save_work", assignment_id: activity.assignmentId, state, progress: nextProgress }, { reload: false }); setSaved(Boolean(result)); }, [activity.assignmentId, progress, review, role, send]);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null" || !event.data || typeof event.data !== "object") return;
      const message = event.data as Record<string, unknown>;
      if (!["monfrench-ready", "monfrench-save", "monfrench-submit", "monfrench-resize", "monfrench-progress", "monfrench-download-request"].includes(String(message.type))) return;
      try { if (JSON.stringify(message).length > 1_000_000) return; } catch { return; }
      if (message.type === "monfrench-ready") frame.current?.contentWindow?.postMessage({ type: "monfrench-load-state", state: latestState.current }, "*");
      if (message.type === "monfrench-save") { latestState.current = message.state ?? {}; window.clearTimeout(timer.current); timer.current = window.setTimeout(() => save(latestState.current), 700); }
      if (message.type === "monfrench-progress" && Number.isFinite(message.progress) && Number(message.progress) >= 0 && Number(message.progress) <= 100) setProgress(Number(message.progress));
      if (message.type === "monfrench-resize") {
        const requestedHeight = message.height ?? message.contentHeight;
        if (typeof requestedHeight === "number" && Number.isFinite(requestedHeight)) setFrameHeight(Math.round(Math.min(2400, Math.max(320, requestedHeight))));
      }
      if (message.type === "monfrench-submit") setConfirm(true);
    };
    window.addEventListener("message", handler); return () => { window.removeEventListener("message", handler); window.clearTimeout(timer.current); };
  }, [save]);
  const submit = async () => { const result = await send({ action: "submit_work", assignment_id: activity.assignmentId, state: latestState.current, progress }); if (result) { notify("Travail envoyé ✓"); onComplete(); } };
  const finish = async (decision: "corrected" | "redo") => { if (!review) return; const result = await send({ action: "review_submission", submission_id: review.id, decision, feedback: note }); if (result) { notify(decision === "redo" ? `Renvoyé à ${review.student} — à refaire` : `Corrigé et renvoyé à ${review.student} ✓`); onComplete(); } };
  const fileId = activity.versionId ?? activity.id;
  return <section className="view on"><div className="viewerbar glass2"><button className="btn btn-ghost" onClick={leave}>← Retour</button><span className="ttl grow">{review ? `Copie de ${review.student} · ` : ""}{activity.title}</span>{role === "student" && <span className={`save ${saved ? "" : "busy"}`}><i />{saved ? "Enregistré" : "Enregistrement…"}</span>}{role === "student" && !review && activity.assignmentId && activity.status !== "submitted" && activity.status !== "corrected" && <button className="btn btn-primary" onClick={() => setConfirm(true)}>Soumettre</button>}</div><div className="stage activity-stage" style={frameHeight ? { height: frameHeight + 108 } : undefined}>{activity.fileAvailable ? <iframe ref={frame} className="activity-frame" style={frameHeight ? { height: frameHeight } : undefined} title={activity.title} src={`/api/file?kind=activity&id=${encodeURIComponent(fileId)}`} sandbox="allow-scripts allow-forms allow-downloads" referrerPolicy="no-referrer" /> : <ReferenceWorksheet activity={activity} />}{review && <div className="reviewbar glass2"><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Écrire une note pour l’élève…" /><button className="btn" onClick={() => finish("redo")}>À refaire</button><button className="btn btn-primary" onClick={() => finish("corrected")}>Terminer la correction</button></div>}</div>{confirm && <div className="overlay"><div className="modal glass"><h2>Soumettre ce travail ?</h2><p className="sub">Après l’envoi, vous ne pourrez plus le modifier sauf si votre professeur le retourne « À refaire ».</p><div className="row end"><button className="btn btn-ghost" onClick={() => setConfirm(false)}>Pas encore</button><button className="btn btn-primary" onClick={submit}>Soumettre</button></div></div></div>}</section>;
}
function ReferenceWorksheet({ activity }: { activity: Activity }) { return <article className="page"><header className="pagehead"><div><span className="tag">{activity.category}</span><h2>{activity.title}</h2></div><strong>MonFrench</strong></header><p className="consigne">Cette activité ne contient pas encore de fichier HTML publié.</p><div className="empty-activity"><span className="thumb">◉</span><h3>Activité indisponible</h3><p className="sub">Demandez à votre enseignant de publier une nouvelle version.</p></div></article>; }

function Settings({ preference, save }: { preference: Preference; save: (update: Record<string, unknown>) => void }) {
  const size = ({ s: 0, m: 1, l: 2 } as const)[preference.text_size ?? "m"];
  return <aside className="settings glass2"><h3>Réglages</h3><div className="setting-row"><span>Thème</span><span className="seg"><button className={(preference.theme ?? "chateau") === "chateau" ? "on" : ""} onClick={() => save({ theme: "chateau" })}>Château de verre</button><button className={preference.theme === "nuit" ? "on" : ""} onClick={() => save({ theme: "nuit" })}>Nuit parisienne</button></span></div><div className="setting-row"><span>Taille du texte</span><span className="step"><button aria-label="Réduire la taille du texte" onClick={() => save({ text_size: ["s", "m", "l"][Math.max(0, size - 1)] })}>−</button><b>{["S", "M", "L"][size]}</b><button aria-label="Augmenter la taille du texte" onClick={() => save({ text_size: ["s", "m", "l"][Math.min(2, size + 1)] })}>+</button></span></div><label>Contraste uni<input type="checkbox" checked={bool(preference.solid_contrast)} onChange={event => save({ solid_contrast: event.target.checked })} /></label><label>Réduire les animations<input type="checkbox" checked={bool(preference.reduced_motion)} onChange={event => save({ reduced_motion: event.target.checked })} /></label></aside>;
}
