// Official Rules API projects:test only (server-side compile, creates/releases nothing). Never prints tokens.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const FT = path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib');
const auth = require(path.join(FT, 'auth.js')); const scopes = require(path.join(FT, 'scopes.js'));
const [project, rulesFile, outFile] = process.argv.slice(2);
(async () => {
  const content = fs.readFileSync(rulesFile, 'utf8');
  const account = auth.getProjectDefaultAccount(process.cwd());
  const at = await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM]);
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`, {
    method: 'POST', headers: { Authorization: `Bearer ${at.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] } }),
  });
  const body = await res.json();
  const issues = body.issues ?? [];
  const out = { checkedAt: new Date().toISOString(), project, api: 'firebaserules.projects.test', httpStatus: res.status,
    rulesFile: path.basename(path.dirname(rulesFile)) + '/' + path.basename(rulesFile),
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    errors: issues.filter((i) => i.severity === 'ERROR').length, warnings: issues.filter((i) => i.severity === 'WARNING').length,
    issues: issues.map((i) => ({ severity: i.severity, line: i.sourcePosition?.line, description: i.description })) };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(out, null, 1));
  if (res.status !== 200 || out.errors) process.exitCode = 1;
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
