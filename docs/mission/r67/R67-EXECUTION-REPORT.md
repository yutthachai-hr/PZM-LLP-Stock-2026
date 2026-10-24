# R67 — Release A + B (Owner-approved) · PR29 QA · OCR Staging · PR55

วันที่ 24 ต.ค. 2026 · MAIN: Pi Claude (Opus 5.5; สลับบัญชี 1 ครั้งระหว่างทาง ตรวจซ้ำแล้วไม่มีอะไรทำซ้ำ) · subagent: Gemini 3.8 Flash High เท่านั้น

## 0. สรุปที่ Owner ขอ

| รายการ | ผล |
|---|---|
| **Release A** (PR54 Rules-only) | **DEPLOYED — `RELEASE_A_DEPLOYED_VERIFIED`** |
| Active Firestore Rules SHA256 | **`ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270`** (ruleset `cf5176f9-7cba-4225-80f3-f19fb70824b0`, release 2026-10-24 12:35:14Z) |
| **Release B** (PR53) | **MERGED + DEPLOYED** — automated smoke PASS · รอผลมือถือจริงก่อนประกาศ `RELEASE_B_DEPLOYED_VERIFIED` |
| Production commit | `main` = **`6045b502171b1639d1e55c0f09e9a910e14ad064`** (merge #53) · Cloudflare production **`b82fd719`** |
| LINE Phone QA | **PENDING** (Owner — ขั้นตอนข้อ 3) |
| Rollback | ไม่ต้อง rollback · ทั้งสองมีชุด rollback พร้อม (ข้อ 10) |

## 1. Release A — PR54 Rules-only

| Gate ก่อน deploy (12:35Z) | ผล |
|---|---|
| Live baseline อ่านซ้ำ (official API) | ruleset `80b1cd17…` · raw `eee07cf8…` = backup R64/R66 → **ไม่เปลี่ยน** |
| Candidate | `ae39c231…` = blob `firestore.rules` ที่ PR54 `01bb12c` · CI 10/10 · R64 Gemini security APPROVE · Rules 251/251 |
| Rollback | `docs/mission/r64/rollback/firestore.rules` = live เดิม `eee07cf8…` |
| Config | Rules อย่างเดียว · `--project pzm-stock-x5` · ไม่มี PR51 |
| Server authz (Rules API `projects:test`, จำลองผู้ใช้ — ไม่อ่าน/เขียนข้อมูลจริง) | candidate **13/13** · baseline เดิม 13/13 (ยืนยันว่า baseline ปฏิเสธ transit = บั๊กเดิม) |

**Deploy:** `firebase deploy --only firestore:rules --project pzm-stock-x5 --config docs/mission/r64/candidate/firebase.json` → compiled + released
**ตรวจหลัง deploy:** อ่าน release กลับผ่าน API → sha **`ae39c231…` ตรงกับที่อนุมัติ** · รัน authz suite บน **bytes ที่ live จริง** → **13/13**:
Admin สร้าง location `transit` ได้ทั้ง 3 แบรนด์ (pizza / lelapin / rnd) · transit ที่ import มา (id อื่น) ได้ ·
warehouse ใช้ id `transit` **ไม่ได้** · warehouse ปกติยังได้ · **manager / staff / admin ที่ไม่ active / ผู้ใช้ไม่มี profile / ไม่ login → ปฏิเสธทั้งหมด** ·
type แปลก/field เกิน → ปฏิเสธ · **ไม่มีการสร้าง stock movement หรือเขียนเอกสารใด ๆ**

**Owner ทำต่อ (ยืนยันจากแอปจริง):** เข้าด้วย Admin → ตั้งค่า → ระบบส่งสินค้า → เปิด "ระหว่างขนส่ง" (เขียน config location ไม่ใช่ยอดสต๊อก)

## 2. Release B — PR53 SW hotfix

| Gate | ผล |
|---|---|
| Exact head | `df34558` · CI 10/10 · CLEAN บน `312f8a7` · 6 ไฟล์ SW/e2e เท่านั้น (ไม่รวม PR52/A2) |
| Review | DeepSeek APPROVE_WITH_NITS (R56, nit แก้แล้ว) + R64 Gemini verify · Preview `9789240e` handler `/` |
| Rollback target | Cloudflare deployment `cbbec765` (312f8a7) ยังอยู่ |

**Merge:** 12:37:05Z → merge commit `6045b50` · Cloudflare production `b82fd719` Active (`6045b50`)

| Production smoke (public เท่านั้น ไม่ login ไม่เขียนข้อมูล) | ผล |
|---|---|
| `verify-prod-sw.cjs`: `sw.js` 200, `createHandlerBoundToURL("/")`, precache `/` ไม่ใช่ `index.html`, denylist `/api/` และ `/supplier/po/`, cleanupOutdatedCaches | **PASS** (ก่อน deploy = FAIL handler `index.html`) |
| เครื่องใหม่: เปิด `/`, reload, offline launch, offline deep link `/orders`, LIFF return `/?liff.state=%2Forders` → ไป `/orders`, หน้า supplier ไม่ถูก shell ทับ | **PASS ทุกข้อ** |
| เครื่องที่มี SW เก่า (ติดตั้งก่อน merge): ระหว่าง session เดิม SW เก่ายังคุมอยู่ → deep link `/orders` ERR_FAILED (บั๊กเดิม) | ตามคาด — SW ใหม่ "installed/waiting" |
| เครื่องเดียวกัน **ปิดแล้วเปิดใหม่**: SW ใหม่ active · `/`, `/orders`, LIFF return, หลังลบ shell cache (เงื่อนไข P0) → **โหลดได้ทั้งหมด** | **PASS** (offline หลังลบ cache โหลดไม่ได้ = ปกติ ไม่มีของใน cache) |

**สิ่งที่ต้องรู้:** โทรศัพท์ที่ค้าง SW เก่าจะหายเมื่อ **ปิดแอป/หน้า LINE ให้สนิทแล้วเปิดใหม่ 1 ครั้ง** (หรือกดปุ่มอัปเดตเมื่อขึ้น)

## 3. LINE Phone QA — **PENDING** (Owner, ~10 นาที, กลุ่มทดสอบเท่านั้น)

1. บนโทรศัพท์ที่เคยเจอ ERR_FAILED: ปิด LINE ให้สนิท → เปิดใหม่ → เปิด PZM จากลิงก์/LIFF เดิม → ต้องเปิดได้ (ถ้ายังไม่ได้: ปิด-เปิดอีกครั้ง แล้วแจ้งเวลา)
2. ใบสั่งซื้อ **ทดสอบ** 1 ใบ → ส่ง LINE → เลือก **กลุ่มทดสอบ** (ห้ามผู้ขายจริง) → กลับมาแอป → สถานะต้องเป็น "ส่งแล้ว" ครั้งเดียว
3. กดส่งซ้ำเร็ว ๆ → ต้องเปิดตัวเลือกแชทครั้งเดียว · ยกเลิกตัวเลือกแชท → สถานะต้อง**ไม่**เป็น "ส่งแล้ว"
4. แจ้งผล: ผ่าน/ไม่ผ่าน + รุ่นโทรศัพท์ + เวลา → MAIN ปิด `RELEASE_B_DEPLOYED_VERIFIED` (ถ้า critical → rollback ข้อ 10)

## 4. PR29 — Automated Scanner QA

| # | กรณี | ผล | เครื่องจริง |
|---|---|---|---|
| 1 | barcode ปกติเลือกสินค้าถูก | AUTOMATED_PASS | PHYSICAL_HARDWARE_PENDING |
| 2 | เลข 0 นำหน้า (`0012345678901` ≠ `12345678901`) | AUTOMATED_PASS | PENDING |
| 3 | suffix Enter | AUTOMATED_PASS | PENDING |
| 4 | suffix Tab สแกน · Shift+Tab ไม่สแกน · Tab ตอนพิมพ์ค้นหา = เลื่อนตามปกติ | AUTOMATED_PASS | PENDING |
| 5 | ไม่พบสินค้า → แจ้ง error ไม่เลือกผิด | AUTOMATED_PASS | PENDING |
| 6 | barcode ซ้ำ / สินค้าปิดใช้ → reject | AUTOMATED_PASS | PENDING |
| 7 | สแกนสองครั้งห่าง 61–79 ms (<400) → ไม่ซ้ำ ไม่ต่อกัน | AUTOMATED_PASS | PENDING |
| 8 | สลับแบรนด์ / เปิด-ปิดสแกนเนอร์ → ไม่ข้ามแบรนด์ ไม่มี callback ค้าง | AUTOMATED_PASS | PENDING |

- เขียนโดย Gemini (`3674686`) · **MAIN รันซ้ำเอง 18/18** (10 เดิม + 8 ใหม่, emulator) · unit 82
- Final-diff review: Gemini session ใหม่ **APPROVE** (cross-model สำหรับ `src/`, separate-agent สำหรับเทส) พร้อมตาราง mutation ยืนยันว่าทุกกรณี **fail จริง** ถ้าการป้องกันถูกถอด → `READY_FOR_RELEASE` เหลือแค่เครื่องจริง
- เวลา wedge: เป้า 8–10 ms/ตัว แต่วัดได้ 25–40 ms (overhead ของ Playwright) — **ไม่ใช่หลักฐานเครื่องจริง**
- **ไม่มีเครื่องสแกนต่อกับ PC นี้** (ตรวจ PnP: มีแค่คีย์บอร์ด Apple, เมาส์, receiver ไร้สาย) → PHYSICAL_HARDWARE_PENDING
- PR29 head ใหม่ `a33de94` = `3674686` + merge main (ไม่มีอะไรอื่น) · CI: ดูข้อ 8

## 5. PR39 OCR Staging (Owner เลือก Dedicated)

**Phase 1 เสร็จ (โค้ด + พิสูจน์ในเครื่อง) — PR #59** · **Phase 2 (สร้างของบน cloud) ยังไม่ทำ** — รออนุมัติเฉพาะเรื่อง (ข้อ 9)

| ชั้น | สิ่งที่โค้ดรับประกันแล้ว |
|---|---|
| Build | staging เกิดได้เฉพาะ `DEPLOY_TIER=staging` + build ในเครื่อง (ไม่ใช่ Cloudflare git build) + web config ของ project แยกที่ไม่มีอะไรของ production |
| Browser | build staging เปิดได้แค่ project staging — ไม่ใช้ `BUILT_IN`, ไม่ใช้ config ที่บันทึกใน localStorage, บน host production ไม่เปิดอะไรเลย |
| Functions | `verifyFirebaseToken()` **ไม่มี project default แล้ว** (TypeScript บังคับ) · host production → `pzm-stock-x5` เสมอ · staging ครบเงื่อนไข → project ตัวเอง · อื่น ๆ → ไม่รับ token |
| Deploy | `deploy/staging/wrangler.toml` (project/KV/AI ของตัวเอง) · `scripts/deploy-staging.mjs` ปฏิเสธก่อน build ถ้ามีอะไรของ production หรือ placeholder |

## 6. Production Isolation Tests

| เทส | ผล |
|---|---|
| Unit boundary (`staging-tier` + `preview-isolation`) | **67/67** · full unit **1743/1743** · tsc 4 project · lint · i18n · production build ปกติไม่มี project staging ใน bundle |
| Browser จริง, dev server staging, ฝัง config production ใน localStorage ก่อน | ได้ `pzm-stock-staging` · 239 request **ไม่มีสักอันที่อ้าง `pzm-stock-x5`** |
| Functions ใต้ `wrangler pages dev` (localhost, SA ปลอม) | staging ครบ: ไม่มี token 401 · token ปลอมของ production 401 · po-image 401 — SA ของ production หรือไม่มี SA: **503 `preview_isolated`** ทุก route |
| **Cross-model review รอบ 1** (Gemini) | **CHANGES_REQUESTED — เจอช่องโหว่จริง:** config ที่เขียน `pzm-stock-x\u0035` ผ่านการตรวจแล้ว decode เป็น production · MAIN เจอเพิ่ม: apiKey ของ production จะส่ง sign-in ไป Auth ของ production |
| แก้ `3d48ad1` | ตรวจบนค่าที่ parse แล้ว (lower-case) ทั้ง project id / project number / **web API key** + รูปแบบ project id · เทส escape **RED บน `0cdda9a` → GREEN** · review รอบ 2 **APPROVE** (reviewer ยืนยัน RED เอง + ลอง bypass ใหม่ 6 แบบไม่ผ่าน) |
| CI `secrets` (gitleaks) FAIL 2 ครั้ง — **ความผิดของ MAIN** | `3d48ad1` คัดลอก web apiKey สาธารณะของ production ลง `deployTier.ts` · `6b8707b` เปลี่ยนเป็น prefix 20 ตัว ก็ยังโดนกฎ generic |
| แก้ `891da59` | `deployTier.ts` ไม่มี key เลย: browser ส่ง `BUILT_IN.apiKey` จาก `config.ts` (ไฟล์เดียวที่มี key) · deploy script อ่านจาก `config.ts` · commit ที่ push ไปแล้วได้ exact fingerprint ใน `.gitleaksignore` (ไม่ force-push) · เทส browser RED ถ้าไม่ส่ง key → GREEN · review รอบ 3 APPROVE · CI **10/10** |
| Review รอบ 4 (`891da59`) | _รอ_ |

## 7. OCR Real API Test — **ยังไม่ได้รัน**

ต้องมี staging จริง (Gemini key ของ staging + Firebase project staging) ก่อน · matrix พร้อมรันทันทีด้วย `scripts/deploy-staging.mjs`:
fixture 31 แถว (ห้ามหาย) · 3 แถว `-`/`ตาม` ต้องถูกบล็อก · PDF ≤20MB และ >2.9MB · รูป / PDF สแกน · Gemini + Workers AI fallback · timeout / ยกเลิก · CSP worker · ต้องยืนยันก่อน import · ไม่มีการเขียน DB ที่ไม่ได้อนุญาต

## 8. PR55 / SHAs / CI

| PR | Exact head | Review | CI | QA | สถานะ |
|---|---|---|---|---|---|
| #55 notification | `94ff0bc` (= `f301f39` + merge main; diff นอกไฟล์ main ว่าง) | **SEPARATE_AGENT_APPROVED** (Gemini, `7f8ae9f`) — **ไม่ใช่** cross-model | **10/10** CLEAN | unit 1781 · browser 17/17 · Preview `d64cef5d` (head นี้) PASS: legacy link → `/transfers/tr-fixture`, stock ไม่เปลี่ยน, SW handler `/` | **READY_FOR_OWNER_RELEASE** |
| #33 count lock | `e4db9a6` (= `7c0505d` + merge main) | Gemini cross-model APPROVE (`4475ba2`) | **10/10** CLEAN | concurrency 3/3 · focused 95 | **READY_FOR_OWNER_RELEASE** |
| #29 barcode | `a33de94` (= `3674686` + merge main) | APPROVE (`0f71f2b`) | **10/10** CLEAN | 18/18 automation (MAIN รันซ้ำ) | READY_FOR_RELEASE ยกเว้นเครื่องจริง |
| #59 staging tier | `891da59` | รอบ 1 CHANGES_REQUESTED → รอบ 2 APPROVE → รอบ 3 APPROVE → รอบ 4 _รอ_ | **10/10** CLEAN | unit 1743 · ข้อ 6 | draft |
| #57 A2 | `297124f` (ฐาน #52) | cross-model APPROVE ทุก commit | 10/10 | ข้อ R65 | รอ #52 |
| #58 i18n audit | `e0d4803` | separate-agent APPROVE | 10/10 | — | READY (dev tooling) |

PR55 rollback: `git revert -m 1 <merge>` (แอปอย่างเดียว ไม่แตะ Rules)

## 9. สิ่งที่ Owner ต้องทำ

1. **LINE Phone QA** ตามข้อ 3 → แจ้งผล
2. **ยืนยัน Release A จากแอป**: Admin เปิด "ระหว่างขนส่ง"
3. **PR29 เครื่องสแกนจริง** (~5 นาที): พิมพ์ `docs/mission/r67/pr29-test-barcodes.md` **ที่ 100% ไม่ย่อ** → สแกนตาม checklist → แจ้งรุ่นเครื่อง + ตั้งค่า Enter/Tab + ผลแต่ละข้อ
4. **อนุมัติ Staging Phase 2** (ตอบข้อความเดียว): "อนุมัติสร้าง staging: Firebase project `pzm-stock-staging` + service account สิทธิ์ต่ำสุดของ staging + Pages `pzmstock-staging` + KV ของ staging" — MAIN สร้างด้วยบัญชีที่ login อยู่ และใส่ secret ตรงเข้า Pages staging โดยไม่แสดง
   และ **Gemini API key สำหรับ staging เท่านั้น** (สร้างใน project staging ไม่ใช้ key production) — ถ้าให้ MAIN สร้างใน project staging ให้ระบุในข้อความเดียวกัน
5. **Merge**: PR55 และ PR33 พร้อมแล้ว — ต้องการคำอนุมัติ release แยกต่อ PR (merge = auto-deploy)

## 10. Rollback

| Release | วิธี |
|---|---|
| A (Rules) | `npx --no-install firebase deploy --only firestore:rules --project pzm-stock-x5 --config docs/mission/r64/rollback/firebase.json` → อ่านกลับต้องได้ `eee07cf8…` |
| B (SW) | Cloudflare → pzmstock → Deployments → `cbbec765` → Rollback (ทันที) แล้ว `git revert -m 1 6045b50` บน main |
| PR55 / PR33 / PR29 (เมื่อ merge) | `git revert -m 1 <merge>` เท่านั้น — ไม่ใช้ `reset --hard` |
| PR59 / staging | ยังไม่ merge ไม่มีของบน cloud — ไม่มีอะไรต้อง rollback |

## 11. ข้อผิดพลาดของ MAIN ในรอบนี้

- รัน `wrangler pages dev` ในเครื่องแล้ว process ค้าง (wrangler สร้าง workerd ใหม่ทุกครั้งที่ถูกฆ่า) → ทำให้ unit 2 เทส (pdfmake) timeout ชั่วคราว · หยุดหมดแล้ว แก้ script ให้ฆ่า parent · รัน unit ใหม่ผ่านหมด
- เทส escape ชุดแรกของ MAIN ไม่ได้จำลองการโจมตีจริง (escape ซ้อน) — แก้ให้ escape อยู่ใน JSON text และพิสูจน์ RED บนโค้ดเดิมแล้ว
- คัดลอก web apiKey สาธารณะลงไฟล์ที่สอง → CI secrets fail สองรอบ (ข้อ 6) · แก้ด้วยการไม่ถือ key เลย ไม่ใช่การหลบ scanner
- ระหว่างพิสูจน์ RED ใช้ `git checkout --` แล้วทำให้การแก้ของตัวเองใน `config.ts` หาย (ยังไม่ commit, worktree ของ MAIN) → ใส่กลับทันที และเปลี่ยนไปใช้สำเนาสำรองแทน
