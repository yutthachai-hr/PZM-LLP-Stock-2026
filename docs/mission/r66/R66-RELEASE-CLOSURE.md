# R66 — Release Execution & PR Closure

วันที่ 24 ต.ค. 2026 · MAIN: Pi Claude (Opus 5.5) หลังสลับจาก Codex · subagent: Gemini เท่านั้น (DeepSeek free = quota หมด)

**สถานะ Production ตอนจบรอบ:** `main` = `312f8a7` · Cloudflare production = `cbbec765` (312f8a7) ·
Firestore Rules live = ruleset `80b1cd17` (raw `eee07cf8…`) · **ไม่มี merge / deploy / Rules deploy / business write ในรอบนี้**
เพราะยังไม่มีคำอนุมัติ release จาก Owner — ทุกงานที่ทำได้โดยไม่ต้องอนุมัติ ทำครบแล้ว

## 1. Owner ต้องทำอะไร (เรียงตามลำดับ release)

| # | สิ่งที่ Owner ตอบ/ทำ | MAIN ทำต่อทันที |
|---|---|---|
| A | ตอบ: **"อนุมัติ Release A: PR54 Rules-only → pzm-stock-x5, candidate ae39c231"** | อ่าน live ซ้ำ (ต้องยังเป็น 80b1cd17/eee07cf8 ไม่งั้นหยุด) → deploy Rules อย่างเดียว → อ่านกลับผ่าน API ต้องได้ `ae39c231…` → ถ้าไม่ตรง rollback ทันที |
| A' | หลัง A: เข้าแอปด้วยบัญชี Admin → ตั้งค่า → โลจิสติกส์ → เปิดสถานะ "ระหว่างขนส่ง" (เขียน config ไม่ใช่ยอดสต๊อก) | บันทึกผลว่าบั๊กเดิมหาย |
| B | ตอบ: **"อนุมัติ Release B: merge PR53 df34558"** + นัดเวลาทดสอบมือถือ 15 นาที | mark ready → merge → รอ Cloudflare deploy → `verify-prod-sw.cjs` ต้อง PASS → นำ Owner ทดสอบ LINE ด้วย PO ทดสอบ |
| B' | บนมือถือจริง: เปิดผ่าน LINE → ส่ง PO ทดสอบเข้ากลุ่มทดสอบ (ไม่ใช่ผู้ขายจริง) ตาม runbook `agent02-line-pwa.md` | ตรวจว่าไม่ส่งซ้ำ / สถานะ sent ถูก / ไม่มี ERR_FAILED; ถ้าพัง rollback |
| C | ทดสอบเครื่องสแกนจริงตาม checklist 8 ข้อใน `agent05-barcode.md` และจดยี่ห้อ/รุ่น/โหมด (Enter/Tab) | บันทึกผล ปลด/คง hold PR29 |
| D | เลือกทางสร้าง staging ให้ PR39 (ข้อ 6) | ทำ OCR QA ตาม matrix |
| E | ตัดสินว่า PR55 ใช้ review ของ Gemini (separate-agent) ได้ หรือรอ cross-model (DeepSeek/GLM quota) | merge ตามที่ตัดสิน |

ไม่ต้อง `firebase login` ซ้ำ — official API ใช้ได้อยู่ (ตรวจแล้ว 11:00Z)

## 2. Wave 0 — เก็บงานทั้งหมดแล้ว (ไม่มีอะไรถูกลบ/ reset/ push ทับ)

- Bundle ทุก local branch + tag 4 detached head: `C:/Users/Yutthachai/r64-backup/r66-preserve-20261024/all-local.bundle`
  SHA256 `aad062bd7744e89e4530bbbb42ad684ce9f33ab5f7145ef0ef02165fac72ca3a` · `git bundle verify` OK · 154 heads
- งานที่ยังไม่ commit ของ 44 worktree: `dirty/<ชื่อ>.patch` + `<ชื่อ>.untracked.tgz` · รวม 187 MB · `SHA256SUMS` 121 ไฟล์
- Tag ใหม่ (local เท่านั้น): `r66-preserve/detached-{237219c,25c99c4,94c5650,e9f7014}`

### Local-only commits ที่เกี่ยวกับรอบนี้ (ห้ามหาย)

| Commit | Worktree / branch | คืออะไร | สถานะ |
|---|---|---|---|
| `682b1aa` | `pzm-r66-a2` / `fix/20261024-a2-request-on-send` | **A2 code** (บน PR52) | REVIEW (ข้อ 5) → push เมื่อผ่าน |
| `d0d4ab2` `e0d4803` | `t3-4ad1cf69` / `extract/20261024-pr19-i18n-audit` | PR19 extraction: i18n audit + report | REVIEW (ข้อ 7) |
| `2d96cd8` | `t3-484f9517` / `t3/r64-backlog-feature-extraction` | PR24 drop-file routing | HOLD จน PR39 ตัดสิน (ข้อ 7) |
| `7f8ae9f` `4475ba2` | `t3-79580d7e`, `t3-a002b7df` (detached) | review report PR55/PR33 | คัดลอกเข้า PR56 แล้ว |
| `433804d` `39f722e` `a74d620` `c612961` `569d2c8` `c3e7fd4` | R64 agent worktrees | R64 reports | อยู่ใน PR56 แล้ว |
| `66af84e` `e59d3c6` `f6706c7` | R64 agent worktrees | merge-only (ไม่มี code ใหม่) | ไม่ต้อง push |
| `294d337` | `t3-36c9a650` | PR33 รุ่นเก่า (refresh sheet ที่ถูกปฏิเสธ) | superseded, อยู่ใน bundle |
| `ddcd495` + uncommitted `t3-abb9af93` | A2 รุ่นก่อน (GLM / Gemini 502) | superseded โดย `682b1aa` | อยู่ใน bundle/patch |
| uncommitted `t3-fcfd7039` | partial บน PR29 หัวเก่า `cbdc8a5` | superseded โดย `b850d3a` | อยู่ใน patch |

branch เก่าอีก ~60 อัน (R13–R47) มี local-only commit — อยู่ใน bundle ครบ ไม่ได้แตะ

## 3. Closure Board — PR ที่เปิดอยู่ 14 + A2

| PR | HEAD | Review | CI | QA | ขึ้นกับ | พร้อม release | merge/deploy จริง | Blocker | ขั้นต่อไป |
|---|---|---|---|---|---|---|---|---|---|
| #54 Rules transit | `01bb12c` | R64 Gemini security APPROVE (cross-model) | 10/10 | Rules 251/251, transit 14/14, live recheck R66, server compile 0/0 | — | **READY_FOR_RULES_DEPLOY** (Release A) | ไม่มี | คำอนุมัติ Owner | Owner ข้อ A |
| #53 SW hotfix | `df34558` | DeepSeek APPROVE (R56) + R64 Gemini verify | 10/10 | SW e2e 3/3, Preview 9789240e, prod verifier RED→local GREEN | — | **READY_FOR_OWNER_HOTFIX** (Release B) | ไม่มี (draft) | คำอนุมัติ + มือถือ | Owner ข้อ B |
| #55 notification | `f301f39` | R66 Gemini ใหม่ **APPROVE** (separate-agent); cross-model **ค้าง** (DeepSeek quota) | 10/10 | unit 1781, browser 17/17, Preview d0b7e87f | — | REVIEW_PENDING (cross-model) | ไม่มี | ไม่มี reviewer ต่าง family ที่มี quota | Owner ข้อ E |
| #52 LINE send | `d785ae8` | GLM APPROVE_WITH_FOLLOWUPS (R57) + R64 verify | 10/10 | send 45 + PO 61, line-send e2e 46/46 (R66 บน A2) | #53 | BLOCKED: มือถือจริง | ไม่มี (draft) | หลัง #53 เสถียร | Owner ข้อ B' แล้ว device QA |
| **#57 A2** (ใหม่) | `297124f` | Gemini cross-model **APPROVE** ทุก commit (`682b1aa`, `3b513ca`, `297124f`) | **10/10** (ครั้งแรก e2e FAIL 2 จากเทสเก่าที่ยืนยันบั๊ก → แก้แล้ว) | unit 1763, emulator 237, test:e2e 90, line-send 54, configs ทั้งหมด | #52 | READY หลัง #52 (ต้อง retarget main + CI ใหม่) | draft ฐาน #52 | ต้องรอ #53→#52 | ดู `docs/mission/r65/R65-A2-RECOVERY.md` |
| **#58 i18n audit** (จาก #19) | `e0d4803` | Gemini separate-agent APPROVE | **10/10** | 3/3, full 1717 | — | READY (dev tooling, gate เข้มขึ้น) | draft | คำอนุมัติ merge | merge ได้หลัง Release B |
| #51 void reason | `634edd7` | Gemini combined APPROVE | 10/10 | Rules 305/305 | #54 | OWNER_HOLD (Release E แยก) | ไม่มี | อนุมัติแยก | rebase หลัง #54 แล้วรัน Rules ใหม่ |
| #33 count lock | `7c0505d` | R66 Gemini ใหม่ **APPROVE** (cross-model, code โดย MAIN) + R62 | 10/10 (ฐาน main) | concurrency 3/3, unit 1739, focused 95 | — | **READY_FOR_OWNER_RELEASE** (Release F) | ไม่มี | คำอนุมัติ merge | merge window หลัง B |
| #29 barcode | `b850d3a` | R62 Gemini R2 APPROVE + R64 verify | 10/10 | scanner e2e 10, focused 92 | — | BLOCKED: เครื่องสแกนจริง 400ms | ไม่มี | อุปกรณ์จริง | Owner ข้อ C |
| #39 OCR | `75bf9f4` | DeepSeek (เดิม) + R64 Gemini verify | 10/10 | fixture 31/31, 147 focused, Preview 503 preview_isolated | staging | BLOCKED: ไม่มี staging | ไม่มี | infra + credential | Owner ข้อ D |
| #45 docs skills | `3fe883f` | policy Gemini APPROVE | 10/10 | docs | — | READY (docs-only) | ไม่มี | คำอนุมัติ | AGENTS.md ใน PR = ของ Owner + ส่วน skills ต่อท้าย (ไม่ทับของ Owner) |
| #56 R64 reports | `e31e032`→(R66) | docs | 10/10 | — | — | READY (report-only) | ไม่มี | คำอนุมัติ | เพิ่มรายงาน R66 แล้ว |
| #46 R25 batching | `0f7d035` | — | 10/10 | — | — | **OWNER_HOLD** | ไม่มี | Owner | คงไว้ |
| #24 smart import | `330e312` | — | conflicting | `2d96cd8` แยกได้บางส่วน | #39 | FIX_REQUIRED | ไม่มี | ต้องรอ PR39 (PDF ≤20MB) | rebase `2d96cd8` ให้ใช้ `MAX_LOCAL_PDF_BYTES` + เทส 2.9–20MB แล้วเปิด PR |
| #19 LINE i18n | `aee0968` | — | conflicting | audit แยกออกเป็น #58 แล้ว | #52 (artwork) | FIX_REQUIRED | ไม่มี | ส่วนที่เหลือผูกกับ #52 | แยก artwork หลัง #52 · คำกิจกรรมตามบริบท |
| #1 RC | `4898dbb` | — | conflicting | — | — | **ห้าม merge** | ไม่มี | giant RC | แตกเป็น PR เล็กตาม R64 outline; Rules ใหม่ทุกชุดต้องคง invariant transit ของ #54 |

## 4. Wave 1 — Release A (PR54 Rules-only): READY_FOR_RULES_DEPLOY

ตรวจซ้ำ 11:00Z ผ่าน official API (ไม่ deploy):

| ตรวจ | ผล |
|---|---|
| live release | `projects/pzm-stock-x5/releases/cloud.firestore` → ruleset `80b1cd17-…` update `2026-10-08T07:00:45.266800Z` (เหมือน R64) |
| live source | raw `eee07cf8…` = backup R64 byte ต่อ byte · LF-normalized `bdc5bfad…` = main |
| candidate | `ae39c231…` = blob `firestore.rules` ที่ `01bb12c` · ต่างจาก live แค่ `validLocation()` (บรรทัด transit) |
| server compile (`projects:test`, ไม่สร้าง/ไม่ release อะไร) | candidate HTTP 200 · error 0 · warning 0 · rollback HTTP 200 · 0/0 |
| config | `candidate/firebase.json` และ `rollback/firebase.json` มีแค่ `firestore.rules` · `--project pzm-stock-x5` ระบุชัด · ไม่มี PR51 |
| archive | `r61b-rules-package-20261024.tgz` SHA256 `d41dc840…` ครบ 13 ไฟล์ · `verify-rules-package.cjs` PASS |

เลือก `projects:test` แทน `firebase deploy --dry-run` เพราะ dry-run ของ firebase-tools 15.24.0 เรียก `createDatabase()` ซึ่งจะ **สร้าง database** ถ้า GET ได้ 404

**คำสั่งหลังได้รับอนุมัติ (ยังไม่ได้รัน):**
```sh
node docs/mission/r66/tools/read-live-rules.cjs pzm-stock-x5 docs/mission/r66/live-rules-before-deploy   # ต้องยังเป็น eee07cf8
npx --no-install firebase deploy --only firestore:rules --project pzm-stock-x5 --config docs/mission/r64/candidate/firebase.json
node docs/mission/r66/tools/read-live-rules.cjs pzm-stock-x5 docs/mission/r66/live-rules-after-deploy    # ต้องได้ ae39c231
# rollback: --config docs/mission/r64/rollback/firebase.json แล้วอ่านกลับต้องได้ eee07cf8
```
ตรวจสิทธิ์หลัง deploy โดยไม่แตะยอดสต๊อก: hash ที่อ่านกลับ = candidate ซึ่งผ่าน 251 เทสใน emulator แล้ว + Owner ข้อ A'

## 5. Wave 7 — A2 เสร็จ (code + เทส) รอ review

**บั๊ก:** เปิดหน้าส่ง PO (wizard) → `/api/supplier-po/link` → `issueLink()` เขียน "รอผู้ขายยืนยัน" + ประวัติ "ขอวันส่ง" ทันที แม้กดยกเลิก/ส่งไม่สำเร็จ = ระบบอ้างว่าถามผู้ขายแล้วทั้งที่ยังไม่ได้ถาม

**แก้ (`682b1aa`, ต่อจาก PR52 `d785ae8`):**
- `/link` สร้างลิงก์อย่างเดียว (`supplierLink.unsent`, `baseRev` = revision ที่ถามจริงล่าสุด) ไม่แตะสถานะ/ประวัติ
- `POST /api/supplier-po/requested {brand, poId, version}` บันทึกว่าถามแล้ว เฉพาะเมื่อหน้าแรก (ที่มีลิงก์) ส่งถึงจริง:
  settle `nextPage`/`sent`/`sentUnsaved` หรือคนกด "ส่งแล้ว" · กันด้วย link version + revision + brand epoch · ต้องเป็นผู้ใช้ active
- ผู้ขายเปิด/ตอบลิงก์ที่ยังไม่ถูก mark → server บันทึก "ถามแล้ว" ก่อนใน write เดียวกัน (ถือลิงก์ = ส่งถึงแล้ว)
- ข้อความในแชทใช้วันที่ที่จะถามจริง (`askedOnSend`) — กันบั๊กใหม่: ใบที่แก้วันจะโชว์วันเก่า
- `issueLink()` (ใช้กับ revoke) = mint + mark — เทสเดิม 66 ข้อของ `issueLink` ผ่านหมดโดยไม่แก้

**หลักฐาน:** RED 9/10 → GREEN · unit **1761/1761** · Rules+emulator **237/237** · line-send e2e desktop+android **46/46**
(เทส A2 ใน e2e RED เมื่อถอดการต่อสายใน wizard → GREEN เมื่อใส่กลับ) · tsc 4 project ผ่าน · oxlint 0 error · i18n ผ่าน · build + bundle budget ผ่าน
log: `a2-*.log` · เทสที่เปลี่ยนความหมายโดยตั้งใจ: emulator "amendment…" เคยยืนยันว่า reset ตั้งแต่ mint (= ตัวบั๊ก)

**Review:** ดูข้อ 9 (ผลจริงจาก Gemini cross-model)

## 6. Wave 5 — PR39 OCR staging: BLOCKED (เหตุชัดเจน)

`stagingAllowed()` (`src/lib/deployTier.ts:105`) เปิด Functions ให้ staging ก็ต่อเมื่อ `DEPLOY_TIER=staging` + `FIREBASE_PROJECT_ID` ≠ `pzm-stock-x5`
+ service account key ของ project นั้นตรงกัน + ไม่มี `PRODUCTION_HOSTS` และต้องเป็น **Pages project แยก** ที่มี AI binding / `GEMINI_API_KEY` ของตัวเอง
ตอนนี้: Pages มีแค่ `pzmstock` · Firebase มี `pzm-inventory-2026` แต่ไม่รู้ว่าเก็บอะไร (ไม่แตะ) · การสร้าง SA key = credential action ที่ agent ห้ามทำ

**Owner เลือก 1 ทาง:**
1. สร้าง Firebase project ใหม่ (เช่น `pzm-stock-staging`, ไม่มีข้อมูลจริง) + SA key, สร้าง Pages project `pzmstock-staging` ตั้ง secret
   `DEPLOY_TIER=staging`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY` (+ AI binding) → MAIN deploy branch PR39 ไปที่นั่นแล้วรัน matrix
2. อนุญาตให้ MAIN สร้าง Pages project เอง และ Owner ใส่ secret ผ่านช่องกรอกลับ (ไม่พิมพ์ในแชท)

QA matrix ที่จะรันทันทีเมื่อมี staging: fixture 31 แถว (ห้ามหาย) · 3 แถวไม่มีจำนวน (`-`/`ตาม`) ต้องถูกบล็อก · PDF/รูป · timeout/ยกเลิก ·
ยืนยันก่อน import · PDF 2.9–20MB (local raster) · ใช้ข้อมูลสังเคราะห์เท่านั้น ไม่ copy ข้อมูล production

## 7. Wave 6 — Backlog extraction

- **PR24 `2d96cd8`:** เก็บไว้ ไม่ merge กับ PR39 ตรง ๆ (merge-tree conflict 2 ไฟล์ และ cap 2.9MB จะบล็อก PDF ≤20MB ของ PR39) → HOLD จน PR39 merge แล้ว rebase + เทส 2.9–20MB
- **PR19 `d0d4ab2`:** แยก i18n audit (AST key scan, placeholder parity, ภาษาไทยหลุดในคำแปลอังกฤษ) — เทส 3/3, full 1717, build ผ่าน · gate เข้มขึ้น
  (MAIN ตรวจ: ไม่มีการเรียก `x.t('…')` บน main ที่ AST จะพลาด) · review ดูข้อ 9 · ที่เหลือใน PR19: artwork ปุ่ม LINE (ผูกกับ #52) และคำกิจกรรมตามบริบท
- **PR45:** AGENTS.md ใน PR = ของ Owner ใน root (ยังไม่ commit) + ส่วน "Agent skills" ต่อท้าย → merge แล้วไม่ทับของ Owner · ไม่แตะไฟล์ใน root
- **PR1:** outline เท่านั้น ห้าม merge · **PR46:** OWNER_HOLD

## 8. Wave 2/8 — Release queue

| Release | เนื้อหา | ลำดับ/เงื่อนไข | สถานะ |
|---|---|---|---|
| A | PR54 Rules-only | ก่อนทุกอย่าง (ไม่เปลี่ยน main) | READY_FOR_RULES_DEPLOY |
| B | PR53 SW hotfix | หลัง/ขนานกับ A; merge = auto-deploy | READY_FOR_OWNER_HOTFIX · rollback `cbbec765` (Cloudflare → Deployments → Rollback) แล้ว `git revert -m 1` |
| C | PR55 notification | หลัง B | REVIEW_PENDING (cross-model) |
| D | PR52 + A2 | หลัง B เสถียร + มือถือ | device QA + review A2 |
| E | PR51 Rules+app | หลัง A, อนุมัติแยก | OWNER_HOLD |
| F | PR33 / PR29 / PR39 | ตาม gate แต่ละตัว | #33 READY · #29 รอ scanner · #39 รอ staging |
| G | งาน extract (PR19 audit, PR24 routing) | หลัง review / PR39 | ดูข้อ 7 |

หลัง merge ใดก็ตาม: rebase/รัน CI ใหม่ทุก PR ที่ยังเปิด และตรวจ HEAD ใหม่ก่อน release ถัดไป (merge ทีละอัน ไม่ merge รวด)

**Release B verifier:** `node docs/mission/r66/verify-prod-sw.cjs` → ตอนนี้ FAIL (handler `index.html` = บั๊ก) · build ของ `df34558` บน local PASS (handler `/`)

## 9. Review ที่ได้ในรอบนี้

| งาน | Reviewer | ชนิด | ผล | หลักฐาน |
|---|---|---|---|---|
| PR55 `f301f39` | Gemini session ใหม่ | separate-agent (patch `6c17c98` เขียนโดย Gemini) | **APPROVE** ไม่มี finding | `review-pr55.md` (`7f8ae9f`) 102/102, full 1781 |
| PR55 `f301f39` | DeepSeek free | cross-model | **ไม่ได้รัน: quota หมด** (ลองครั้งเดียว ไม่ retry) | task failed "Free usage limit reached" |
| PR33 `7c0505d` | Gemini session ใหม่ | **cross-model** (code โดย MAIN) | **APPROVE** ไม่มี finding | `review-pr33.md` (`4475ba2`) 95/95, full 1739 |
| A2 `682b1aa` | Gemini session ใหม่ | **cross-model** (code โดย MAIN/Claude) | **APPROVE** (Should 1 แก้แล้วใน `3b513ca`) | `review-a2.md` (`2ef165e`) |
| A2 `3b513ca` | Gemini session ใหม่ | cross-model delta | **APPROVE** | `review-a2-delta.md` (`646d315`) |
| A2 `297124f` | Gemini session ใหม่ | cross-model test-only delta | **APPROVE** | `review-a2-delta2.md` (`46afa67`) |
| PR19 extraction `d0d4ab2` | Gemini session ใหม่ | separate-agent | **APPROVE** (Should 2 ข้อเล็ก, ไม่แก้) | `review-pr19-extraction.md` (`412dee9`) |

ไม่มีการนับ review ของ MAIN เป็น approval · ไม่มีการเรียก GPT/Codex/Claude เป็น subagent

## 10. ไม่ได้ทำ / ความเสี่ยง

- ไม่ได้ deploy อะไรเลย (ไม่มีคำอนุมัติ) — บั๊ก transit และ LINE ERR_FAILED ยังอยู่บน production
- PR55 ยังไม่มี cross-model review (free quota DeepSeek/GLM หมด)
- A2: ลูกค้าที่ยังใช้แอปเวอร์ชันเก่า (cache) จะเรียก `/link` อย่างเดียว → สถานะไม่ขึ้น "รอผู้ขาย" จนผู้ขายเปิดลิงก์ (ขาดได้ ไม่เกิน) ·
  revoke ลิงก์ที่ยังไม่เคยส่ง จะบันทึกว่าถามแล้ว (เหมือนพฤติกรรมเดิมของ revoke)
