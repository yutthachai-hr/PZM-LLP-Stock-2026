# PZM mission task board

## Latest checkpoint, 15 October 2026

Owner prioritized Orders UX and supplied reference screenshots. PR #20 is isolated on `feat/orders-ux-simplification`, final candidate `1cbcabc3b77ee279d8ec491fa53b26574c2eb6bc`. Local checks and 19/19 compiled Preview cases pass. Final-head independent OpenCode medium review and new CI are pending. Remote Preview QA is blocked by Cloudflare Access. No merge or production smoke is claimed. Exact task ID and next actions are in `orders-checkpoint.json`.

Earlier A/B/C tasks exceeded their 35-minute timeboxes without results or worktree artifacts. They were cancelled and confirmed interrupted with no pending children. Their original scope remains incomplete, owned by the coordinator for later reassignment. The historical rows below are the original plan, not active-agent claims.

## Execution checklist

- [x] Frame. Three independent slices with no shared writers. Done means each artifact has reproducible evidence, exact-SHA independent review, and all applicable release gates.
- [x] Fan out preparation. Preserve the dirty root checkout and use four sibling worktrees.
- [x] Fan out. Three approved OpenCode tasks accepted, at most three active children. Exact task IDs are in `active-tasks.json`.
- [ ] Aggregate. Inspect diffs and evidence, then assign fresh independent reviewers.
- [ ] Report. Publish verified results and blockers; continue eligible work.

The user supplied the design and explicitly requested immediate autonomous execution. Additional design/plan approval conversations are skipped under that instruction. Each worker writes a concrete local plan and executes it inline. The coordinator owns discovery, runtime configuration, review assignment, and merges, not product code.

## Verified refs

`git fetch origin --prune` completed. Remote main remains `af0136b0f6886989bc32d651a384ac05b39cdad6`. Root local main is `b6bb206ca0d5282c84d8d7d2ab18059505019e10`, with an untracked `fixes/` folder left untouched.

- exp/real-stack = `7c78201c5df6b087177b8b18e5bb131e06b8ef9b`.
- integration/ops-os-rc1 = `0261c4887cce8f64bb2d60b4ef960454891f4227`.
- Superpowers source inspection = `bb92a77741419a4ab5f06e711a283343f1ada0c3`, version 7.0.0.

## Units

| ID | Workstream | Priority | Owner/model | Branch / baseline | Tests | Review | Merge / deploy | Blocker | Next action / exit |
|---|---|---|---|---|---|---|---|---|---|
| SP | Runtime skills | P0 | Coordinator / Pi parent | External runtime config | OpenCode plugin and five required registry entries observed; real child workflow pending | Pending | No app deployment | Pi command blocked by guard | Owner runs `pi install git:github.com/obra/superpowers`; verify native skills and real Compact later |
| A17 | Release/security | P0 | A / approved OpenCode high | mission/20261014-release / af0136b | Pending | Fresh reviewer required | Not merged | Current CI/reviews unknown | Verify brand-switch recent-write regression on #17 final SHA |
| A19 | Release/localization | P1 | A / approved OpenCode high | A-owned successor branch if needed | Pending | Fresh reviewer required | Not merged | Depends on A17 integration | Resolve against current main, LINE art TH/EN and activity E2E |
| A16 | Performance | P1 | A / approved OpenCode high | A-owned successor branch if needed | Pending | Fresh reviewer required | Not merged | E2E diagnosis pending | Distinguish timing from lazy route/export/PWA defects |
| A1 | Legacy RC inventory | P2 | A / approved OpenCode high | Read-only PR #1 | Pending | Pending | Wholesale merge forbidden | Inventory incomplete | Map released features; propose small missing-feature PRs |
| B | ThaiTrees lexicon | P1 | B / approved OpenCode high | research/20261014-thaitrees / af0136b | Pending | Fresh reviewer required | Research only | License/revision/eval pending | Offline A-D same-case comparison, E only on demonstrated gap |
| C | Zero-Ops heldout | P1 | C / approved OpenCode high | research/20261014-zeroops-heldout / 7c78201 | Pending | Fresh reviewer required | Research only | Independent corpus pending | At least 240 multilingual cases, no tuning on heldout, guard unchanged |
| D | Product search | P2 | Coordinator queue | Unassigned | Not run | Not run | Not started | Depends B | Promote only verified improvement, exact/alias precedence intact |
| E | Procurement | P2 | Coordinator queue | Unassigned | Not run | Not run | Not started | A release frontier | Deterministic PR/approval/PO/supplier/receiving audit |
| F | Inventory/logistics | P2 | Coordinator queue | Unassigned | Not run | Not run | Not started | Available slot | Deterministic transactions, UOM, reconciliation |
| G | Supplier intelligence | P3 | Coordinator queue | Unassigned | Not run | Not run | Not started | Available slot | Existing metric audit, no probability claims |
| H | Database/performance | P2 | Coordinator queue | Unassigned | Not run | Not run | Not started | A16 overlap | Cache/listener/read-budget/offline audit, no cutover |
| I | Autonomous QA | P2 | Coordinator queue | Unassigned | Not run | Not run | Not started | Controlled environment | Reuse existing AI Company/Stock-La-Menia; all brands/roles |
| J | Operational UX | P3 | Coordinator queue | Unassigned | Not run | Not run | Not started | A19 overlap | Existing workflows/localization/accessibility only |
| R | Runtime reliability | P1 | Coordinator | External config | Pending | Pending | No restart | Active-session safety | Inspect supported path/fallback; rollover separate from Compact |

## Release gate ledger

No PR is approved for merge yet. PRs #17, #19, and #16 remain open at discovery. PR #18 and previous PRs #2-#15 are already merged. New head commits invalidate prior reviews. Auto-merge applies only after every user-named gate passes on the exact final head.

## Isolation and ownership

All paths are under `C:/Users/Yutthachai/`.

- Coordinator owns `pzm-mission-control-20261014/docs/mission/` only.
- A owns `pzm-mission-release-20261014/`, release fixes and evidence only; no research runtime files.
- B owns `pzm-mission-thaitrees-20261014/`, `research/thaitrees/`, associated offline tests and docs; no production search promotion.
- C owns `pzm-mission-zeroops-20261014/`, heldout fixtures, offline evaluators, tests and docs; no runtime guard/proposal changes.

## Throughput checkpoint

Three implementation/research slots. Do not run concurrent emulator suites on the same ports. Reserve emulator/E2E default ports for A; B and C use pure offline tests or explicitly unique ports. No speculative rollout while baseline or license evidence is missing. Each worker returns within 35 minutes, after which fresh reviewer or next eligible unit takes the slot.
