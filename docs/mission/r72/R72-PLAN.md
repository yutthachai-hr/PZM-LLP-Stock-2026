# R72 Logistics UX Repair Implementation Plan

> **For agentic workers:** use subagent-driven-development with the explicitly authorized seven independent T3 workers. Each owner uses its own worktree, branch, local checkpoint and bounded brief. MAIN integrates and obtains fresh independent reviews. No nested delegation.

**Goal:** Repair transfer notification navigation and mobile Logistics receiving, reuse finished PO estimates, and deliver focused reviewed PRs with rendered regression evidence.

**Architecture:** Keep existing React/TypeScript/Tailwind components, business services, brand boundaries and navigation resolver. Transfer receiving uses the Owner's four-row mobile card; layout is distinct from the PO Receive screen. Test-only workstreams prepare contracts and fixtures against stable baselines; MAIN applies their commits onto final candidate code.

**Tech Stack:** React19, TypeScript6, Tailwind4, Vitest5.0.0 / Playwright1.63.0 from npm lock, local/demo backend and Firebase emulators only for writes.

**Spec:** Owner R72 directive in this thread (24 Oct2026UTC), reproduced as scoped requirements in the seven task briefs. Owner explicitly authorized execution and supplied the complete four-row design; no additional design/plan approval pause.

## Global Constraints

- MAIN Pi Claude/Codex only. All children explicit `opencode / 9router/gemini-3.8-flash-high`, variant high advertised by live capabilities.
- STRICT BAN on Claude/Codex/GPT/ChatGPT/GPT-OSS children, probes and fallback. No nested agents. No unqualified localQwen or repeated exhausted DeepSeek probes.
- Seven hosted maximum, not two. AutoDispatch/HybridFailover remainOFF; no globalcompaction or nativepermission changes.
- No Productionbusinesswrites, no deploys/merges, no real LINE sends. ReleaseA/B approval does not cover R72.
- No reset--hard/forcepush/clean/deletion of Owner work. Private npmci only; never install into shared node_modules junction. Keep package/lockfile unchanged.
- On502: save state and inspect first, maximum one bounded recovery for the affected task; unrelated work continues.
- Source selection is Git-verified: main6045b50, PR55=1651548, PR61=992f6de. Never use the corrupted fullSHAs from old compacted handoffs.
- Use app fonts/tokens/icons, no new dependencies, no globalvisualrebrand, no replacing decimal input with integer logic.

## Current Reconciliation / Preservation

- R69 Agent01 did not remain lost: recovery1651548, testcontract/repro independentlyAPPROVED410429f, focused119/browser18, PR55CI10/10.
- R69 Agent03 is not unfinished: resolver/UI integrated at992f6de (PR61), financialAPPROVE3eb19cf and testdeltaAPPROVE60a30ed, MAINpinned1783unit/69focused/4E2E; PR61CI10/10 as latestfetch.
- All19openPRs inspected. No pre-existing receiving-layout implementation was found on prepared responsive branch `fix/20261023-responsive-838` (still312f8a7); historical audit branches are read-only references, not code to replay blindly.
- All196worktrees inventoried.46dirty worktrees saved as binarydiff+untracked archives, detachedheads retained by additive tags; bundleverify and checksumsPASS.
- Backup `C:/Users/Yutthachai/r64-backup/r72-preserve-20261024T174522Z`, bundleSHA256`b0f5f83669cd2cac5a106797e606c3c3c3ef7a37997fc7be3e43f8638ef00f74`.
- Preservation script initially encountered duplicate detachedHEAD tag (several worktrees share a commit). Verified tag target, resumed same snapshot with collision checks, did not force-tag or discard work.

## Review Focus

1. 390px paradox: fixed-width stepper fits alongside checkbox but leaves a tiny flex title column; 320px may wrap differently. Assert boundingboxes and useful identity width at all six phone widths.
2. 1.063KG/empty/negative quantities and ±controls must preserve existing validation and numeric precision; rapid two-tap confirmation must file once.
3. 21st row, expanded reason/photo block, large font and shrunk keyboard viewport must remain reachable above footer/tabbar/safearea.
4. Navigation from stale links must use documentID, not title/docNo guessing; stale brand and invalid target must remain unread without other-brand information.
5. PO estimates are not historical agreed prices or stock-book valuation; missing !=0 and no monetary writes. Preserve existing cost access rules.

## Ownership / Resource Leases

| Agent | Baseline | Owns | Resource |
|---|---|---|---|
|01 notification |1651548| notification-specifictests/report; bounded proven sourcefixes only in existing resolver/Bell/Host |5206demo only|
|02 Logistics mobile |6045b50| TransferReceivePage.tsx and optional local siblingcard, focusedunit test; no sharedshell/backend edits |5212demo only|
|03 PO pricing |992f6de| tests/pricing authorization/verification report; sourcechanges only if newbug proven |no server|
|04 navigationaudit |1651548| new navigationcontracttests + matrix; proposals for shared resolver goMAIN |no server|
|05 responsiveshared |6045b50| shared FormActions/ui.tsx, BottomTabBar, scoped CSS if proven; no TransferReceivePage/POprice edits |5215demo only|
|06 business/security |6045b50| regressiontests/report only, no sourceRuleschanges |8080/9099/5176exclusive|
|07 E2E/visual |992f6de| e2e/r72-logistics-ux.demo.ts, fixture/config, screenshots/report only |5217demo only|

No agent writes another checkout. Branch names `r72/agentNN-*`. Reports `docs/mission/r72/agentNN-*.md`. MAIN coordinates source conflicts and final screenshots. Test-only baseline failures caused by missing Agent02/PR55 fixes are RED evidence, not an excuse to weaken assertions.

## Task01: Reuse PR55, no rewrite

Files: existing `src/lib/notificationLink.ts`, Bell/Host and focused tests as references; add R72specific tests/report.
- [ ] Inventory all transfer notification factories and IDs versus actual routes.
- [ ] Publicproductionasset/source evidence read-only; never click real notifications if that marksread or openReceiving. Reproduce actualinteraction with synthetic local fixtures; distinguish the two evidence forms.
- [ ] Exercise approval/arriving/issue/legacy/missing/denied/deleted, readstate, refresh/PWA and brand races; mutation proves assertions fail.
- [ ] Focusedtests, tsc, lint; commit verified checkpoint and report exact gaps.

## Task02: Four-row Logistics cards

File `src/pages/transfers/TransferReceivePage.tsx` (~323lines), not `Receive.tsx`.
Interfaces: preserve Transfer/ReceivedLineInput/services/checkbox semantics. Keep existing public component signature.
- [ ] Capture current21line syntheticview and make geometric/decimal/doubletap check fail first.
- [ ] Row1 checkbox44px + fullwidth identity/name/SKU; row2 sentquantity/unit/status; row3 separated48px minus/input/plus + unit, gap8px; row4 exceptions/requiredreason/inlinefeedback.
- [ ] Prevent double submission with synchronous gate covering confirmation awaits, without changing stock arithmetic or notification data.
- [ ] Test320/360/375/390/414/430 and largefont; lastrow/footer and keyboardviewport; capture before/after.
- [ ] Commit RED/GREEN and small deliverable, no unrelated redesign.

## Task03: Accept existing price feature, verify remaining requirements

Files fromPR61; no independent second resolver.
- [ ] Inspect permission/scoping/as-of/unit/source/nullvs0; verify no pricingfields reach ledgers.
- [ ] Run69focused and relevantpermissiontests with pinneddeps.
- [ ] Reuse existing1440/390images and report source provenance. No repeat implementation or accepted review unless sourcechanges.

## Task04: Wider route contract

Files: actualApp.tsx/routes, globalSearch, NAV/quickactions, activity/navigation in purchasing/stock/suppliers/calendar/history/approvals.
- [ ] Create matrix source→expectedroute→ID/query→brand→refresh/errorcase.
- [ ] Add real generator assertions (no `?? '/requests'` masking) and mutation sensitivity.
- [ ] Report small sourcefix proposals separately; do not concurrently edit Agent01 resolver.

## Task05: Shared responsive root causes

Files: sharedFormActions(ui.tsx), BottomTabBar/index.css if measured; no wholesalepage rewrites.
- [ ] Render representative11screens/modal/bottomsheet with longThai/English/SKU and decimals, widths320/375/390/414/768/1024/1440.
- [ ] Record attempted/accessed/notcovered honestly, inspect screenshots and boundingboxes.
- [ ] REDproof for shared footer/tabbar/inset defect, minimal compatible fix with unchanged interfaces; capture after.
- [ ] Keep keyboard/safearea simulations explicitly distinct from physical devices.

## Task06: Actual live-baseline business/security

Tests: transfer/rules/concurrency/receipt tests and synthetic fixtures. Reference liveapprovedRulesbytes from01bb12c:firestore.rules SHA256AE39C231...; currentfreshAPI audit is401, do not claim re-read.
- [ ] Verify exact knownRuleshash and run testconfig against those bytes in a temporarytestdirectory; never deploy or commit staleRules over it.
- [ ] Approve/dispatch/transit/partial/missing/excess/concurrent/duplicate, roles and threebrands, no crossbrand disclosure, pricingaccess and failednavigation.
- [ ] Report actual tests/counts/risks; any sourcefix goesMAIN, not self-approvedsecurityrelease.

## Task07: Test fixtures/visual invariants

Files: newdedicatedtest/config/fixture, reuse e2e/stock-transit.demo.ts browser-storage pattern; no productcode.
- [ ] Seed21rows with internalID different fromTR-00001, long bilingualnames/SKUs,1.063KG; supportedlocalstoragebackend only.
- [ ] Add screenshots/geometry for sixphonewidths; nooverlap/titlewidth/touchsize/documentwidth/lastline reachable.
- [ ] Inputprecision, doubletap, notification/legacy/invalid/crossbrand/refresh, prices/missing checks. PreserveREDs before candidateintegration.
- [ ] Safearea via supportedCDP if available, otherwise explicitcoveragegap; resizedviewport is keyboard simulation, not realOSkeyboardPASS.
- [ ] Commit harness/tests and artifactreport, keep allassertions for MAINfinalintegration.

## MAIN Integration / Closure

- [ ] Collect7 verifiedtarget/model/option receipts and record activework/LLMrequestmetadata without equating tools or requestqueue to upstream inference.
- [ ] Preserve/inspectfailedtasks before bounded recovery; no forbiddenfallback.
- [ ] Reviewsource/diffs, integrate02+05+07 onlatestmain in ownedisolation, and PR55/61 only as needed. Keep eachreleasecandidate independentlyreviewable.
- [ ] Run exactcombined unit/Rules/fourtsc/lint/i18n/build/budget and affectedE2E; fix root causes, record baselinewarnings not false0.
- [ ] Fresh allowed independentreview for changedsource; same-familyreview labeled correctly. No implementerselfapproval.
- [ ] Push reviewed branches, register newPRs, inspect remoteCI and publicPreview without Productionwrites.
- [ ] Publish Thai `docs/mission/r72/R72-LOGISTICS-UX-REPAIR.md`, all16requiredsections, actualcoverage and remainingOwnergates.

Plan self-review: seven domains mapped to the complete Ownerdirective; overlapping productcode ownership separated; requirednumericwidths/precision/21rows included. No newarchitecture/schema/modelconfiguration. NativeT3isolation only. Physical iOS/Android keyboard/OSinsets are not claimed from desktopPlaywright.
