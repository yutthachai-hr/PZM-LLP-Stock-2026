# E4 — Client error reporting (owner approved 6 Oct 2026, **not stored in Firestore**): evidence

## Path

1. **Browser** (`src/services/errorReporter.ts`). It hears:
   - uncaught errors and unhandled promise rejections;
   - a page that fails to draw (`ErrorBoundary`);
   - a live listener the database ended, except "offline".
2. **Endpoint** `POST /api/client-error` (Pages Function, `functions/_lib/clientError.ts`)
   writes **one JSON log line** to the Workers log. Read it with
   `wrangler pages deployment tail` or Cloudflare dashboard → Pages → Functions → Logs.
3. **Nothing is stored.** There is no Firestore, no KV and no outgoing request. A test reads
   the four source files and fails if any of them imports a database module.

## What a report holds

The shape is defined in `src/lib/errorReport.ts` and shared by client and server.

| Field | Content |
|---|---|
| `buildId` | Commit, baked in at build time (Cloudflare `CF_PAGES_COMMIT_SHA`, else git) |
| `route` | The shape only: `/products/:id/card` |
| `role` | admin / manager / staff / none |
| `browser` | Family, major version and platform: `chrome-128/android` |
| `env` | prod / dev, online / offline |
| `errorType`, `source` | window / promise / render / listener |
| `message` | Scrubbed, at most 160 characters |
| `stackHash` | FNV-1a of the frames, without line numbers or chunk hashes, so it is stable across builds |
| `ts` | Timestamp |

**Scrubbed from every message**, on the client and again on the server:
- e-mails;
- URL query strings (paths are reshaped as above);
- tokens and long ids;
- quoted text;
- **all Thai text**;
- document numbers;
- **every number**.

No document contents are ever sent: no quantities, product names, supplier names or lines.

## Limits

| Where | Limit |
|---|---|
| Browser, per tab | Each failure once per 10 min; at most 10 reports per 10 min; repeats sampled 1 in 4 |
| Server, per isolate | Each build + failure once per minute; at most 60 a minute; repeats sampled 1 in 5. Best-effort, because isolates come and go. |
| Body | 2 KB at most. Any field outside the shape, an unknown role, or a malformed hash or build id is refused (400). |

**Response:** always 204 whether the report was logged, deduplicated or sampled away, so a
caller learns nothing from it.

## Failure can never break the app

- Sending uses `sendBeacon`, falling back to a keepalive `fetch` whose rejection is
  swallowed. All of it runs in try/catch and nothing awaits it.
- The reporter is **off** in dev, e2e and tests. It switches on only in a production build.
- **Tests** (`tests/error-report.test.ts`, 27):
  - the scrubbing cases;
  - route, browser and stack-hash stability;
  - server-side refusal of forged shapes;
  - the limiter (dedupe, budget, never sampling away a new failure);
  - endpoint statuses and exactly one log line;
  - a log that throws still answers 204;
  - the reporter does not throw when sending throws;
  - nothing is sent unless installed;
  - no database imports.

## Owner steps at deploy

- None are required. The endpoint ships with the app.
- To keep logs longer than the dashboard's window, enable Workers Logs or Logpush in
  Cloudflare. That is optional and stays outside Firestore.
