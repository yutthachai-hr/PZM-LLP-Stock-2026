# R72 Operational Observer Review: Concurrency & Metadata Audit

**Reviewer**: Independent R72 Operational Observer Sub-agent  
**Runtime**: OpenCode / `9router/gemini-3.8-flash-high` (`variant: high`)  
**Base Commit**: `688a42f`  
**Disposition**: **APPROVE** (with mandatory scope caveats and algorithm hardening proposals)

---

## 1. Executive Summary

Audit of `docs/mission/r72/tools/model-request-overlap.cjs`, `docs/mission/r72/concurrency-initial.json`, `docs/mission/r72/worker-receipts.json`, and claim statements in `R72-LOGISTICS-UX-REPAIR.md` and `PROGRESS.md`:
- **Scope & Privacy**: **PASS**. Read-only connection, parameterized SQL, strictly metadata/timestamps. Zero prompts, message text, tool inputs, or auth secrets accessed.
- **Algorithm Integrity**: **PASS**. Interval sweep correctly orders end-before-start on equal timestamps, drops zero-duration/inverted spans, ignores tool tails (`time.completed` excluded), and keys active count by session ID to avoid intra-session loop inflation.
- **Concurrency Claims**: **PASS**. Client model request lifecycle overlap of 7 workers for 1905ms (17:59:03.839–17:59:05.744Z) and conservative content emission peak of 4 are verified by exact JSON metrics. Upstream inference concurrency is properly marked **UNVERIFIED**.
- **Scope Boundary Caveat**: SQL title filtering (`R72 Agent%`) captures only the initial 7 worker tasks. Independent reviews and non-agent tasks are excluded and must not be subsumed without explicit caveat.

---

## 2. Privacy & Scope Audit

File: `docs/mission/r72/tools/model-request-overlap.cjs`
- **Line 6**: Uses existing global npm package `better-sqlite3` under `%APPDATA%\npm\node_modules\better-sqlite3`. No dependency added to repository `package.json`.
- **Line 30**: Opens SQLite database with `{ readonly: true }`. Prevents accidental writes or schema changes.
- **Lines 31–32 & 35–44**:
  - Bound parameters `?` used exclusively (`since`, `${sprint} Agent%`, `s.id`). No SQL injection risk.
  - Queries only operational fields: `id`, `title`, `model`, `directory`, `time_created`, `time_idle`, `idle_outcome`, `time_updated`, `tokens`, `status`, `reason`, `error`.
  - Excludes message bodies, system prompts, user queries, tool arguments, API keys, and authentication tables.
  - No network egress or telemetry transmission.

---

## 3. Algorithm & Measurement Verification

### A. Lifecycle Definition & Tool Exclusion
- **Line 3**: Documentation explicitly notes `streamed` is end of generation; `completed` includes tool execution and is deliberately omitted.
- **Line 36–37**: Extracts `json_extract(data,'$.time.created') AS started` and `json_extract(data,'$.time.streamed') AS ended`.
- **Line 50**: Guards `if (m.started && m.ended && m.ended > m.started)`. Unclosed in-flight requests and clock inversions are discarded.
- **Tool Tails Excluded**: Because `time.streamed` (generation stream close) is used rather than `time.completed` (tool completion), tool execution intervals do not inflate model overlap numbers.

### B. Sweep Ordering & Touching Intervals
- **Lines 13–14**:
  ```javascript
  const events = valid.flatMap(([a, b, id]) => [[a, 1, id], [b, -1, id]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  ```
  For matching timestamps (`a[0] === b[0]`), change `-1` sorts before `1` (`-1 - 1 = -2 < 0`).
- Interval ending at $t$ decrements before interval starting at $t$ increments. Touching intervals `[0, 8]` and `[8, 10]` correctly produce peak 1.
- Zero-duration ranges `[3, 3]` are filtered out by `b > a` at line 12.

### C. Same-Session Deduplication
- **Lines 15–21**: `live` is an instance of `Map<sessionId, count>`.
- `peak` tracks `live.size` (number of distinct session IDs), not sum of open request counts. Overlapping requests or loops within the same session ID do not inflate concurrency.

---

## 4. Claims vs. Artifact Evidence

Checked against `docs/mission/r72/concurrency-initial.json`:
1. **7-Worker Lifecycle Overlap**:
   - `modelRequestLifecyclePeak.peak`: 7
   - Peak timestamp `at`: `2026-10-24T17:59:03.839Z` (Agent03 request initiation).
   - Overlap start: `2026-10-24T17:59:03.839Z`.
   - Overlap end: `2026-10-24T17:59:05.744Z` (Agent02 stream end).
   - Duration: $17:59:05.744 - 17:59:03.839 = 1905\text{ ms}$.
   - All 7 sessions (Agent01–Agent07) active throughout this 1905ms window.
2. **Conservative Content Emission**:
   - `conservativeContentEmissionPeak.peak`: 4 at `2026-10-24T17:58:45.440Z`.
   - Computed from `first_part` (first content chunk timestamp) to `streamed`.
3. **Upstream Inference Truth**:
   - Both `concurrency-initial.json` (line 52) and `R72-LOGISTICS-UX-REPAIR.md` (line 25) explicitly declare upstream GPU concurrency as **UNVERIFIED**.
   - No claim of 7 simultaneous backend tokens. Previous withdrawn R70 claim is not repeated.
4. **Worker Verification**:
   - `docs/mission/r72/worker-receipts.json` confirms all 7 initial workers dispatched with:
     - `providerInstanceId`: `opencode`
     - `model`: `9router/gemini-3.8-flash-high`
     - `options`: `[{"id": "variant", "value": "high"}]`
   - Verified no forbidden Claude/Codex/GPT fallbacks, nested agents, or altered scheduler configs.

---

## 5. Identified Scope Limitations & Proposed Hardening

No code edits were performed (observer review mode only). Proposed fixes for future tool iterations:

### Limitation 1: Query Title Prefix Excludes Non-Agent Sessions
- **Location**: `docs/mission/r72/tools/model-request-overlap.cjs`, line 32
- **Issue**: `title LIKE ?` bound to `${sprint} Agent%` matches only `R72 Agent01`..`Agent07`. Independent reviews (e.g. `t3/review-r72-observer`), observer sessions, or follow-up tasks without the exact prefix `R72 Agent` are excluded.
- **Impact**: Concurrency metrics represent initial worker tasks only, not aggregate sprint operations.
- **Fix Proposal** (Line 32):
  Allow optional title filter pattern or query review/observer sessions separately:
  ```javascript
  // Line 8 & 32: allow configurable pattern or multi-pattern matching
  const filterPattern = process.argv[4] || `${sprint} Agent%`
  // ...
  .all(since, filterPattern)
  ```

### Limitation 2: Peak Evidence Duplication Guard
- **Location**: `docs/mission/r72/tools/model-request-overlap.cjs`, lines 65–68
- **Issue**: If one session has two simultaneous sub-requests overlapping `at`, `requests.filter(...)` would yield 2 items for that session. While `requestPeak.peak` is `live.size` (1), `evidence.length` would be 2, causing the assert at line 68 (`assert.equal(new Set(evidence.map(x => x.title)).size, requestPeak.peak)`) to pass on set size but leave duplicate rows in `evidence`.
- **Fix Proposal** (Lines 65–67):
  ```javascript
  const seenSessions = new Set()
  const evidence = at === null ? [] : requests
    .filter(([a, b]) => a <= at && at < b)
    .filter(([,, id]) => !seenSessions.has(id) && seenSessions.add(id))
    .map(([a, b, id]) => ({
      title: sessions.find(s => s.id === id).title,
      requestedAt: iso(a),
      streamEndedAt: iso(b),
    }))
  ```

### Limitation 3: Host Environment Assumptions
- **Location**: `docs/mission/r72/tools/model-request-overlap.cjs`, lines 6 & 30
- **Issue**: Hardcoded `process.env.APPDATA` and `process.env.USERPROFILE` limits script to Windows desktop runs.
- **Fix Proposal**: Add fallback resolution for POSIX/CI environments if run outside Windows host.

---

## 6. Disposition

**APPROVE**. Concurrency metrics in `docs/mission/r72/concurrency-initial.json` and documentation statements accurately reflect verified client request lifecycles without overstated upstream inference claims.
