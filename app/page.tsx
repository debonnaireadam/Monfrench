"use client";

import { FormEvent, useMemo, useState } from "react";

type View = "welcome" | "student" | "teacher" | "activity";
type TeacherSection = "overview" | "activities" | "assignments" | "students" | "settings";
type Category = "Grammaire" | "Conjugaison" | "Lecture" | "Écoute" | "Écriture" | "Application";
type AssignmentStatus = "À faire" | "En cours" | "Terminée" | "À corriger";

type Activity = {
  id: number;
  title: string;
  category: Category;
  description: string;
  source: "Fichier HTML" | "Lien externe";
  updated: string;
  duration: number;
};

type Assignment = {
  id: number;
  activityId: number;
  title: string;
  category: Exclude<Category, "Application">;
  instructions: string;
  due: string;
  duration: number;
  status: AssignmentStatus;
};

const initialActivities: Activity[] = [
  {
    id: 1,
    title: "Les accords du participe passé",
    category: "Grammaire",
    description: "Règle, exemples et dix phrases à compléter.",
    source: "Fichier HTML",
    updated: "Aujourd’hui",
    duration: 15,
  },
  {
    id: 2,
    title: "Conjuguer au passé composé",
    category: "Conjugaison",
    description: "Entraînement guidé avec verbes fréquents.",
    source: "Fichier HTML",
    updated: "Hier",
    duration: 12,
  },
  {
    id: 3,
    title: "Une journée à Montréal",
    category: "Lecture",
    description: "Texte court et questions de compréhension.",
    source: "Fichier HTML",
    updated: "8 juillet",
    duration: 20,
  },
  {
    id: 4,
    title: "À la boulangerie",
    category: "Écoute",
    description: "Dialogue audio avec transcription et questions.",
    source: "Fichier HTML",
    updated: "6 juillet",
    duration: 10,
  },
  {
    id: 5,
    title: "Mon quartier idéal",
    category: "Écriture",
    description: "Production écrite remise directement à l’enseignant.",
    source: "Fichier HTML",
    updated: "5 juillet",
    duration: 30,
  },
  {
    id: 6,
    title: "Pellucide",
    category: "Application",
    description: "Application MonFrench à connecter depuis son dossier d’origine.",
    source: "Lien externe",
    updated: "À connecter",
    duration: 20,
  },
  {
    id: 7,
    title: "Glassbook",
    category: "Application",
    description: "Application MonFrench à connecter depuis son dossier d’origine.",
    source: "Lien externe",
    updated: "À connecter",
    duration: 20,
  },
];

const initialAssignments: Assignment[] = [
  {
    id: 101,
    activityId: 1,
    title: "Les accords du participe passé",
    category: "Grammaire",
    instructions: "Relisez la règle, puis complétez les dix phrases.",
    due: "Vendredi 17 juillet",
    duration: 15,
    status: "À faire",
  },
  {
    id: 102,
    activityId: 2,
    title: "Conjuguer au passé composé",
    category: "Conjugaison",
    instructions: "Terminez les deux premières séries de verbes.",
    due: "Lundi 20 juillet",
    duration: 12,
    status: "En cours",
  },
  {
    id: 103,
    activityId: 3,
    title: "Une journée à Montréal",
    category: "Lecture",
    instructions: "Lisez le texte deux fois avant de répondre.",
    due: "Mardi 21 juillet",
    duration: 20,
    status: "À faire",
  },
  {
    id: 104,
    activityId: 4,
    title: "À la boulangerie",
    category: "Écoute",
    instructions: "Écoutez le dialogue, puis répondez aux questions.",
    due: "Mercredi 22 juillet",
    duration: 10,
    status: "Terminée",
  },
  {
    id: 105,
    activityId: 5,
    title: "Mon quartier idéal",
    category: "Écriture",
    instructions: "Écrivez 150 à 180 mots. Je corrigerai votre texte.",
    due: "Jeudi 23 juillet",
    duration: 30,
    status: "À faire",
  },
];

const students = [
  { name: "Léa", work: "3 activités à faire", progress: 60 },
  { name: "Noah", work: "2 activités à faire", progress: 72 },
  { name: "Maya", work: "1 texte à corriger", progress: 84 },
];

const categoryClass = (category: Category) =>
  `category category-${category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`;

export default function Home() {
  const [view, setView] = useState<View>("welcome");
  const [teacherSection, setTeacherSection] = useState<TeacherSection>("overview");
  const [assignments, setAssignments] = useState(initialAssignments);
  const [activities, setActivities] = useState(initialActivities);
  const [filter, setFilter] = useState<"À faire" | "En cours" | "Terminées">("À faire");
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  };

  const filteredAssignments = useMemo(() => {
    if (filter === "Terminées") {
      return assignments.filter((item) => item.status === "Terminée" || item.status === "À corriger");
    }
    return assignments.filter((item) => item.status === filter);
  }, [assignments, filter]);

  const openActivity = (assignment: Assignment) => {
    setActiveAssignment(assignment);
    if (assignment.status === "À faire") {
      setAssignments((items) =>
        items.map((item) => (item.id === assignment.id ? { ...item, status: "En cours" } : item)),
      );
    }
    setView("activity");
  };

  const markComplete = (writing = false) => {
    if (!activeAssignment) return;
    const status: AssignmentStatus = writing ? "À corriger" : "Terminée";
    setAssignments((items) =>
      items.map((item) => (item.id === activeAssignment.id ? { ...item, status } : item)),
    );
    showToast(writing ? "Votre texte a été envoyé à votre enseignant." : "Activité marquée comme terminée.");
    setView("student");
  };

  return (
    <main className="site-shell">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <PreviewBar onHome={() => setView("welcome")} />

      {view === "welcome" && (
        <WelcomeScreen
          onStudent={() => setView("student")}
          onTeacher={() => {
            setTeacherSection("overview");
            setView("teacher");
          }}
        />
      )}

      {view === "student" && (
        <StudentDashboard
          assignments={filteredAssignments}
          allAssignments={assignments}
          filter={filter}
          onFilter={setFilter}
          onOpen={openActivity}
          onExit={() => setView("welcome")}
        />
      )}

      {view === "activity" && activeAssignment && (
        <ActivityPlayer
          assignment={activeAssignment}
          onBack={() => setView("student")}
          onComplete={markComplete}
        />
      )}

      {view === "teacher" && (
        <TeacherPortal
          section={teacherSection}
          onSection={setTeacherSection}
          activities={activities}
          assignments={assignments}
          onImport={() => setShowImport(true)}
          onExit={() => setView("welcome")}
          onToast={showToast}
        />
      )}

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onSave={(activity) => {
            setActivities((items) => [{ ...activity, id: Date.now() }, ...items]);
            setShowImport(false);
            showToast("Activité importée. Elle reste privée jusqu’à son assignation.");
          }}
        />
      )}

      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}

function PreviewBar({ onHome }: { onHome: () => void }) {
  return (
    <div className="preview-bar">
      <button className="brand brand-small" onClick={onHome} aria-label="Retour à l’accueil MonFrench">
        MonFrench<span>.</span>
      </button>
      <p><strong>Aperçu privé</strong><span>Les données affichées sont des exemples.</span></p>
      <button className="text-button" onClick={onHome}>Changer d’espace</button>
    </div>
  );
}

function WelcomeScreen({ onStudent, onTeacher }: { onStudent: () => void; onTeacher: () => void }) {
  return (
    <section className="welcome" id="main-content">
      <div className="welcome-copy">
        <p className="eyebrow">Le français, bien organisé</p>
        <h1>Vos activités,<br />au bon endroit.</h1>
        <p className="welcome-lead">
          MonFrench rassemble les devoirs choisis par l’enseignant dans un espace simple,
          calme et accessible sur tous les écrans.
        </p>
        <div className="promise-list" aria-label="Fonctionnalités principales">
          <span>Activités assignées uniquement</span>
          <span>Grammaire, conjugaison, lecture, écoute et écriture</span>
          <span>Correction des textes par l’enseignant</span>
        </div>
      </div>

      <div className="welcome-panel">
        <div className="panel-heading">
          <p className="eyebrow">Première version</p>
          <h2>Découvrir les deux espaces</h2>
          <p>Choisissez un aperçu. Les vrais comptes seront activés avant l’ouverture aux élèves.</p>
        </div>
        <button className="space-choice" onClick={onStudent}>
          <span className="space-index">01</span>
          <span><strong>Espace élève</strong><small>Voir seulement les activités envoyées</small></span>
          <span aria-hidden="true">→</span>
        </button>
        <button className="space-choice" onClick={onTeacher}>
          <span className="space-index">02</span>
          <span><strong>Espace enseignant</strong><small>Importer, organiser et assigner les activités</small></span>
          <span aria-hidden="true">→</span>
        </button>
        <p className="privacy-note">Aucune fonction d’intelligence artificielle n’est intégrée à MonFrench.</p>
      </div>
    </section>
  );
}

function StudentDashboard({
  assignments,
  allAssignments,
  filter,
  onFilter,
  onOpen,
  onExit,
}: {
  assignments: Assignment[];
  allAssignments: Assignment[];
  filter: "À faire" | "En cours" | "Terminées";
  onFilter: (filter: "À faire" | "En cours" | "Terminées") => void;
  onOpen: (assignment: Assignment) => void;
  onExit: () => void;
}) {
  const completed = allAssignments.filter((item) => item.status === "Terminée" || item.status === "À corriger").length;
  const filters: Array<"À faire" | "En cours" | "Terminées"> = ["À faire", "En cours", "Terminées"];

  return (
    <div className="student-page" id="main-content">
      <header className="student-header">
        <div>
          <p className="eyebrow">Espace de Léa</p>
          <h1>Bonjour, Léa</h1>
          <p>Voici les activités choisies pour vous.</p>
        </div>
        <button className="secondary-button" onClick={onExit}>Se déconnecter</button>
      </header>

      <section className="progress-card" aria-label="Progression générale">
        <div>
          <span className="progress-number">{completed}/{allAssignments.length}</span>
          <span>activités terminées</span>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${(completed / allAssignments.length) * 100}%` }} />
        </div>
        <p>Continuez à votre rythme. Votre travail reste accessible jusqu’à la date limite.</p>
      </section>

      <section className="assignment-section">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Mes devoirs</p>
            <h2>Activités assignées</h2>
          </div>
          <div className="filters" aria-label="Filtrer les activités">
            {filters.map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => onFilter(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>

        {assignments.length > 0 ? (
          <div className="assignment-grid">
            {assignments.map((assignment) => (
              <article className="assignment-card" key={assignment.id}>
                <div className="card-topline">
                  <span className={categoryClass(assignment.category)}>{assignment.category}</span>
                  <span className="status">{assignment.status}</span>
                </div>
                <h3>{assignment.title}</h3>
                <p>{assignment.instructions}</p>
                <dl className="activity-meta">
                  <div><dt>À rendre</dt><dd>{assignment.due}</dd></div>
                  <div><dt>Durée</dt><dd>{assignment.duration} min</dd></div>
                </dl>
                <button className="primary-button" onClick={() => onOpen(assignment)}>
                  {assignment.status === "En cours" ? "Continuer" : assignment.status === "À faire" ? "Commencer" : "Revoir"}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>Tout est terminé pour le moment. Bravo !</h3>
            <p>Votre prochaine activité apparaîtra ici lorsque votre enseignant la publiera.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ActivityPlayer({
  assignment,
  onBack,
  onComplete,
}: {
  assignment: Assignment;
  onBack: () => void;
  onComplete: (writing?: boolean) => void;
}) {
  const isWriting = assignment.category === "Écriture";

  return (
    <div className="player-page" id="main-content">
      <header className="player-header">
        <button className="text-button" onClick={onBack}>← Retour à mes activités</button>
        <div>
          <span className={categoryClass(assignment.category)}>{assignment.category}</span>
          <h1>{assignment.title}</h1>
        </div>
        <button className="secondary-button" onClick={() => document.documentElement.requestFullscreen?.()}>Plein écran</button>
      </header>
      <div className="instruction-box">
        <strong>Consigne de votre enseignant</strong>
        <p>{assignment.instructions}</p>
      </div>

      {isWriting ? (
        <section className="writing-workspace">
          <div className="writing-prompt">
            <p className="eyebrow">Sujet</p>
            <h2>Décrivez votre quartier idéal.</h2>
            <p>Présentez les lieux, les services et l’ambiance. Utilisez au moins cinq adjectifs et deux connecteurs logiques.</p>
          </div>
          <label htmlFor="student-writing">Votre texte</label>
          <textarea id="student-writing" rows={12} placeholder="Commencez votre texte ici…" />
          <div className="word-count">Objectif : 150 à 180 mots</div>
          <p className="teacher-correction-note"><strong>Votre enseignant corrigera ce travail.</strong> Aucune correction automatique n’est utilisée.</p>
          <button className="primary-button" onClick={() => onComplete(true)}>Envoyer à mon enseignant</button>
        </section>
      ) : (
        <section className="html-player" aria-label={`Lecteur de l’activité ${assignment.title}`}>
          <div className="player-placeholder">
            <span className={categoryClass(assignment.category)}>{assignment.category}</span>
            <h2>L’activité HTML s’ouvrira ici.</h2>
            <p>Le fichier original conservera son contenu, ses boutons, son audio et ses interactions dans un lecteur isolé.</p>
            <div className="sample-lines" aria-hidden="true"><i /><i /><i /></div>
          </div>
          <div className="player-actions">
            <button className="secondary-button" onClick={onBack}>Continuer plus tard</button>
            <button className="primary-button" onClick={() => onComplete(false)}>J’ai terminé cette activité</button>
          </div>
        </section>
      )}
    </div>
  );
}

function TeacherPortal({
  section,
  onSection,
  activities,
  assignments,
  onImport,
  onExit,
  onToast,
}: {
  section: TeacherSection;
  onSection: (section: TeacherSection) => void;
  activities: Activity[];
  assignments: Assignment[];
  onImport: () => void;
  onExit: () => void;
  onToast: (message: string) => void;
}) {
  const navItems: Array<{ id: TeacherSection; label: string }> = [
    { id: "overview", label: "Vue d’ensemble" },
    { id: "activities", label: "Activités" },
    { id: "assignments", label: "Devoirs" },
    { id: "students", label: "Élèves" },
    { id: "settings", label: "Paramètres" },
  ];

  return (
    <div className="teacher-layout" id="main-content">
      <aside className="teacher-sidebar">
        <div>
          <p className="sidebar-label">Espace enseignant</p>
          <nav aria-label="Navigation de l’espace enseignant">
            {navItems.map((item) => (
              <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => onSection(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <button className="sidebar-exit" onClick={onExit}>Se déconnecter</button>
      </aside>

      <div className="teacher-content">
        {section === "overview" && (
          <TeacherOverview activities={activities} assignments={assignments} onImport={onImport} onSection={onSection} />
        )}
        {section === "activities" && (
          <ActivityLibrary activities={activities} onImport={onImport} onToast={onToast} />
        )}
        {section === "assignments" && (
          <AssignmentsPanel assignments={assignments} onToast={onToast} />
        )}
        {section === "students" && <StudentsPanel onToast={onToast} />}
        {section === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}

function TeacherOverview({
  activities,
  assignments,
  onImport,
  onSection,
}: {
  activities: Activity[];
  assignments: Assignment[];
  onImport: () => void;
  onSection: (section: TeacherSection) => void;
}) {
  const completed = assignments.filter((item) => item.status === "Terminée" || item.status === "À corriger").length;
  return (
    <>
      <header className="teacher-page-header">
        <div><p className="eyebrow">Samedi 11 juillet</p><h1>Bonjour, Mme Martin</h1><p>Que souhaitez-vous préparer aujourd’hui ?</p></div>
        <div className="header-actions">
          <button className="secondary-button" onClick={onImport}>Importer une activité</button>
          <button className="primary-button" onClick={() => onSection("assignments")}>Créer un devoir</button>
        </div>
      </header>
      <section className="stat-grid" aria-label="Résumé de votre espace">
        <article><strong>{activities.length}</strong><span>activités importées</span></article>
        <article><strong>3</strong><span>élèves</span></article>
        <article><strong>{assignments.filter((item) => item.status !== "Terminée").length}</strong><span>devoirs en cours</span></article>
        <article><strong>{completed}</strong><span>activités terminées</span></article>
      </section>
      <div className="teacher-columns">
        <section className="teacher-panel">
          <div className="panel-title"><div><p className="eyebrow">À suivre</p><h2>Travaux récents</h2></div><button className="text-button" onClick={() => onSection("assignments")}>Tout voir</button></div>
          <div className="activity-list compact">
            <article><span className="student-avatar">M</span><div><strong>Maya a remis « Mon quartier idéal »</strong><small>Écriture · À corriger</small></div><span className="status status-alert">À corriger</span></article>
            <article><span className="student-avatar">N</span><div><strong>Noah a terminé « À la boulangerie »</strong><small>Écoute · Il y a 2 heures</small></div><span className="status">Terminée</span></article>
            <article><span className="student-avatar">L</span><div><strong>Léa a commencé le passé composé</strong><small>Conjugaison · Hier</small></div><span className="status">En cours</span></article>
          </div>
        </section>
        <section className="teacher-panel next-steps">
          <p className="eyebrow">Mise en ligne</p>
          <h2>Prochaines étapes</h2>
          <ol>
            <li className="done"><span>1</span><div><strong>Portail MonFrench</strong><small>Structure et design</small></div></li>
            <li><span>2</span><div><strong>Comptes sécurisés</strong><small>Enseignant et 3 élèves</small></div></li>
            <li><span>3</span><div><strong>Apps existantes</strong><small>Connecter les dossiers originaux</small></div></li>
          </ol>
        </section>
      </div>
    </>
  );
}

function ActivityLibrary({ activities, onImport, onToast }: { activities: Activity[]; onImport: () => void; onToast: (message: string) => void }) {
  return (
    <>
      <header className="teacher-page-header">
        <div><p className="eyebrow">Bibliothèque privée</p><h1>Activités</h1><p>Importez vos applications, puis choisissez les élèves qui les recevront.</p></div>
        <button className="primary-button" onClick={onImport}>Importer une activité</button>
      </header>
      <div className="library-toolbar">
        <label><span className="sr-only">Rechercher une activité</span><input type="search" placeholder="Rechercher une activité" /></label>
        <select aria-label="Filtrer par type"><option>Tous les types</option><option>Grammaire</option><option>Conjugaison</option><option>Lecture</option><option>Écoute</option><option>Écriture</option></select>
      </div>
      <section className="library-grid">
        {activities.map((activity) => (
          <article className="library-card" key={activity.id}>
            <div className="card-topline"><span className={categoryClass(activity.category)}>{activity.category}</span><span className="source-label">{activity.source}</span></div>
            <h2>{activity.title}</h2>
            <p>{activity.description}</p>
            <div className="library-footer"><span>Mis à jour : {activity.updated}</span><span>{activity.duration} min</span></div>
            <div className="library-actions">
              <button className="secondary-button" onClick={() => onToast(`Aperçu de « ${activity.title} » prêt à ouvrir.`)}>Aperçu</button>
              <button className="primary-button" onClick={() => onToast(`« ${activity.title} » est prête à être assignée.`)}>Assigner</button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function AssignmentsPanel({ assignments, onToast }: { assignments: Assignment[]; onToast: (message: string) => void }) {
  return (
    <>
      <header className="teacher-page-header">
        <div><p className="eyebrow">Distribution</p><h1>Devoirs</h1><p>Suivez ce que vous avez envoyé et ce qui doit être corrigé.</p></div>
        <button className="primary-button" onClick={() => onToast("Choisissez d’abord une activité dans la bibliothèque.")}>Créer un devoir</button>
      </header>
      <section className="teacher-panel assignment-table">
        <div className="table-row table-head"><span>Activité</span><span>Type</span><span>Échéance</span><span>État</span><span /></div>
        {assignments.map((assignment) => (
          <article className="table-row" key={assignment.id}>
            <strong>{assignment.title}</strong><span>{assignment.category}</span><span>{assignment.due}</span><span className="status">{assignment.status}</span><button className="text-button" onClick={() => onToast(`Ouverture du devoir « ${assignment.title} »`)}>Ouvrir</button>
          </article>
        ))}
      </section>
    </>
  );
}

function StudentsPanel({ onToast }: { onToast: (message: string) => void }) {
  return (
    <>
      <header className="teacher-page-header">
        <div><p className="eyebrow">Votre petit groupe</p><h1>Élèves</h1><p>Chaque élève ne verra que les activités que vous lui envoyez.</p></div>
        <button className="primary-button" onClick={() => onToast("La création de compte sera activée avec l’authentification sécurisée.")}>Ajouter un élève</button>
      </header>
      <section className="student-admin-grid">
        {students.map((student) => (
          <article key={student.name}>
            <div className="student-card-header"><span className="student-avatar large">{student.name.charAt(0)}</span><div><h2>{student.name}</h2><p>{student.work}</p></div></div>
            <div className="mini-progress"><span style={{ width: `${student.progress}%` }} /></div>
            <div className="student-card-actions"><button className="secondary-button" onClick={() => onToast(`Profil de ${student.name}`)}>Voir le profil</button><button className="text-button" onClick={() => onToast(`Lien d’accès de ${student.name} prêt à être régénéré.`)}>Accès</button></div>
          </article>
        ))}
      </section>
    </>
  );
}

function SettingsPanel() {
  return (
    <>
      <header className="teacher-page-header"><div><p className="eyebrow">Configuration</p><h1>Paramètres</h1><p>Les réglages essentiels de votre portail.</p></div></header>
      <div className="settings-grid">
        <section className="teacher-panel"><h2>Domaine</h2><p>Le portail sera relié à votre domaine Cloudflare.</p><div className="setting-value"><span>monfrench.com</span><strong>À connecter</strong></div></section>
        <section className="teacher-panel"><h2>Accès des élèves</h2><p>Les vrais comptes seront activés avant toute ouverture publique.</p><div className="setting-value"><span>3 élèves prévus</span><strong>Configuration requise</strong></div></section>
        <section className="teacher-panel"><h2>Fonctions exclues</h2><p>MonFrench ne contient aucune fonction ChatGPT ou IA.</p><div className="setting-value"><span>IA et API</span><strong>Désactivées</strong></div></section>
      </div>
    </>
  );
}

function ImportDialog({ onClose, onSave }: { onClose: () => void; onSave: (activity: Omit<Activity, "id">) => void }) {
  const [source, setSource] = useState<"Fichier HTML" | "Lien externe">("Fichier HTML");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") || "Nouvelle activité");
    const category = String(data.get("category") || "Grammaire") as Category;
    onSave({ title, category, description: String(data.get("description") || "Activité importée dans MonFrench."), source, updated: "À l’instant", duration: Number(data.get("duration") || 15) });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="dialog-header"><div><p className="eyebrow">Bibliothèque privée</p><h2 id="import-title">Importer une activité</h2></div><button className="close-button" onClick={onClose} aria-label="Fermer">×</button></div>
        <form onSubmit={submit}>
          <fieldset className="source-options"><legend>Source de l’activité</legend><label><input type="radio" name="source" checked={source === "Fichier HTML"} onChange={() => setSource("Fichier HTML")} /><span><strong>Fichier HTML</strong><small>Une activité autonome ou un dossier préparé</small></span></label><label><input type="radio" name="source" checked={source === "Lien externe"} onChange={() => setSource("Lien externe")} /><span><strong>Lien vers une application</strong><small>Une application déjà publiée ailleurs</small></span></label></fieldset>
          <div className="form-grid">
            <label>Nom de l’activité<input name="title" required placeholder="Ex. Les adjectifs qualificatifs" /></label>
            <label>Type<select name="category"><option>Grammaire</option><option>Conjugaison</option><option>Lecture</option><option>Écoute</option><option>Écriture</option><option>Application</option></select></label>
            <label className="full-width">Description courte<textarea name="description" rows={3} placeholder="Ce que l’élève fera dans cette activité" /></label>
            <label>Durée estimée<input name="duration" type="number" min="1" max="180" defaultValue="15" /></label>
            <label>{source === "Fichier HTML" ? "Choisir le fichier" : "Adresse de l’application"}{source === "Fichier HTML" ? <input type="file" accept=".html,.htm,.zip" /> : <input type="url" placeholder="https://…" />}</label>
          </div>
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Annuler</button><button className="primary-button" type="submit">Enregistrer dans la bibliothèque</button></div>
        </form>
      </section>
    </div>
  );
}
