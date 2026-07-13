import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

test("build contains the portal and protected API routes", async () => {
  await stat("dist/server/index.js");
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /Aucune intelligence artificielle côté élève/);
  assert.match(page, /Créer un devoir/);
  assert.match(page, /Corrections/);
});

test("authentication uses keyed password hashes, server sessions and CSRF", async () => {
  const route = await readFile("app/api/portal/route.ts", "utf8");
  assert.match(route, /PASSWORD_PEPPER/);
  assert.match(route, /HMAC/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(route, /x-csrf-token/);
  assert.match(route, /siteverify/);
});

test("private files require ownership or assignment access", async () => {
  const route = await readFile("app/api/file/route.ts", "utf8");
  assert.match(route, /assignment_students/);
  assert.match(route, /student_id=\?/);
  assert.match(route, /slice\("monfrench_session="\.length\)/);
  assert.match(route, /Cache-Control":"private, no-store/);
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
  assert.ok(glassbook.size > 2_000_000);
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
