// Official Firebase/Rules API GETs only. Uses the CLI-selected account; never prints tokens.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const FT = path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib');
const auth = require(path.join(FT, 'auth.js')); const scopes = require(path.join(FT, 'scopes.js'));
const project = process.argv[2]; const out = process.argv[3];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
(async () => {
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account?.user?.email || !account.tokens?.refresh_token) throw new Error('CLI selected account unavailable');
  const at = await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM]);
  const headers = { Authorization: `Bearer ${at.access_token}` };
  async function get(url) { const res = await fetch(url, { headers }); if (!res.ok) throw new Error(`Official GET ${new URL(url).pathname} HTTP ${res.status}`); return res.json(); }
  const identity = await get(`https://firebase.googleapis.com/v1beta1/projects/${project}`);
  if (identity.projectId !== project) throw new Error('Firebase project identity mismatch');
  const release = await get(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
  if (!release.rulesetName?.startsWith(`projects/${project}/rulesets/`)) throw new Error('Ruleset project mismatch');
  const ruleset = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  if (!ruleset.source?.files?.length) throw new Error('No Rules source files');
  fs.mkdirSync(out, { recursive: true });
  const files = ruleset.source.files.map((f, i) => {
    const name = `${i}-${path.basename(f.name)}`; const content = Buffer.from(f.content, 'utf8');
    fs.writeFileSync(path.join(out, name), content, { flag: 'wx' });
    return { apiName: f.name, backupFile: name, bytes: content.length, sha256: sha(content) };
  });
  fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify(release, null, 2), { flag: 'wx' });
  fs.writeFileSync(path.join(out, 'ruleset.json'), JSON.stringify(ruleset, null, 2), { flag: 'wx' });
  const metadata = { fetchedAt: new Date().toISOString(), accountEmail: account.user.email, projectId: identity.projectId,
    projectNumber: identity.projectNumber, projectState: identity.state, releaseId: release.name,
    rulesetId: release.rulesetName, releaseCreateTime: release.createTime, releaseUpdateTime: release.updateTime,
    rulesetCreateTime: ruleset.createTime, files };
  fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify(metadata, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(metadata, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
