# R62 — Production Recovery / PR Closure / Multi-Agent

24 ต.ค. 2026 · checkpoint หลัง R63 review รอบ 2.
`origin/main = 312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55` ยังไม่เปลี่ยน.
**ไม่มี merge main, Production deploy, Firebase Rules deploy หรือ business-data write ในรอบนี้.**
การ push ไป PR สร้าง Cloudflare Preview ตามระบบเดิม ไม่ใช่ Production release.

## 1. P0-A: PR53 LINE Hotfix

| Gate | หลักฐาน / ผล |
|---|---|
| Exact HEAD | `df34558f9dfe317fb18986e5b21a35b74e575173`, PR ยัง OPEN |
| CI | 10/10 SUCCESS |
| Independent review | DeepSeek R56 APPROVE_WITH_NITS; nit แก้แล้วใน df34558 |
| Runtime diff | `vite.config.ts` 8 บรรทัด: precache app shell เป็น `/` แทน `index.html`; ไม่แก้ send flow |
| ไฟล์สนับสนุน | test/server/config/CI/gitignore รวม PR 6 ไฟล์ ไม่ใช่ runtime send feature ใหม่ |
| ทดสอบซ้ำบน exact HEAD | SW browser E2E 3/3: shell entry หาย, cache ทั้งหมดหาย, offline มี shell |
| Preview ปัจจุบัน | `https://9789240e.pzmstock.pages.dev`, authenticated HTTP200, sw.js HTTP200 และ `createHandlerBoundToURL("/")` |
| Production ปัจจุบัน | Pages deployment `cbbec765-efaa-4db6-b191-09a99f375084`, main312f8a7; sw.js ยัง `createHandlerBoundToURL("index.html")` |
| Rollback | deployment เก่าข้างต้นยังมีใน Pages deployment list และเป็น live production |
| Phone LINE / old SW recovery / duplicate send จริง | ยังไม่ผ่าน Production smoke; ต้องปล่อยหลังอนุมัติและทดสอบกลุ่มเฉพาะ |

**Technical release package พร้อม; RELEASE_GO แบบไม่มีเงื่อนไขยังไม่ประกาศ.**
ขอ Owner อนุมัติ controlled merge/deploy **เฉพาะ #53 ที่ SHA df34558** พร้อมยอมรับว่า phone smoke
ต้องทำหลัง deploy (LIFF preview hostname ใช้ส่งจริงไม่ได้). ห้ามรวม #52/#54/#55 ในอนุมัติเดียวโดยปริยาย.

หลังได้รับอนุมัติ: merge #53 เท่านั้น → ยืนยัน Pages production SHA/deployment และ sw.js ใหม่ →
มือถือเดิมเปิด LINE return URL → ส่ง synthetic PO ไปกลุ่มทดสอบครั้งเดียว → ตรวจยกเลิก picker
ไม่กลายเป็น sent → ปิด/เปิดซ้ำและทดสอบเครื่องที่ติด SW เก่า. ถ้าไม่ผ่านหยุดและ rollback deployment
`cbbec765...`; จากนั้น revert merge ผ่าน PR ปกติ (ไม่ force-push).

หลักฐานรอบนี้: `pr53-sw-exacthead.log`, `pr53-preview-recheck.json`.
R58/R59 มีหลักฐาน main ERR_FAILED เทียบ fixed-preview200 เดิม; ไม่อ้างว่า Production ซ่อมแล้ว.

## 2. P0-B: R61 Logistics

- Proven ใน Emulator: active Admin สร้าง `<brand>locations/transit` ด้วย `type='transit'` ถูกปฏิเสธ
  เพราะ `validLocation` รับเฉพาะ warehouse/branch. ทั้ง pizza/lelapin/rnd ถูกปฏิเสธเหมือนกัน.
- PR54 `01bb12c` (Rules commit `feb3c9c`): อนุญาต transit ที่ domain รองรับ, canonical id transit
  ต้อง type transit, imported transit id อื่นยังใช้ได้; active-admin-only ไม่เปลี่ยน.
- RED9/14 → GREEN14/14; Rules251/251 รวม budget; unit1719/1719; transit E2E13/13;
  type/build/lint/i18n ผ่าน. Gemini APPROVE_WITH_NITS (P3 ไม่ block Rules release).
- Exact PR54 HEAD CI10/10 ผ่าน.
- UI ไม่กลืน permission error, ไม่แสดง off เมื่อไม่รู้สถานะ, success เมื่อ re-read type ถูกต้องเท่านั้น.
- **Production root cause ยัง LIKELY ไม่ CONFIRMED**: Firebase CLI login หมดอายุ การ GET active
  Rules ล้มเหลว; ยังไม่มี active Rules rollback copy, ยังไม่ตรวจ rejected production operation หรือ
  live Admin.active ด้วยบัญชีจริง. `.firebaserc` ระบุ `pzm-stock-x5` ไม่ใช่หลักฐาน deployed Rules.

**BLOCKED_FOR_RULES_DEPLOY:** ต้อง reauthenticate → อ่าน/เปรียบเทียบ/save active Rules → approval
ก่อน deploy Rules-only จาก approved SHA. **Rules ก่อน app merge** เพราะ main merge auto-deploys.
ห้ามใช้ main312f8a7 แทน live rollback โดยไม่ compare: อาจทับ security change ที่ยังไม่ทราบ.
รายละเอียด `../r61/R61-LOGISTICS-HOTFIX.md` (แก้ลำดับ release จากรายงานเก่าแล้ว).

### ป้องกัน PR51 / PR1 / G25 ทับ fix

PR51 มี cherry-pick fix+regression ที่ **634edd7bb18229dad2689cf3d0cfacda8a4531de** แล้ว,
combined Rules305/305, Gemini confirmation **APPROVE**, exact-head CI10/10.
PR51 ยังเป็น Rules-first/App-second release window แยก ต้อง approval ของตัวเอง.
PR1 `firestore.transition.rules` ยังเก่า: ห้ามนำไป deploy; ตอน extract G25 ต้อง port invariant นี้
และรัน transit regression กับ Rules ทุกไฟล์ที่จะปล่อย ไม่ใช่ดูเฉพาะ firestore.rules หลัก.

## 3. Strict Subagent Policy / Guard Retirement

| รายการ | ผลตรวจจริง |
|---|---|
| Forbidden Subagent Calls Detected | พบ R60-H Codex reachability probe `r60h-codex-probe-1` เมื่อ 07:44:15Z เป็น **Policy Violation ตาม Owner R62**; ห้ามเรียกซ้ำ/ห้าม rename เป็น MAIN probe |
| Forbidden Workers Stopped | ไม่มี forbidden child ที่ running/queued ณ จุดตรวจ; probe completed ไม่มี pending child runs; เรียก task_cancel เพื่อไม่ให้มี later queued work ถูก resume |
| ประวัติเก่าอื่น | state เก่ามี completed Claude2 และ failed GPT/Codex6 จากก่อน R62; ไม่ใช่ active worker และไม่ resume |
| Allowed Worker Pool | manual Gemini → available DeepSeek → available GLM → qualified/restricted Qwen; ไม่ใช่ custom runtime allow-list ใหม่ |
| Gemini Readiness | T3 read/write fixture PASS; coding qualification RED1/GREEN2 และ clean worktree PASS; reviews PR33/PR29/R61/R63 ทำงานจริง |
| Actual provider/model | T3 `opencode / 9router/gemini-3.8-flash-high`; OpenCode assistant metadata ตรง `providerID=9router`, `model.id=gemini-3.8-flash-high` (`provider-evidence.jsonl`) |
| Router upstream | config map เป็น `ag/gemini-3.8-flash-high`; ไม่อ้างพิสูจน์ upstream weights เกิน routing evidence |
| MAIN Model Unchanged | MAIN ยัง Pi Claude, เลือกเดิม; ไม่มีการเปลี่ยนเป็น Qwen/Codex. Account rotation ของ Claude ไม่ใช่การสลับ MAIN family |
| Custom Guard Disabled | YES: พบ supported Pi resource exclusion และ T3 restart ก่อน agent รอบนี้; ไม่ได้ให้ agent ปิด guard ที่ active; session ใหม่ยอมรับ Gemini ที่ policy เก่าห้าม |
| Native Permissions | T3 native hook ยังมี tool_call permission handling; runtime full-access ทำงาน. ไม่ได้ปิด hook/ใช้ --no-extensions และไม่ได้อ้างว่าได้ทดสอบ denial mode ทุกแบบ |
| Auto Dispatch / Hybrid Failover | ไม่เปิด; task ทุกตัวที่สร้างในรอบนี้ระบุ target ด้วยมือ, recurring scheduled_tasks=0. ไม่มี silent fallback |
| Resource limit | สูงสุด 2 hosted workers พร้อมกัน, local GPU worker0; coding ใช้ isolated worktrees |

### Actual routing/configuration

- `~/.pi/agent/settings.json`: exclusion `-extensions\\t3-delegation-guard.ts` ใน JSON (ค่าที่อ่านได้
  เป็น `-extensions\t3-delegation-guard.ts`). Guard เดิมมาจาก global auto-discovered extension directory
  ไม่ใช่ package/project; project ไม่มี `.pi` override. ไม่ติดตั้ง Stage1/R60-G/R60 guard patches.
- Source guard SHA256 `4c19209556fd7cf8838c2b3aadb892e374db962f5bff1d46c496ef1f2ca4171b` และ policy
  `0950a352127e7077e4b7fa3b07edbe091c3c86e04af85d1a43fc09c23b5fdb52` ตรง backup ไม่ถูกแก้/ลบ.
- `~/.t3/caches/pi-t3-mcp-extension.ts` native permission hook คงเดิม.
- `AGENTS.md`: บันทึก strict GPT/Codex/Claude child ban (รวม probes), MAIN backup-only Codex,
  explicit manual routing และ local restriction. เก็บ Owner R43 เดิมพร้อมคำอธิบาย R62.
- `~/.agents/pstack-models.md`: เอา Codex/Spark/Qwen-cloud role defaults เก่าออก; delegated roles
  เป็น Gemini; inherit-parent หมายถึง MAIN ทำเอง ไม่ spawn child.
- `~/.config/opencode/opencode.jsonc`: default build/plan/general/explore เป็น Gemini อยู่แล้ว;
  เอา explicit `cc/claude-*` aliases เก่าออก; title/summary/compaction local Qwen เดิมไม่เปลี่ยน MAIN.
- T3 capabilities ที่ตรวจไม่มี separate MAIN/subagent-pool restriction ให้ตั้ง: ใช้ **manual explicit
  model selection** เท่านั้น. การลบ aliases ไม่ใช่ global ban enforcement บนทุก provider; agent ต้อง
  reject forbidden target ก่อน dispatch และตรวจ execution metadata หลัง dispatch.
- ไม่สร้าง guard/allowlist ใหม่. โมเดล local ยังไม่รับ unrestricted repo tools; qualification ของ
  Gemini ไม่ได้ให้สถานะ AGENT_READY แก่ Qwen.

### Backup / rollback config

`~/.pi/agent/backups/r60h-guard-retire-20261024/` เก็บ settings/source/policy และ snapshots AGENTS
ก่อนแก้. `pstack-models.md.bak-r62-20261024`, `opencode.jsonc.bak-r62-20261024` เก็บ routing ก่อนแก้.
Owner rollback guard ได้จาก `pi config` (Personal resources → enable เฉพาะ guard → restart) แต่เป็น
การย้อนการตัดสินใจ retirement ต้องสั่งใหม่โดยชัดแจ้ง; ห้าม agent เปิดเองหรือคืน routing GPT child.
Rollback อื่นต้องเก็บ strict R62 ban ไว้ ไม่คืน banned defaults โดยไม่ตรวจ.

## 4. PR Closure Board

CI snapshot ดู `pr-status.json`; HEAD เปลี่ยนเมื่อใดต้องตรวจ exact-head ใหม่.

| PR | Source HEAD | CI / review / QA | สถานะ / Next |
|---|---|---|---|
| #53 | df34558 | CI10/10; DeepSeek; real Preview200; SW3/3 | ขออนุมัติ controlled release + phone smoke |
| #54 R61 | 01bb12c | CI10/10; Gemini approve+nits; Rules251/251 | BLOCKED live Rules comparison/backup + Rules approval |
| #55 R63 | 62fa3ba | CI10/10; Gemini R2 APPROVE; browser14/14; real Preview PASS | READY_FOR_RELEASE_APPROVAL หลัง #53 แยกปล่อย |
| #33 | 7c0505d | CI10/10; Gemini R2 APPROVE; unit1739/1739; concurrency E2E3/3 | baseline เจ้าของอนุมัติแล้ว; รอ release approval |
| #29 | b850d3a | **CI10/10**; Gemini R2 APPROVE; scanner E2E10/10; full unit1792/1792 | physical scanner QA400ms cadence ก่อน release |
| #52 | d785ae8 | CI10/10; GLM reviewเดิม | real-device LINE QA หลัง #53; A2 แยกจาก #52 |
| #51 | 634edd7 | CI10/10; combined Gemini APPROVE; Rules305/305 | Rules-first/App-second approval แยก; transit fix อยู่แล้ว |
| #39 | 75bf9f4 | CI10/10; DeepSeekเดิม; fixture31 rows | ยังขาด isolated staging OCR write-path; 3 missing-qty rows ต้องไม่เข้า stock |
| #45 | policy/report commit f38e317 (ตามด้วยเอกสาร checkpoint เท่านั้น) | docs-only; owner uncommitted AGENTS backup/protected | policy Gemini APPROVE; ส่วน Agent skills ยังอยู่; exact docs-head CI ต้องรอ |
| #24 | 330e312 | baseเก่า/conflicting; reconciliationเดิม | ยังไม่ extract: drag-drop/type-list port บน current importReview หลังจัด dependency#39; ไม่ปิดก่อน port |
| #19 | aee0968 | baseเก่า/conflicting; reconciliationเดิม | ยังไม่ extract: artwork/context wording residual; ไม่ปิดก่อน port |
| #1 | 4898dbb | giantRC/conflicting; old CI19 ไม่ใช่ current-main proof | ห้าม merge; extract Security/Integrity และ R&D เป็น PRเล็ก; G25 Rulesต้องมี transit invariant |
| #46 | 0f7d035 | CI10/10เดิม | **OWNER_HOLD คงเดิม** ไม่เปิด experimental receiving |

### PR33 adjudication ที่สำคัญ

Reviewer R1 เสนอ refresh monthly sheet หลัง conflict โดยกังวล repost chunk. ตรวจ service พบว่า
`postedIds` ถูกกรองใน transaction อยู่แล้ว และ regression ทดสอบ stale retry ยืนยัน movement ไม่ซ้ำ.
การ refresh ที่เสนอทำให้ emulator E2E ช่องนับ16กลายเป็นว่าง (RED1/3). MAIN ไม่รับข้อเสนอนั้น,
คืน early return เดิม → E2E3/3; Gemini R2 เห็นด้วย. CSV re-import reset baseline เป็น bugจริง
แก้แล้ว รวม empty row ที่ต้องจับ baseline ครั้งแรกและ legacy row ที่ต้องยืนยันเอง.

### Worker failure / งานที่ยังทำต่อได้โดยไม่ต้องรอ Owner

PR29 coding worker HTTP502 กลางงาน: เก็บ partial patch `pr29-partial-502.patch` และ checkout เดิม,
MAIN ตรวจ diff/ทำต่อ; ไม่มี retry/silent fallback ไป forbidden model.
A2 Gemini isolated implementation หยุดด้วย **HTTP502** เช่นกัน; task terminal failed และไม่มี
pending child runs. MAIN ตรวจพบ 6 tracked files ที่แก้และ 1 endpoint ใหม่ยัง untracked; HEAD ยัง
`312f8a7` ไม่มี commit/push จาก worker. เก็บ tracked binary patch พร้อม untracked endpoint ใน
`a2-502-backup/` (local evidence) และคง worktree `t3-abb9af93` ไม่ reset/ลบ.
Focused pure/endpoint tests ที่ MAIN รันได้ **126/126 ผ่าน** แต่ยังไม่ใช่ feature complete:
`markSupplierRequested` มีเพียง definition ไม่มี caller; SendWizard และ SupplierConfirmationPanel
ยังเรียก supplierLink แบบเดิม. ห้ามนำ partial patch ไปปล่อย เพราะ prepare/send/request integration
ยังไม่ครบ. ต้องทำ caller wiring + cancel/success/version/brand tests และ independent review ต่อ.
ไม่มี retry/silent fallback ไป GPT/Codex/Claude. local scaffold `ddcd495` เดิมเก็บไว้เช่นเดิม. งาน extract #1/#24/#19 ยังไม่เสร็จ ไม่ใช่ Owner approval
blocker ปลอม; เป็นงาน dev ถัดไปตาม dependency ไม่ปิด PR ทิ้งเพื่อให้ board ดูสะอาด.

## 5. เฉพาะสิ่งที่ต้องใช้ Owner จริง

1. อนุมัติ controlled **merge/deploy PR53 SHA df34558 เท่านั้น** และทำ/จัด real-phone LINE test group
   เพื่อยืนยัน one-send/cancel/old-SW recovery. ไม่มี token/password ต้องส่งใน chat.
2. Run `firebase login --reauth` ภายนอก session เพื่อให้ MAIN อ่าน active Rules/เก็บ rollback ได้;
   หลัง compare/reviewสำเร็จ ต้องให้ **Production Rules Deployment Approval ของ R61** แยก.
3. หลัง #53 เสถียร ให้ release approvals แยก #55/#33/#45 และ release window Rules-first ของ #51;
   routine push/test/review ไม่ต้องขอซ้ำ. #29 ต้อง physical scanner QA จริง (USB/Bluetooth, Enter/Tab,
   leading zero, case, duplicates/inactive, IME,400ms calibration). #52 phone testหลัง #53.
4. จัด isolated staging Firebase/OCR access สำหรับ #39 เมื่อยังไม่มี; ห้ามใช้ production write-path
   เป็นที่ทดลอง31แถว. MAIN เตรียม fixture/config ได้โดยไม่ขอ deployเอง.

ไม่ต้องให้ Owner apply guard patches, เพิ่ม allowlist,เปิดAutoDispatch,หรือเรียก forbidden probe.

## 6. Rollback และขอบเขตที่ไม่อ้างว่าตรวจแล้ว

- App: rollback Pages ไป last approved production deployment + revert PR merge ตามปกติ.
- R61/PR51 Rules: ใช้ **active Rules rollback copy ที่อ่านก่อน deployจริง**; ตอนนี้ยังไม่มี จึงห้ามปล่อย.
- ไม่มี stock/business-data writes ที่ต้อง reverse ในรอบนี้; emulator/browser fixtures ไม่ใช่ production.
- Guard/source/policy/backups เก็บครบ; root worktree ยังมี Owner files เดิม ไม่ stash/reset/delete.
- ยังไม่ตรวจ real LINE phone smoke, actual production rejected operation/Admin.active และ production
  Rules version; ไม่ประกาศ Production fixed. Preview/tool checks ไม่ทดแทน device/release approval.

## 7. Skill reporting (MAIN)

| Skill / loaded path | โหลด | ทำจริง / สิ่งที่ข้าม |
|---|---|---|
| tdd — `~/.agents/skills/tdd/SKILL.md` | yes | R61/R63 unit+browser RED→GREEN; PR33 empty-import RED→GREEN; PR29 IME browser RED→GREEN |
| ponytail — `~/.pi/agent/npm/node_modules/@dietrichgebert/ponytail/skills/ponytail/SKILL.md` | yes | read callers/diff, reuse existing backend/UI, no new dependency/schema/guard; physical calibrationไม่ตัด |
| receiving-code-review — `~/.pi/agent/git/github.com/obra/superpowers/skills/receiving-code-review/SKILL.md` | yes | ตรวจข้อเสนอจริง; ปฏิเสธ monthly refresh ด้วย failing E2E; แก้ R63 trailing slashจากRED |
| systematic-debugging — Superpowers `skills/systematic-debugging/SKILL.md` | yes | trace PDF timeouts vs code changes; isolated/bounded rerunไม่เปลี่ยนtimeout; trace stale-sheet regression |
| principle-prove-it-works — `~/.agents/skills/principle-prove-it-works/SKILL.md` | yes | ตรวจ browser/previewจริง, exactSHA/CI, Rules emulator; liveRules/deviceถูกระบุblocked ไม่ใช้proxyแทน |
| verification-before-completion — Superpowers `skills/verification-before-completion/SKILL.md` | yes | test/build/diff gates; เก็บfailedruns ไม่อ้างว่า pass ทุกครั้ง |
| blast-radius — `~/.agents/skills/blast-radius/SKILL.md` | yes, partial | พิสูจน์namespace/invalid destinationไม่writeผ่านจริง; ไม่ทำmulti-model arena/why historyเต็ม เพราะ bounded hotfix; ไม่อ้างcomplete skill workflow |

หลักฐานเต็มใน mission r61/r62/r63 logs; ส่วนที่เป็น credential/session cookie ไม่ถูกเผยแพร่.
Final software checkpoint: #29/#33/#51/#53/#54/#55 exact source heads ด้านบน CI10/10.
#45 policy ที่ `f38e317` ได้ Gemini **APPROVE** (P3 wording nit ที่ไม่ block); ไม่เปลี่ยน policy code
หลัง review มีเพียงเอกสาร checkpoint. Exact-head docs CI ต้องตรวจใหม่เมื่อเอกสารขยับ SHA.
A2 `r62-a2-implementation-1` terminal **FAILED HTTP502**; partial work preserved, development
และ independent review ยังไม่จบ. ไม่มี worker ตัวนี้ค้างหรือมี forbidden fallback.
