# GitHub release engineering: audit and proposal (nothing enabled)

Audited 8 Oct 2026 with read-only `gh api` calls against `yutthachai-hr/PZM-LLP-Stock-2026`.
**This is a proposal. No workflow file was added, and no protection or ruleset was changed.**
The YAML below lives in this document only; copying it into `.github/workflows/` is the step
that turns it on.

## What exists today

| Item | State |
|---|---|
| `.github/` folder, workflows | **None.** 0 workflows. |
| Branch protection on `main` | **None** (`Branch not protected`) |
| Repository rulesets | **None** |
| Visibility | **Public** |
| Auto-merge / delete branch on merge | Off / off |
| Production deploy | **Cloudflare Pages builds `main` automatically** to `pzmstock.pages.dev`. A push to `main` *is* a production deploy of the web app. |
| Firestore rules / Worker deploy | Manual (`firebase deploy --only firestore:rules`, `npm run worker:deploy`) |
| Gates | Local only: `npm run verify` (now with rules, Rust and differential), e2e by hand |

### Risks this creates

1. **Anyone with push access can deploy production** by pushing to `main`. No check runs.
2. **Branch previews talk to the live Firebase project.** Pages builds every pushed branch as a
   preview, and `vite.config.ts` switches to demo mode only for the `demo` branch. A preview
   of unreleased code (for example this integration branch, whose writes carry `version` and
   `traceId`) uses production data.
   - Today's production rules would **refuse** those writes, so the failure is safe. It is
     still unreleased code on live data.
3. **Public repo + no protection:** a mistaken force-push or branch deletion of `main` is not
   blocked.

## Proposed workflow 1: `verify.yml` (every PR and integration push)

```yaml
name: verify
on:
  pull_request:
  push:
    branches: [main, 'integration/**']
concurrency:
  group: verify-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - uses: actions/setup-java@v4          # the Firestore emulator
        with: { distribution: temurin, java-version: 21 }
      - uses: dtolnay/rust-toolchain@stable  # crates/pzm-integrity
      - uses: Swatinem/rust-cache@v2
        with: { workspaces: crates/pzm-integrity }
      - run: npm ci
      # types x4, lint, unit, i18n, dataset/vector freshness, safety bench,
      # cargo test, TS<->Rust differential, rules emulator, build, bundle budget
      - run: npm run verify -- --full
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    needs: verify
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with: { name: playwright-report, path: playwright-report/, retention-days: 7 }
```

Notes:
- `npm run verify -- --full` already runs `cargo test` and the rules suite when the tools are
  present, and reports SKIPPED (never PASS) when they are not. In CI they are present, so a
  skip would show up as a gap.
- No secrets are needed. Everything runs against the emulator, PGlite and local fixtures.

## Proposed workflow 2: `nightly.yml` (not on every push)

```yaml
name: nightly
on:
  schedule: [{ cron: '0 19 * * *' }]   # 02:00 Bangkok
  workflow_dispatch:
permissions:
  contents: read
jobs:
  mutation:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run mutation               # Stryker, scope in stryker.config.mjs
      - uses: actions/upload-artifact@v4
        with: { name: mutation-report, path: reports/mutation/ }
  differential-long:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
      - run: npm ci
      - run: npm run integrity:diff -- --n 20000   # a fresh seed every night, printed
  flaky:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }
      - run: npm ci && npx playwright install --with-deps chromium
      - run: FLAKY_LABEL=nightly npx firebase emulators:exec --only firestore,auth --project demo-pzm-e2e "npx playwright test -c playwright.flaky.config.ts"
```

## Proposed protection for `main` (owner applies; not applied)

- **Require a pull request** before merging; at least 1 approval (the owner).
- **Required status checks:** `verify / verify` and `verify / e2e`. The branch must be up to
  date before merging.
- **Block force pushes and deletion** of `main`.
- Optional: **require linear history** (fits the fast-forward merges in HANDOFF's history).
- Keep auto-merge **off**: a merge to `main` deploys production.

## Proposed preview safety (a one-line code change, for the owner to approve)

In `vite.config.ts`, build every non-production Pages branch in demo mode:

```ts
// before: if (process.env.CF_PAGES_BRANCH === 'demo') process.env.VITE_DEMO_MODE = '1'
if (process.env.CF_PAGES && process.env.CF_PAGES_BRANCH !== 'main') process.env.VITE_DEMO_MODE = '1'
```

Then a pushed branch can never write production data through its preview URL. If a
production-connected staging is wanted later, name it explicitly (for example `staging`) and
allow-list it.

## Order of operations (proposed)

1. **Owner approves** the preview-safety change. Merge it first; it is tiny and protective.
2. Add `verify.yml`. Watch it pass on the integration branch.
3. Turn on protection for `main` with the two required checks.
4. Add `nightly.yml`.
5. Only then: the RC freeze checklist (HANDOFF §0).
