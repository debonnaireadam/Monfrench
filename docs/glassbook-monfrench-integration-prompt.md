# Prompt — préparer Glassbook pour MonFrench

Work only in the Glassbook project at `C:\Users\ichem\OneDrive\Desktop\GLASSBOOK CLaude`. Do not edit the MonFrench website in this task.

The goal is to make Glassbook integrate cleanly with MonFrench later while preserving its current offline behavior and design. The teacher version must still export a completely standalone student HTML file. That student file must still work when opened directly with `file://`, including audio, writing, annotations, local saving and PDF generation. Do not add AI, authentication, Cloudflare code, API keys, cookies, analytics or a required network connection.

## Non-negotiable compatibility

- Preserve the current Glassbook UI and all current teacher and student features.
- Preserve direct offline use and the existing localStorage fallback.
- Preserve the current student export format and embedded resources.
- Preserve existing functions and behavior around `buildSaveState`, `saveNow`, `readSavedState`, `restoreFromSave` and `buildStudentPdf`; refactor behind compatible wrappers only where necessary.
- Preserve the existing MonFrench teacher export bridge if one already exists. Extend it without changing its current message names or responses.
- Do not silently send student data anywhere. In embedded mode, communicate only through the `MessagePort` explicitly transferred by the parent.

## 1. Teacher-export bridge

Keep the normal Download/Export button working exactly as it does now. In addition, when the teacher app is embedded by MonFrench, expose an optional `MessageChannel` bridge that lets the parent receive the generated standalone student HTML without downloading it first.

Handshake received from the parent window:

```js
{
  type: "monfrench:teacher-connect",
  protocolVersion: 1,
  app: "glassbook",
  nonce: "one-time-random-value"
}
```

Accept the handshake only once, only when a `MessagePort` is transferred, and only when `event.source === window.parent`. Do not depend only on `event.origin`, because a deliberately sandboxed iframe can have an opaque origin. Reply on the transferred port:

```js
{
  type: "ready",
  protocolVersion: 1,
  app: "glassbook",
  mode: "teacher",
  capabilities: ["student-html-export-v1"]
}
```

Support this port request:

```js
{
  type: "export-student-html",
  requestId: "uuid",
  options: {}
}
```

Return either:

```js
{
  type: "export-result",
  requestId: "uuid",
  ok: true,
  app: "glassbook",
  format: "html",
  fileName: "safe-name.html",
  title: "Activity title",
  mimeType: "text/html;charset=utf-8",
  byteLength: 12345,
  html: "<!doctype html>...",
  metadata: {
    schema: "glassbook.student-export",
    schemaVersion: 1,
    documentId: "stable-document-id"
  }
}
```

or a structured error with `ok:false`, `requestId`, `errorCode` and a human-readable `message`. Refactor the current export flow so both the normal Download button and the bridge call the same canonical export builder. Do not duplicate export logic.

## 2. Student-runtime bridge

The exported student HTML must remain a normal standalone offline file. Add an optional bridge that becomes active only after this handshake from its parent:

```js
{
  type: "monfrench:activity-connect",
  protocolVersion: 1,
  app: "glassbook",
  mode: "student",
  nonce: "one-time-random-value"
}
```

Again, require a transferred `MessagePort`, `event.source === window.parent`, and accept only one live connection. Reply:

```js
{
  type: "ready",
  protocolVersion: 1,
  app: "glassbook",
  mode: "student",
  capabilities: ["state-v1", "submission-pdf-v1"]
}
```

Support requests with a `requestId`:

- `get-state`: return the complete current editable state.
- `load-state`: validate and restore a supplied state envelope; never partially apply an invalid state.
- `build-submission-pdf`: build the same final PDF the standalone student workflow produces, but return it through the port instead of forcing a browser download.

Use this serializable state envelope:

```js
{
  schema: "glassbook.student-state",
  schemaVersion: 1,
  app: "glassbook",
  documentId: "stable-document-id",
  savedAt: "ISO-8601 timestamp",
  revision: 12,
  state: { /* all answers, text, annotations and required UI state */ }
}
```

Reject a state when its schema, version or `documentId` does not match the open activity. Keep the existing offline save format readable, and provide an explicit migration function if the old localStorage shape differs.

For `build-submission-pdf`, use the existing PDF builder and return the PDF as a transferable `ArrayBuffer` where possible:

```js
{
  type: "submission-pdf-result",
  requestId: "uuid",
  ok: true,
  fileName: "safe-name.pdf",
  mimeType: "application/pdf",
  byteLength: 12345,
  buffer: arrayBuffer
}
```

The standalone button must still call `doc.save(...)`. The embedded bridge path should use `doc.output("arraybuffer")` or a Blob converted to an ArrayBuffer and must not trigger a duplicate download.

## 3. Change notifications and saving

Emit a throttled port event after meaningful student changes:

```js
{
  type: "state-changed",
  revision: 13,
  changedAt: "ISO-8601 timestamp"
}
```

Do not send the entire state on every keystroke. Throttle notifications to at most one every 750 ms; MonFrench will decide when to autosave, normally every 10–15 seconds, and will also expose a manual Save button. Ensure annotation IDs remain unique after restoring saved work by reseeding the ID counter from restored annotations.

## 4. Security and resilience

- No credentials, session tokens, API endpoints or Cloudflare logic inside the exported HTML.
- No `postMessage("*", state)` containing student work. Use only the accepted transferred port after the one-time handshake.
- Validate all message shapes, protocol versions, request IDs, document IDs and maximum payload sizes.
- A bridge failure must not break offline Glassbook; local save and normal PDF download remain available.
- Clean up listeners and close an old port before accepting any deliberate reconnect flow.

## 5. Build and tests

- Make changes in the real source files, then rebuild the distributable teacher and student files. Do not patch only `dist/glassbook2_teacher.html`.
- Add automated tests for standalone offline export, teacher bridge export, state round-trip, wrong-document rejection, PDF bridge output, change throttling, annotation-ID reseeding and no-network operation.
- Test that an exported student file opened directly from disk can save, reload and generate its PDF without MonFrench.
- Report every modified source file, the build command, the generated files and the test results.

Do not redesign anything. If an architectural conflict is discovered, stop and explain it before making a breaking change.
