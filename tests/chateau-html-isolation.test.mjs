import test from "node:test";
import assert from "node:assert/strict";
import { collectTextFiles, combinedSource } from "./helpers/source-tree.mjs";

const apiSource = combinedSource(collectTextFiles(["app/api"], { extensions: [".js", ".mjs", ".ts", ".tsx"] }));
const viewerSource = combinedSource(
  collectTextFiles(["app"], { extensions: [".jsx", ".tsx"] })
    .filter(({ path }) => !path.startsWith("app/api/")),
);

test("served HTML activities receive a restrictive CSP sandbox", () => {
  for (const directive of [
    "default-src 'none'",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts",
  ]) {
    assert.match(apiSource, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing CSP directive: ${directive}`);
  }
  assert.doesNotMatch(apiSource, /allow-same-origin/i);
  assert.doesNotMatch(apiSource, /allow-top-navigation/i);
  assert.match(apiSource, /X-Content-Type-Options["']?\s*:\s*["']nosniff["']/i);
  assert.match(apiSource, /Cache-Control["']?\s*:\s*["']private, no-store["']/i);
});

test("every product activity iframe is sandboxed without same-origin or top-navigation capability", () => {
  const iframeTags = [...viewerSource.matchAll(/<iframe\b[\s\S]{0,1200}?>/gi)].map((match) => match[0]);
  assert.ok(iframeTags.length > 0, "the Activity Viewer must render standalone HTML in an iframe");
  for (const tag of iframeTags) {
    assert.match(tag, /\bsandbox\s*=/i);
    assert.doesNotMatch(tag, /allow-same-origin/i);
    assert.doesNotMatch(tag, /allow-top-navigation/i);
  }
  assert.match(viewerSource, /allow-scripts/i);
});

test("the postMessage bridge verifies iframe source and origin before accepting payloads", () => {
  assert.match(viewerSource, /event\.source|\.source\s*[!=]==?/);
  assert.match(viewerSource, /event\.origin|\.origin\s*[!=]==?/);
  assert.match(viewerSource, /addEventListener\(\s*["']message["']/);
  assert.match(viewerSource, /removeEventListener\(\s*["']message["']/);
});
