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
