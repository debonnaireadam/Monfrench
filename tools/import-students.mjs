#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { planStudentImport } from "../lib/chateau-rules.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const inputPath = args.find((arg) => !arg.startsWith("--"));
const endpointOption = option("endpoint") ?? process.env.MONFRENCH_STAGING_URL;
const rollbackRunId = option("rollback");
const shouldApply = args.includes("--apply");
const reportPath = resolve(option("report") ?? "student-import-report.json");

function usage() {
  console.error([
    "Usage:",
    "  pnpm migration:students <students.csv|students.json> [--endpoint=https://staging.example] [--apply] [--report=path]",
    "  pnpm migration:students --rollback=<run_id> --endpoint=https://staging.example [--report=path]",
    "",
    "Remote operations require MONFRENCH_SESSION_COOKIE and MONFRENCH_CSRF_TOKEN.",
    "This tool refuses the monfrench.com production host.",
  ].join("\n"));
}

function stagingEndpoint(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("The staging endpoint must use HTTP or HTTPS.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "monfrench.com" || hostname === "www.monfrench.com") {
    throw new Error("Production migration is intentionally blocked by this staging tool.");
  }
  url.pathname = "/api/portal";
  url.search = "";
  url.hash = "";
  return url;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function readRows(file) {
  const text = await readFile(resolve(file), "utf8");
  const rows = extname(file).toLowerCase() === ".json" ? JSON.parse(text) : parseCsv(text);
  if (!Array.isArray(rows)) throw new Error("The import root must be an array.");
  return rows;
}

async function remoteAction(endpoint, action, body = {}) {
  const session = process.env.MONFRENCH_SESSION_COOKIE;
  const csrf = process.env.MONFRENCH_CSRF_TOKEN;
  if (!session || !csrf) throw new Error("Remote operations require MONFRENCH_SESSION_COOKIE and MONFRENCH_CSRF_TOKEN.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      cookie: `monfrench_session=${encodeURIComponent(session)}; monfrench_csrf=${encodeURIComponent(csrf)}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

async function saveReport(report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report.summary, mode: report.mode, run_id: report.run_id, report: reportPath }, null, 2));
}

try {
  const endpoint = stagingEndpoint(endpointOption);
  if (rollbackRunId) {
    if (!endpoint) throw new Error("Rollback requires --endpoint or MONFRENCH_STAGING_URL.");
    const result = await remoteAction(endpoint, "migration_rollback", { run_id: rollbackRunId });
    await saveReport({ mode: "rollback", run_id: rollbackRunId, created_at: new Date().toISOString(), summary: { removed: result.removed ?? 0 }, result });
    process.exit(0);
  }
  if (!inputPath) { usage(); process.exit(2); }

  const rows = await readRows(inputPath);
  if (!endpoint) {
    if (shouldApply) throw new Error("--apply requires --endpoint or MONFRENCH_STAGING_URL.");
    const plan = planStudentImport(rows);
    await saveReport({ mode: "local-dry-run", created_at: new Date().toISOString(), source: resolve(inputPath), summary: { total: plan.total, valid: plan.valid, failed: plan.failed }, rows: plan.rows });
    if (plan.failed) process.exitCode = 1;
  } else {
    const action = shouldApply ? "migration_import" : "migration_dry_run";
    const result = await remoteAction(endpoint, action, { source_name: inputPath, rows });
    await saveReport({ mode: shouldApply ? "staging-import" : "staging-dry-run", created_at: new Date().toISOString(), source: resolve(inputPath), run_id: result.run_id, idempotent: result.idempotent ?? false, summary: result.summary, rows: result.rows });
    if (result.summary?.failed) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(3);
}
