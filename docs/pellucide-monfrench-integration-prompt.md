# Prompt — préparer Pellucide pour MonFrench

Work only in the Pellucide project at `C:\Users\ichem\OneDrive\Desktop\New folder\pellucide`. Do not edit the MonFrench website in this task.

The goal is to prepare Pellucide for an optional future MonFrench embedded workflow while keeping its current offline HTML workflow first-class. The teacher must still be able to export a standalone student HTML file, and that file must still work directly with `file://`. Students must retain the current audio, answers, annotations, P2 export/ledger and local saving behavior. Do not add AI, authentication, Cloudflare code, API keys, cookies, analytics or a required network request.

Start by locating the canonical source and build flow, especially `teacher/app.js`, `student/app.js`, `engine/state.js` and the generated `dist` files. Modify the sources and rebuild; never patch only a generated HTML file.

## Non-negotiable compatibility

- Preserve the current Pellucide design and all existing teacher/student features.
- Preserve standalone offline export, localStorage and the existing P2 format and verification behavior.
- Preserve existing export/download buttons.
- The same exported student HTML must support both direct offline use and optional embedded use.
- No student data may leave the file unless an authenticated parent application establishes the optional transferred-port bridge.

## 1. Canonical teacher export

Refactor the current student-export implementation into one canonical builder that returns:

```js
{
  html: "<!doctype html>...",
  blob: htmlBlob,
  fileName: "safe-name.html",
  title: "Activity title",
  metadata: {
    schema: "pellucide.student-export",
    schemaVersion: 1,
    exportId: "stable-export-id",
    bankHash: "content-integrity-hash",
    unitIds: ["unit-1"]
  }
}
```

Both the normal Download button and the optional MonFrench bridge must call this same builder.

Add an optional teacher `MessageChannel` handshake:

```js
{
  type: "monfrench:teacher-connect",
  protocolVersion: 1,
  app: "pellucide",
  nonce: "one-time-random-value"
}
```

Accept only one transferred `MessagePort` and only when `event.source === window.parent`. Reply with capabilities including `student-html-export-v1`. Handle an `export-student-html` request with a `requestId`, and return the standalone HTML string, safe filename, byte length, MIME type and metadata. Return structured errors instead of throwing across the port.

## 2. Complete student state import/export

Create canonical functions in the state layer for exporting, validating and restoring all editable student state. The envelope must be JSON-serializable:

```js
{
  schema: "pellucide.student-state",
  schemaVersion: 1,
  app: "pellucide",
  exportId: "stable-export-id",
  bankHash: "content-integrity-hash",
  unitIds: ["unit-1"],
  savedAt: "ISO-8601 timestamp",
  revision: 17,
  state: {
    answers: {},
    writings: {},
    annotations: [],
    audioState: {},
    progress: {},
    p2Ledger: {},
    ui: {}
  }
}
```

The exact internal fields may follow Pellucide’s real model, but the envelope must include everything required to resume without losing work. Reject mismatched schema versions, `exportId`, `bankHash` or unit set before changing live state. Keep old localStorage data readable through explicit migrations. Restoring a state must not corrupt the P2 ledger or create duplicate annotation IDs.

## 3. Optional student bridge

The standalone student file should listen for this optional parent handshake:

```js
{
  type: "monfrench:activity-connect",
  protocolVersion: 1,
  app: "pellucide",
  mode: "student",
  nonce: "one-time-random-value"
}
```

Require a transferred `MessagePort`, `event.source === window.parent`, and accept only one live connection. Reply:

```js
{
  type: "ready",
  protocolVersion: 1,
  app: "pellucide",
  mode: "student",
  capabilities: ["state-v1", "structured-submission-v1", "submission-pdf-v1", "p2-v2"]
}
```

Support these port requests, each with a `requestId`:

- `get-state`
- `load-state`
- `build-structured-submission`
- `build-p2`
- `build-submission-pdf`

Emit a throttled `state-changed` event containing only revision and timestamp after meaningful edits. Do not send full state on every keystroke. MonFrench will request the state for autosave every 10–15 seconds and for a manual Save button.

## 4. One canonical structured submission

Build the structured submission from Pellucide’s real canonical state, not from scraped DOM text. Suggested envelope:

```js
{
  schema: "pellucide.submission",
  schemaVersion: 1,
  app: "pellucide",
  exportId: "stable-export-id",
  bankHash: "content-integrity-hash",
  generatedAt: "ISO-8601 timestamp",
  studentWork: {
    answers: [],
    writings: [],
    annotations: [],
    progress: {},
    audioInteractions: []
  },
  p2: {
    version: 2,
    ledger: {},
    integrity: {}
  }
}
```

Use one builder for the current P2 download and the bridge response so the two cannot drift. Preserve current P2 compatibility; if a v2 envelope is added, include an explicit converter or backward-compatible wrapper and tests against existing sample files.

## 5. Offline final PDF

Add or complete an entirely offline student-facing PDF report generator. It must summarize the activity identity and the student’s completed answers, writing and annotations in a readable teacher-facing layout. Do not rely on printing the live page or on a remote service. Embed every required PDF library/resource inside the standalone export.

- The standalone student button downloads the PDF normally.
- The embedded bridge returns the exact same PDF as a transferable `ArrayBuffer` with filename, MIME type and byte length, without triggering a second download.
- If PDF generation cannot safely represent a particular annotation, include a deterministic textual fallback rather than silently dropping it.

## 6. Security and failure behavior

- No credentials, session tokens, API endpoints or Cloudflare logic in Pellucide.
- Never broadcast student state through unrestricted window messaging. Use only the accepted transferred port.
- Validate message schemas, protocol versions, request IDs and payload sizes.
- A bridge failure must leave offline saving, P2 export and PDF download functional.
- Because the embedded iframe may be sandboxed to an opaque origin, verify the parent window object plus the transferred one-time port instead of trusting origin alone.

## 7. Build and acceptance tests

- Rebuild every affected `dist` artifact from source.
- Add automated tests for teacher HTML export, standalone `file://` behavior, state save/restore, wrong-export rejection, P2 backward compatibility, structured submission, PDF generation, bridge request correlation, throttled change events and no-network operation.
- Test a large realistic activity and report generated HTML/PDF sizes and timings.
- Report all modified source files, the build command, generated files and complete test results.

Do not redesign Pellucide. If the existing P2 or PDF architecture makes a requirement unsafe, stop and explain the conflict before making a breaking change.
