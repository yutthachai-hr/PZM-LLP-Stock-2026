// R70 read-only concurrency evidence. OpenCode: per R69 session, its assistant model calls as
// [created, completed] intervals -> peak simultaneous sessions and in-flight calls. 9Router: Gemini
// requests and statuses in the same window. Prints no prompts, outputs, keys or tokens.
const path = require('path');
const D = require(path.join(process.env.APPDATA, 'npm/node_modules/better-sqlite3'));
const SINCE = Date.parse(process.argv[2]);
const oc = new D(path.join(process.env.USERPROFILE, '.local/share/opencode/opencode.db'), { readonly: true });
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(11, 19) : null);
const sessions = oc.prepare("select id, title, model, directory, time_created, time_updated, time_idle, idle_outcome from session_v2 where time_created >= ? and title like 'R69%' order by time_created").all(SINCE);
const calls = []; const streams = []; const per = [];
for (const s of sessions) {
  let model = '?'; try { const m = JSON.parse(s.model); model = `${m.providerID}/${m.id}` } catch {}
  const msgs = oc.prepare("select type, data from session_message where session_id = ? and type in ('assistant','compaction') order by seq").all(s.id);
  let n = 0, err = null, first = Infinity, last = 0, comp = 0, compFail = 0, maxCtx = 0;
  for (const m of msgs) {
    let d; try { d = JSON.parse(m.data) } catch { continue }
    if (m.type === 'compaction') { d.error ? compFail++ : comp++; continue }
    // OpenCode `streamed` is the END of the model stream; `completed` includes tool execution.
    const a = d.time?.created, b = d.time?.streamed;
    if (a && b) { calls.push([a, b, s.id]); n++; first = Math.min(first, a); last = Math.max(last, b) }
    const tokenStarts = (d.content || []).map(p => p.time?.created).filter(t => Number.isFinite(t) && t >= a && t < b);
    if (tokenStarts.length) streams.push([Math.min(...tokenStarts), b, s.id]);
    const t = d.tokens; if (t) maxCtx = Math.max(maxCtx, (t.input || 0) + (t.cache?.read || 0));
    if (d.error && !err) err = { name: d.error.name, status: d.error.data?.statusCode ?? null };
  }
  per.push({ title: s.title.slice(0, 52), model, directory: s.directory, start: iso(s.time_created), startAt: new Date(s.time_created).toISOString(), endAt: s.idle_outcome && s.time_idle ? new Date(s.time_idle).toISOString() : null, lastCall: iso(last || null), calls: n, maxCtx, compactions: `${comp}/${compFail}`, outcome: s.idle_outcome ?? 'running', error: err });
}
// Peak simultaneous: sessions with a call in flight, and in-flight calls, by sweep.
const ev = calls.flatMap(([a, b, s]) => [[a, 1, s], [b, -1, s]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
let cur = 0, peak = 0, peakAt = 0; const live = new Map(); let peakSessions = 0, peakSessAt = 0;
for (const [t, d, s] of ev) {
  cur += d; if (cur > peak) { peak = cur; peakAt = t }
  live.set(s, (live.get(s) || 0) + d); if (live.get(s) === 0) live.delete(s);
  if (live.size > peakSessions) { peakSessions = live.size; peakSessAt = t }
}
// First content-part timestamp to end-of-stream: conservative observed token-emission overlap, excluding tools.
const streamEvents = streams.flatMap(([a,b,s]) => [[a,1,s],[b,-1,s]]).sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
const streamLive = new Map(); let streamPeak = 0, streamPeakAt = null;
for (const [t,d,s] of streamEvents) { const n=(streamLive.get(s)||0)+d; if(n) streamLive.set(s,n); else streamLive.delete(s); if(streamLive.size>streamPeak) {streamPeak=streamLive.size;streamPeakAt=new Date(t).toISOString();} }
// Sessions "alive" (between first and last call) at the same time.
const spans = per.length ? sessions.map((s) => { const c = calls.filter((x) => x[2] === s.id); return c.length ? [Math.min(...c.map((x) => x[0])), Math.max(...c.map((x) => x[1]))] : null }).filter(Boolean) : [];
const sev = spans.flatMap(([a, b]) => [[a, 1], [b, -1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
let sc = 0, speak = 0, speakAt = 0; for (const [t, d] of sev) { sc += d; if (sc > speak) { speak = sc; speakAt = t } }
require('node:assert/strict')(calls.every(([a,b]) => a > 0 && b >= a), 'invalid model interval');
const peakRequestEvidence = calls.filter(([a,b]) => a <= peakSessAt && peakSessAt < b).map(([a,b,id]) => {
  const s = sessions.find(x => x.id === id);
  return { title: s.title, directory: s.directory, submittedAt: new Date(a).toISOString(), streamEndedAt: new Date(b).toISOString() };
});
require('node:assert/strict').equal(new Set(peakRequestEvidence.map(x=>x.directory)).size, peakSessions);
const r9 = new D(path.join(process.env.APPDATA, '9router/db/data.sqlite'), { readonly: true });
const rows = r9.prepare("select timestamp, status from usageHistory where timestamp >= ? and model like '%gemini-3.8%'").all(new Date(SINCE).toISOString());
const byStatus = {}; const perMin = {};
for (const r of rows) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; const k = r.timestamp.slice(11, 16); perMin[k] = (perMin[k] || 0) + 1 }
const busiest = Object.entries(perMin).sort((a, b) => b[1] - a[1]).slice(0, 3);
console.log(JSON.stringify({
  window: `${new Date(SINCE).toISOString()} .. ${new Date().toISOString()}`,
  r69Sessions: per.length,
  peakSessionsAliveTogether: speak, peakSessionsAliveAt: iso(speakAt),
  peakSessionsWithCallInFlight: peakSessions, at: iso(peakSessAt),
  peakInFlightModelCalls: peak, peakCallsAt: iso(peakAt),
  totalModelCalls: calls.length, peakRequestEvidence,
  peakSessionsStreamingTogether: streamPeak, streamingPeakAt: streamPeakAt,
  requestIntervals: 'assistant.time.created -> assistant.time.streamed (stream end, NOT first token); excludes tool execution until time.completed',
  tokenIntervals: 'earliest content[].time.created -> assistant.time.streamed (conservative emission window)',
  submittedToStreamEndMayIncludeQueueWait: true, upstreamGoogleConcurrencyCeiling: 'not observable from these local records',
  router9Gemini38: { byStatus, busiestMinutes: busiest },
  sessions: per,
}, null, 1));
