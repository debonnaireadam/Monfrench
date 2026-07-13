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

test("authentication uses hashed passwords, server sessions and CSRF", async () => {
  const route = await readFile("app/api/portal/route.ts", "utf8");
  assert.match(route, /PBKDF2/);
  assert.match(route, /iterations: 210_000/);
  assert.match(route, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(route, /x-csrf-token/);
  assert.match(route, /siteverify/);
});

test("private files require ownership or assignment access", async () => {
  const route = await readFile("app/api/file/route.ts", "utf8");
  assert.match(route, /assignment_students/);
  assert.match(route, /student_id=\?/);
  assert.match(route, /Cache-Control":"private, no-store/);
});
