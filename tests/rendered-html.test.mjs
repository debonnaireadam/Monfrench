import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

test("build contains the portal and protected API routes", async () => {
  await stat("dist/server/index.js");
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /Créer un devoir/);
  assert.match(page, /Corrections/);
});

test("public login and student workspace expose only essential information", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  const layout = await readFile("app/layout.tsx", "utf8");
  const robots = await readFile("public/robots.txt", "utf8");
  assert.match(page, /className="login-page"/);
  assert.match(page, />Identifiant</);
  assert.match(page, />Mot de passe</);
  assert.doesNotMatch(page, /Grammaire, conjugaison et lecture/);
  assert.doesNotMatch(page, /Aucune intelligence artificielle côté élève/);
  assert.doesNotMatch(page, /setupRequired/);
  assert.match(page, /<h1>Mes activités<\/h1>/);
  assert.match(page, /a\.category==="Écriture"/);
  assert.match(layout, /index: false/);
  assert.match(robots, /Disallow: \//);
});

test("authentication uses keyed password hashes, server sessions and CSRF", async () => {
  const route = await readFile("app/api/portal/route.ts", "utf8");
  assert.match(route, /PASSWORD_PEPPER/);
  assert.match(route, /HMAC/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(route, /s\.created_at>\?/);
  assert.match(route, /Date\.now\(\)\+12\*60\*60_000/);
  assert.doesNotMatch(route, /Max-Age=604800/);
  assert.match(route, /x-csrf-token/);
  assert.match(route, /siteverify/);
  assert.match(route, /user: safeUser/);
  assert.match(route, /END has_file/);
});

test("private files require ownership or assignment access", async () => {
  const route = await readFile("app/api/file/route.ts", "utf8");
  assert.match(route, /assignment_students/);
  assert.match(route, /student_id=\?/);
  assert.match(route, /slice\("monfrench_session="\.length\)/);
  assert.match(route, /Cache-Control":"private, no-store/);
  assert.match(route, /u\.active=1/);
  assert.match(route, /Content-Security-Policy/);
  assert.match(route, /sandbox allow-scripts/);
});

test("large activity files use authenticated staged R2 uploads", async () => {
  const route = await readFile("app/api/portal/route.ts", "utf8");
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(route, /stagedUploadPrefix/);
  assert.match(route, /stagedPartKey/);
  assert.match(route, /request\.arrayBuffer\(\)/);
  assert.match(route, /new FixedLengthStream\(fileSize\)/);
  assert.match(route, /env\.FILES\.put\(key,fixed\.readable/);
  assert.match(route, /SELECT r2_key,created_by FROM activities WHERE id=/);
  assert.match(page, /chunkSize=512\*1024/);
  assert.match(page, /Content-Type":"application\/octet-stream/);
});

test("Glassbook student exports can be saved into the activity library", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  const route = await readFile("app/api/teacher-apps/glassbook/route.ts", "utf8");
  const glassbookSource = await readFile("app/private-apps/glassbook2_teacher.html", "utf8");
  const glassbook = await stat("app/private-apps/glassbook2_teacher.html");
  assert.equal(glassbook.size, 2_474_443);
  assert.equal(createHash("sha256").update(glassbookSource).digest("hex"), "19169281939d544c63ec067a8b272e813812fdf6d0a894fdd5d2d08ed98c947e");
  assert.match(page, /apps:\"Applications\"/);
  assert.match(page, /\/api\/teacher-apps\/glassbook/);
  assert.match(page, /sandbox=\"allow-scripts allow-popups allow-downloads allow-forms allow-modals\"/);
  assert.match(page, /monfrench:glassbook-build/);
  assert.match(page, /uploadActivityFile\(portal/);
  assert.match(page, /Créer et enregistrer la version élève/);
  assert.match(route, /user\.role !== \"teacher\"/);
  assert.match(route, /Content-Security-Policy/);
  assert.match(route, /Cache-Control\": \"private, no-store/);
  assert.match(glassbookSource, /monfrench:glassbook-connect/);
  assert.match(glassbookSource, /monfrench:glassbook-export/);
});
