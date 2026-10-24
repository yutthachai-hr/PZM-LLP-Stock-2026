// R67 Release A authorization check through the official Rules API `projects:test`: the server
// evaluates the given Rules source against simulated requests. Users are mocked with functionMocks,
// so no Firestore document is read or written and no stock data is touched. Never prints tokens.
// Usage: node rules-authz-suite.cjs <project> <rules-file> <expect: candidate|baseline> <out.json>
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const FT = path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib');
const auth = require(path.join(FT, 'auth.js')); const scopes = require(path.join(FT, 'scopes.js'));
const [project, rulesFile, mode, outFile] = process.argv.slice(2);
const DB = '/databases/(default)/documents';
const NOW = '2026-10-24T12:00:00Z';
const users = {
  admin1: { role: 'admin', active: true },
  mgr1: { role: 'manager', active: true },
  staff1: { role: 'staff', active: true },
  oldadmin: { role: 'admin', active: false },
};
const userMocks = (uid) => {
  const m = [{ function: 'exists', args: [{ exactValue: `${DB}/revokedUsers/${uid}` }], result: { value: false } }];
  if (users[uid]) {
    m.push({ function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: true } });
    m.push({ function: 'get', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data: users[uid] } } });
  } else m.push({ function: 'exists', args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: false } });
  return m;
};
const loc = (id, type, extra = {}) => ({ id, name: type === 'transit' ? 'ระหว่างขนส่ง' : 'คลังทดสอบ', type, active: true, createdAt: 1792843200000, ...extra });
const create = (uid, col, id, data) => ({
  request: { auth: uid ? { uid, token: {} } : null, path: `${DB}/${col}/${id}`, method: 'create', time: NOW, resource: { data } },
  functionMocks: uid ? userMocks(uid) : [],
});
// [label, case, expected on candidate, expected on baseline]
const cases = [
  ['admin creates canonical transit (pizza)', create('admin1', 'locations', 'transit', loc('transit', 'transit')), 'ALLOW', 'DENY'],
  ['admin creates canonical transit (lelapin)', create('admin1', 'lelapin__locations', 'transit', loc('transit', 'transit')), 'ALLOW', 'DENY'],
  ['admin creates canonical transit (rnd)', create('admin1', 'rnd__locations', 'transit', loc('transit', 'transit')), 'ALLOW', 'DENY'],
  ['admin: imported transit under another id', create('admin1', 'locations', 'tr-imported', loc('tr-imported', 'transit')), 'ALLOW', 'DENY'],
  ['admin: warehouse may not take the id transit', create('admin1', 'locations', 'transit', loc('transit', 'warehouse')), 'DENY', 'ALLOW'],
  ['admin: ordinary warehouse (no regression)', create('admin1', 'locations', 'wh-qa', loc('wh-qa', 'warehouse')), 'ALLOW', 'ALLOW'],
  ['manager creates transit', create('mgr1', 'locations', 'transit', loc('transit', 'transit')), 'DENY', 'DENY'],
  ['staff creates transit', create('staff1', 'locations', 'transit', loc('transit', 'transit')), 'DENY', 'DENY'],
  ['inactive admin creates transit', create('oldadmin', 'locations', 'transit', loc('transit', 'transit')), 'DENY', 'DENY'],
  ['unknown signed-in user creates transit', create('nobody', 'locations', 'transit', loc('transit', 'transit')), 'DENY', 'DENY'],
  ['signed-out creates transit', create(null, 'locations', 'transit', loc('transit', 'transit')), 'DENY', 'DENY'],
  ['admin: unknown type rejected', create('admin1', 'locations', 'x1', loc('x1', 'truck')), 'DENY', 'DENY'],
  ['admin: extra field rejected', create('admin1', 'locations', 'transit', loc('transit', 'transit', { stock: 5 })), 'DENY', 'DENY'],
];
(async () => {
  const content = fs.readFileSync(rulesFile, 'utf8');
  const account = auth.getProjectDefaultAccount(process.cwd());
  const at = await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM]);
  const col = mode === 'baseline' ? 3 : 2;
  const testCases = cases.map(([, c, ...exp]) => ({ ...c, expectation: exp[col - 2] }));
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`, {
    method: 'POST', headers: { Authorization: `Bearer ${at.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] }, testSuite: { testCases } }),
  });
  const body = await res.json();
  if (!res.ok) { console.error(`HTTP ${res.status}`, JSON.stringify(body).slice(0, 600)); process.exitCode = 1; return; }
  const results = (body.testResults ?? []).map((r, i) => ({ case: cases[i][0], expected: testCases[i].expectation, state: r.state, debug: (r.debugMessages ?? []).slice(0, 3) }));
  const out = { checkedAt: new Date().toISOString(), project, api: 'firebaserules.projects.test', mode,
    rulesSha256: crypto.createHash('sha256').update(content).digest('hex'), issues: body.issues ?? [],
    passed: results.filter((r) => r.state === 'SUCCESS').length, total: results.length, results };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), { flag: 'wx' });
  for (const r of results) console.log(`${r.state === 'SUCCESS' ? 'PASS' : 'FAIL'}  expect ${r.expected.padEnd(5)}  ${r.case}${r.debug.length ? '  ' + JSON.stringify(r.debug) : ''}`);
  console.log(`${out.passed}/${out.total} sha ${out.rulesSha256.slice(0, 8)}`);
  if (out.passed !== out.total) process.exitCode = 1;
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
