// Read-only OpenCode metadata: no message text/tool arguments/user prompts/auth tables selected.
// Usage: node model-request-overlap.cjs <ISO start> [R72]
// `streamed` is END of generation; `completed` also includes tools and is deliberately unused.
const path = require('node:path')
const assert = require('node:assert/strict')
const Database = require(path.join(process.env.APPDATA, 'npm/node_modules/better-sqlite3'))
const since = Date.parse(process.argv[2])
const sprint = process.argv[3] || 'R72'
assert(Number.isFinite(since) && /^R\d+$/.test(sprint), 'Expected ISO date and R-number')
const iso = n => new Date(n).toISOString()
function sweep(intervals) {
  const valid = intervals.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
  const events = valid.flatMap(([a, b, id]) => [[a, 1, id], [b, -1, id]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const live = new Map()
  let peak = 0, at = null
  for (const [t, change, id] of events) {
    const count = (live.get(id) || 0) + change
    assert(count >= 0, 'Invalid interval ordering')
    if (count) live.set(id, count); else live.delete(id)
    if (live.size > peak) { peak = live.size; at = t }
  }
  assert.equal(live.size, 0)
  return { peak, at: at === null ? null : iso(at) }
}
// Small executable regression checks: touching ranges are not concurrent; zero duration is empty.
assert.equal(sweep([[0, 8, 'a'], [8, 10, 'b'], [3, 3, 'empty']]).peak, 1)
assert.equal(sweep([[0, 10, 'a'], [1, 8, 'b'], [8, 9, 'c']]).peak, 2)
assert.equal(sweep([]).peak, 0)
const db = new Database(path.join(process.env.USERPROFILE, '.local/share/opencode/opencode.db'), { readonly: true })
const sessions = db.prepare(`SELECT id,title,model,directory,time_created,time_idle,idle_outcome
 FROM session_v2 WHERE time_created>=? AND title LIKE ? ORDER BY time_created`).all(since, `${sprint} Agent%`)
const requests = [], emissions = []
const rows = sessions.map(s => {
  const messages = db.prepare(`SELECT type,time_created,time_updated,
    json_extract(data,'$.time.created') AS started,
    json_extract(data,'$.time.streamed') AS ended,
    (SELECT min(json_extract(p.value,'$.time.created')) FROM json_each(data,'$.content') p) AS first_part,
    coalesce(json_extract(data,'$.tokens.input'),0)+coalesce(json_extract(data,'$.tokens.cache.read'),0) AS context,
    json_extract(data,'$.status') AS state,
    json_extract(data,'$.reason') AS reason,
    coalesce(json_extract(data,'$.error.status'),json_extract(data,'$.error.data.statusCode')) AS http_status,
    coalesce(json_extract(data,'$.error.type'),json_extract(data,'$.error.name')) AS error_type
   FROM session_message WHERE session_id=? AND type IN ('assistant','compaction') ORDER BY seq`).all(s.id)
  let calls = 0, maxContext = 0
  const failures = [], compactions = []
  for (const m of messages) {
    if (m.type === 'compaction') compactions.push({ state: m.state, reason: m.reason, start: iso(m.time_created), end: iso(m.time_updated), httpStatus: m.http_status })
    else {
      if (m.started && m.ended && m.ended > m.started) {
        requests.push([m.started, m.ended, s.id]); calls++
        if (m.first_part >= m.started && m.first_part < m.ended) emissions.push([m.first_part, m.ended, s.id])
      }
      maxContext = Math.max(maxContext, m.context)
    }
    if (m.error_type || m.http_status) failures.push({ type: m.error_type, httpStatus: m.http_status, at: iso(m.time_updated) })
  }
  const model = JSON.parse(s.model)
  return { title: s.title, model: `${model.providerID}/${model.id}`, directory: s.directory,
    createdAt: iso(s.time_created), idleAt: s.time_idle ? iso(s.time_idle) : null,
    outcome: s.idle_outcome || 'running', calls, maxContext, failures, compactions }
})
const requestPeak = sweep(requests), emissionPeak = sweep(emissions)
const at = requestPeak.at && Date.parse(requestPeak.at)
const evidence = at === null ? [] : requests.filter(([a,b]) => a <= at && at < b).map(([a,b,id]) => ({
  title: sessions.find(s => s.id === id).title, requestedAt: iso(a), streamEndedAt: iso(b),
}))
assert.equal(new Set(evidence.map(x => x.title)).size, requestPeak.peak)
console.log(JSON.stringify({ capturedAt: iso(Date.now()), since: iso(since), sprint,
  observedSessions: rows.length, modelRequestLifecyclePeak: requestPeak,
  conservativeContentEmissionPeak: emissionPeak, peakEvidence: evidence,
  methodology: 'request-lifecycle = assistant.created -> streamed (generation end), excluding subsequent tool execution; may include local setup/provider queue; emission = first content-part timestamp -> streamed',
  upstreamActualInferenceConcurrency: 'UNVERIFIED; no wire/upstream queue trace', sessions: rows }, null, 2))
