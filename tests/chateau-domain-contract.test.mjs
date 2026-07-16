import test from "node:test";
import assert from "node:assert/strict";
import {
  BRIDGE_TYPES,
  REVIEW_MODES,
  ROLES,
  WORK_STATES,
  can,
  planStudentImport,
  publicationStatus,
  transitionWork,
  validateBridgeMessage,
  validateStudentRow,
} from "../lib/chateau-rules.mjs";

const permissions = ["accounts.manage", "upload", "publish", "review.publication", "assign", "correct", "work", "submit"];

test("the domain exposes exactly the three approved roles", () => {
  assert.deepEqual([...ROLES].sort(), ["principal", "student", "teacher"]);
});

test("role permissions are deny-by-default and do not leak across roles", () => {
  const expected = {
    principal: new Set(["accounts.manage", "upload", "publish", "review.publication", "assign", "correct"]),
    teacher: new Set(["assign", "correct"]),
    student: new Set(["work", "submit"]),
  };

  for (const role of ROLES) {
    for (const permission of permissions) {
      assert.equal(can(role, permission), expected[role].has(permission), `${role} / ${permission}`);
    }
  }
  assert.equal(can("anonymous", "work"), false);
  assert.equal(can("teacher", "unknown.permission"), false);
});

test("publication modes map to forbidden, review, and direct-publish outcomes", () => {
  assert.deepEqual([...REVIEW_MODES].sort(), ["direct", "none", "required"]);
  assert.equal(publicationStatus("none"), "forbidden");
  assert.equal(publicationStatus("required"), "pending_review");
  assert.equal(publicationStatus("direct"), "published");
  assert.throws(() => publicationStatus("sometimes"), /invalid_review_mode/);
});

test("assignment work states implement the complete approved transition table", () => {
  assert.deepEqual([...WORK_STATES].sort(), ["assigned", "corrected", "draft", "redo", "submitted"]);
  const events = ["save", "submit", "correct", "redo"];
  const expected = {
    assigned: { save: "draft", submit: "submitted", correct: null, redo: null },
    draft: { save: "draft", submit: "submitted", correct: null, redo: null },
    submitted: { save: null, submit: null, correct: "corrected", redo: "redo" },
    corrected: { save: null, submit: null, correct: null, redo: null },
    redo: { save: "draft", submit: "submitted", correct: null, redo: null },
  };

  for (const state of WORK_STATES) {
    for (const event of events) {
      assert.equal(transitionWork(state, event), expected[state][event], `${state} + ${event}`);
    }
  }
  assert.equal(transitionWork("missing", "save"), null);
  assert.equal(transitionWork("draft", "missing"), null);
});

test("submitted and corrected work remain locked while returned work can be edited and resubmitted", () => {
  assert.equal(transitionWork("submitted", "save"), null);
  assert.equal(transitionWork("submitted", "submit"), null);
  assert.equal(transitionWork("corrected", "save"), null);
  assert.equal(transitionWork("corrected", "submit"), null);
  assert.equal(transitionWork("submitted", "redo"), "redo");
  assert.equal(transitionWork("redo", "save"), "draft");
  assert.equal(transitionWork("redo", "submit"), "submitted");
});

test("the bridge accepts every specified message type and rejects all other types", () => {
  const expectedTypes = [
    "monfrench-ready",
    "monfrench-load-state",
    "monfrench-save",
    "monfrench-submit",
    "monfrench-resize",
    "monfrench-progress",
    "monfrench-download-request",
  ];
  assert.deepEqual([...BRIDGE_TYPES].sort(), expectedTypes.sort());
  for (const type of expectedTypes) {
    const value = type === "monfrench-resize"
      ? { type, height: 800 }
      : type === "monfrench-progress"
        ? { type, progress: 50 }
        : { type };
    assert.equal(validateBridgeMessage(value).ok, true, type);
  }
  for (const value of [null, undefined, false, "monfrench-save", 1, {}, { type: "unknown" }]) {
    assert.equal(validateBridgeMessage(value).ok, false);
  }
});

test("bridge dimensions, progress, and serialized payload size are bounded", () => {
  assert.equal(validateBridgeMessage({ type: "monfrench-resize", height: 200 }).ok, true);
  assert.equal(validateBridgeMessage({ type: "monfrench-resize", height: 5000 }).ok, true);
  for (const height of [199, 5001, Number.NaN, Number.POSITIVE_INFINITY, "800"]) {
    assert.equal(validateBridgeMessage({ type: "monfrench-resize", height }).ok, false, `height ${height}`);
  }
  assert.equal(validateBridgeMessage({ type: "monfrench-progress", progress: 0 }).ok, true);
  assert.equal(validateBridgeMessage({ type: "monfrench-progress", progress: 100 }).ok, true);
  for (const progress of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY, "50"]) {
    assert.equal(validateBridgeMessage({ type: "monfrench-progress", progress }).ok, false, `progress ${progress}`);
  }
  assert.deepEqual(validateBridgeMessage({ type: "monfrench-save", payload: "x".repeat(1_000_001) }), { ok: false, error: "payload_too_large" });
});

test("bridge validation safely rejects cyclic structured-clone payloads", () => {
  const cyclic = { type: "monfrench-save" };
  cyclic.self = cyclic;
  let result;
  assert.doesNotThrow(() => { result = validateBridgeMessage(cyclic); });
  assert.equal(result?.ok, false);
});

test("student row validation normalizes identifiers and emits only approved account fields", () => {
  const source = {
    legacy_id: " legacy-17 ",
    identifier: " ＡＭＩＮＡ ",
    display_name: " Amina Tremblay ",
    active: "oui",
    teacher_identifier: " CLAIRE ",
    group: " Groupe A ",
    password_hash: "compatible-hash",
    assignment_history: [{ id: "must-not-migrate" }],
    progress: 99,
    messages: ["must-not-migrate"],
  };
  const result = validateStudentRow(source, 7);
  assert.equal(result.valid, true);
  assert.equal(result.index, 7);
  assert.deepEqual(result.value, {
    legacy_id: "legacy-17",
    identifier: "amina",
    display_name: "Amina Tremblay",
    active: true,
    teacher_identifier: "claire",
    group: "Groupe A",
    must_change_password: false,
  });
  assert.equal("assignment_history" in result.value, false);
  assert.equal("progress" in result.value, false);
  assert.equal("messages" in result.value, false);
});

test("student row validation reports every required-field problem", () => {
  const result = validateStudentRow({ legacy_id: "", identifier: "x", display_name: "", active: false }, 3);
  assert.equal(result.valid, false);
  assert.equal(result.index, 3);
  assert.deepEqual(result.errors.sort(), ["display_name_invalid", "identifier_invalid", "legacy_id_required"]);
  assert.equal(result.value.active, false);
  assert.equal(result.value.must_change_password, true);
});

test("student import detects normalized identifier and legacy-id collisions", () => {
  const rows = [
    { legacy_id: "1", identifier: " Amina ", display_name: "Amina", active: true },
    { legacy_id: "2", identifier: "AMINA", display_name: "Amina bis", active: true },
    { legacy_id: "1", identifier: "carlos", display_name: "Carlos", active: true },
    { legacy_id: "4", identifier: "existing", display_name: "Existing", active: false },
  ];
  const plan = planStudentImport(rows, [" EXISTING "]);
  assert.equal(plan.total, 4);
  assert.equal(plan.valid, 1);
  assert.equal(plan.failed, 3);
  assert.ok(plan.results[1].errors.includes("identifier_collision"));
  assert.ok(plan.results[2].errors.includes("duplicate_legacy_id"));
  assert.ok(plan.results[3].errors.includes("identifier_collision"));
});

test("student import planning is deterministic, immutable, and fingerprinted for idempotent batches", () => {
  const rows = [{ legacy_id: "1", identifier: "amina", display_name: "Amina", active: "yes" }];
  const snapshot = structuredClone(rows);
  const first = planStudentImport(rows);
  const second = planStudentImport(structuredClone(rows));
  const changed = planStudentImport([{ ...rows[0], display_name: "Amina T." }]);
  assert.deepEqual(rows, snapshot);
  assert.deepEqual(first, second);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(first.fingerprint, changed.fingerprint);
});
