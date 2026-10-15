# Humanizer verification, 15 Oct 2026

Installed at `C:/Users/Yutthachai/.agents/skills/humanizer/SKILL.md`, version 3.1.0, MIT, source `blader/humanizer` (skill lock folder hash `225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8`, installed 04:20Z). Not reinstalled.

## Discovery

| Runtime | Evidence | Result |
|---|---|---|
| Pi parent session (thread 6bea2b8e) | `humanizer` is in the session's native skill list at the path above. SKILL.md was read in full and used for the PR #22 evidence README | Discovered and loaded |
| OpenCode registry | `MSYS_NO_PATHCONV=1 opencode api GET /api/skill` returned 126 skills, `humanizer` at the path above, beside Superpowers `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `executing-plans` and Pstack `tdd`, `interrogate` | Discovered |
| OpenCode child session | Runtime audit task `pzm-runtime-failover-audit-20261015-r1`, OpenCode session `ses_ec15d3440ffehrZiM5p2ltIc42`: saved messages contain native `skill` tool input `{"id":"humanizer"}`; returned Thai/English copy preserves `฿350.2203`, `KG`, `PZS-01-06-001` | Discovered and invoked after quota reset (15 Oct, ~08:20Z) |

Superpowers and the delegation guard were not changed. Pi Superpowers is now listed natively in this parent session from `~/.pi/agent/git/github.com/obra/superpowers` (owner install). Survival across a Pi Compact has not been observed yet.

## Rewrite test

Patterns applied: §8 (dash as connector) in both languages, and a plainer verb in English. A regex token check compared every number, currency amount, unit, placeholder and document code before and after.

| Case | Before | After | Tokens unchanged |
|---|---|---|---|
| Thai UI warning, `src/i18n/en.ts:2451` key | ไฟล์นี้เคยนำเข้าแล้ว หรือเป็นไฟล์เก่ากว่ายอดนับที่มีในระบบ — ลงย้อนหลังจะทำให้ยอดนับที่ใหม่กว่าไม่ตรง | ไฟล์นี้เคยนำเข้าแล้ว หรือเก่ากว่ายอดนับที่มีในระบบ ถ้าลงย้อนหลัง ยอดนับที่ใหม่กว่าจะไม่ตรง | yes (none present) |
| English UI warning, same line value | This file was imported before, or is older than a count already on record — filing it behind that count would put the newer count out | This file was imported before, or is older than a count already on record. Filing it behind that count would make the newer count wrong. | yes (none present) |
| Bilingual toast TH, PR #21 | บันทึกราคาแล้ว / ฿350.2203 ต่อ KG | unchanged | yes: `฿350.2203`, `KG` |
| Bilingual toast EN, PR #21 | Price saved / ฿350.2203 per KG | unchanged | yes: `฿350.2203`, `KG` |

Both warnings keep their meaning. The file was imported before or is older than a count on record, and filing it back-dated breaks the newer count. The warning stays a warning, and the conditional ถ้า keeps the consequence explicit in Thai. The toast had no AI pattern, and Humanizer correctly left it alone. In Thai the only tell found was the dash used as a connector. Thai sentences already separate clauses with a space, so the dash was simply dropped.

No UI text was changed in a PR. The i18n keys are the Thai strings, so a rewrite renames a key across every locale and test that uses it. Such rewrites belong to backlog J (UX writing and localization) with Humanizer in the loop.

## Workflow policy

Humanizer is invoked on demand for UI copy, toasts, notifications, form instructions, Zero-Ops replies, documentation, release notes and PR summaries. It must not rewrite code, SQL, product IDs, SKUs, document numbers, prices, quantities, units, calculations, schemas, API contracts, audit logs, business rules, approval decisions, or security text whose exact wording matters. Warnings, prohibitions and required actions stay explicit. Superpowers governs engineering process. Humanizer supports writing and is not a reviewer.
