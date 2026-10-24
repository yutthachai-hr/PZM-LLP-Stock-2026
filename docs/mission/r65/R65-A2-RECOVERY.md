# R65 — กู้ A2 จาก Gemini HTTP 502 และทำ End-to-End ให้เสร็จ (รวม R64-B / R64-C)

วันที่ 24 ต.ค. 2026 · MAIN: Pi Claude (Opus 5.5) · subagent: Gemini 3.8 Flash High เท่านั้น (DeepSeek free = quota หมด)
**Production deployment: NOT DONE** · ไม่มี merge · ไม่มี business write

## 1. สาเหตุ Gemini HTTP 502 — ยืนยันชั้นที่เกิดแล้ว (ข้อความ exception ตัวจริงยังไม่ได้เห็น)

**เส้นทางจริง:** T3 → OpenCode provider `9router` → `http://localhost:20128/v1` (OpenAI-compatible) → model alias
`gemini-3.8-flash-high` → upstream `ag/gemini-3.8-flash-high` (provider `antigravity` ใน 9Router 0.5.109)
· port 20128 = `node.exe` PID 28440 (`9router/app/custom-server.js`) เปิดต่อเนื่องตั้งแต่ 23 ต.ค. 16:55 (+07) ไม่ได้ restart
· `/dashboard` 307 · `/v1/models` 200 JSON ถูกต้อง 58 model มี `ag/gemini-3.8-flash-high` · `/health` 404 = ไม่มี endpoint นี้ ไม่ได้แปลว่าล่ม

| ชั้น | หลักฐาน | สรุป |
|---|---|---|
| T3 | แค่รายงาน "Provider request returned HTTP 502" ของ child | ส่งต่อ ไม่ได้เป็นต้นเหตุ |
| OpenCode | `opencode.db` error `provider.internal`, status 502, **body ว่าง** — ได้รับจาก localhost:20128 | ส่งต่อ |
| **9Router** | code 0.5.109 (chunk `8895.js`): ถ้า executor ของ provider **throw ก่อนได้ response จาก upstream** (network/timeout ที่ไม่ใช่ client abort) → ตอบ `502 BAD_GATEWAY` และพิมพ์ `ERROR 502 · provider/model · ms` ลง **console เท่านั้น** | **ผู้สร้าง 502** |
| Google upstream (Antigravity) | ไม่มี HTTP status จาก upstream ถูกส่งกลับ (ถ้ามีจะ relay 429/500/503 พร้อม body) | ต้นเหตุคือการเชื่อมต่อ/รอ upstream ที่ล้มก่อนตอบ |

**ตัวกระตุ้น:** ไม่ใช่ turn เขียนโค้ดปกติ — ทั้ง 2 ครั้ง (A2 09:08:57Z = 16:08 น., Agent04 09:40:16Z = 16:40 น.) ล้มที่ข้อความชนิด
**`compaction`** ซึ่ง OpenCode สั่งอัตโนมัติเมื่อ session ยาว (A2: input สะสม 544k, cache 9.8M) ให้ model สรุปประวัติ

| Gemini compaction ทั้งหมดใน OpenCode | จำนวน | context | เวลา |
|---|---|---|---|
| สำเร็จ | 87 | 155k–199k (median 179k) | ≤ 41.6 วินาที (p90 28 s) |
| ล้ม (502 ทั้งหมด) | 5 (4 ครั้งวันนี้: PR29×2, A2, Agent04) | 169k–176k | **83–95 วินาที** |

**จัดประเภท:** upstream ใช้เวลานานเกิน ~80–95 วินาทีโดยไม่ตอบ → 9Router ตัดเป็น 502 · **ไม่ใช่** quota (ไม่มี 429; 9Router บันทึก Gemini 3.8
สำเร็จ 1,627 request วันนี้ รวมวินาทีก่อน/หลังเหตุ) · **ไม่ใช่** context ยาวเกิน (compaction ที่ยาวกว่าสำเร็จ) · **ไม่ใช่** tool schema / auth
· 9Router เก็บแค่ request ที่สำเร็จ (`usageHistory` 31,420 แถว `ok` ทั้งหมด, `requestDetails` 0 แถว) จึงไม่มีบันทึก 502 ใน DB
· ข้อความ exception ตัวจริง (เช่น socket ปิด / headers timeout) อยู่ในหน้าต่าง console ของ 9Router เท่านั้น — **ยังไม่ได้เห็น**

**Gemini health:** ปกติ · หลังเหตุการณ์ Gemini ทำงานเสร็จแล้ว 9 งาน (R64 01/02/03/05/06/07/04-รอบ2, R66 review PR55/PR33/PR19/A2)
จึงไม่ยิง probe เพิ่ม · ไม่ได้ restart / แก้ credential / แก้ config ของ 9Router หรือ OpenCode
**ป้องกัน:** ให้งาน subagent สั้นพอไม่ต้อง compaction (ใช้แล้วตั้งแต่ R64 รอบ 2 — ไม่มี 502 อีก) · route ไม่ต้อง HOLD

## 2. งาน A2 ที่เก็บไว้ — กู้ครบ ไม่เริ่มจากศูนย์

| ของเดิม | ที่อยู่ | ใช้อย่างไร |
|---|---|---|
| spec A2-1…A2-7 (R55) | `~/r55/pzm/PR52-A2-PR51-analysis.md` | เป็นรายการเทส |
| GLM scaffold `ddcd495` | `r57/a2-mint-link-separately` (`t3-d9439bc8`) | อ่านแล้ว ไม่ merge (compile ไม่ผ่าน) |
| Gemini R62 partial (ไม่ commit, 6+1 ไฟล์) | `t3-abb9af93` + `docs/mission/r62/a2-502-backup` (patch `58c97da2…`) | ใช้ design: แยก mint/mark, endpoint `/requested`, จำ revision ก่อนหน้า · ตัด `prepareOnly` flag และ `version` แบบ optional ทิ้ง |
| ทุก worktree | `r64-backup/r66-preserve-20261024` (bundle `aad062bd…` + patch) | ไม่มีอะไรถูกลบ/ reset — `t3-abb9af93` ยังอยู่เหมือนเดิม |

เหตุที่ partial เดิมใช้ต่อตรง ๆ ไม่ได้: ไม่มีผู้เรียก `markSupplierRequested` เลย · client ส่ง `prepareOnly` เป็นค่า default แต่ server ยังทำงานแบบเก่าถ้าไม่มี flag
(client เก่าจะยังบันทึกผิด) · `markRequested` ไม่ปฏิเสธ revision ที่เปลี่ยนหลัง mint · ทำบน `main` แต่จุด "ส่งถึงจริง" (`settleShare`) มีเฉพาะใน PR52

## 3. Caller wiring ที่ขาด: **แก้แล้ว — YES**

`SendWizard.tsx` (บน PR52) เรียก `markSupplierRequested(order, linkVersion)` เฉพาะเมื่อหน้าที่มีลิงก์ (หน้า 1) ส่งถึงแล้ว:
settle `nextPage` / `sent` / `sentUnsaved` หรือคนกด "ส่งแล้ว" · ไม่เรียกเมื่อ cancelled / failed / "ยังไม่ได้ส่ง" / LINE Login redirect / เปลี่ยนแบรนด์ระหว่างส่ง
· `SupplierConfirmationPanel` "คัดลอกลิงก์" = เตรียมลิงก์อย่างเดียว (คัดลอก ≠ ส่ง)

## 4. Client → API → Server

```
SendWizard (เปิด) ──POST /api/supplier-po/link──▶ mintLink(): supplierLink{unsent, baseRev}  (ไม่แตะสถานะ)
SendWizard (หน้า 1 ส่งถึง) ──POST /api/supplier-po/requested {brand,poId,version}──▶ markRequested():
      ต้องเป็นผู้ใช้ active · version ต้องตรง · revision ต้องตรง (ไม่งั้น 409 stale) · ซ้ำ = ไม่เขียน
ผู้ขายเปิด/ตอบลิงก์ที่ยัง unsent ──▶ server บันทึก "ถามแล้ว" ก่อน ใน write เดียวกัน (ถือลิงก์ = ส่งถึง)
revoke (หัวหน้า) ──▶ issueLink() = mint + mark ในขั้นเดียว (พฤติกรรมเดิม)
risk / delivery metrics ──▶ ลิงก์ unsent ไม่นับเป็นเวลาที่ส่ง (แก้ตาม review)
```
order cache อัปเดตจาก order ที่ server ตอบ (เฉพาะถ้ายังอยู่แบรนด์เดิม) · LINE badge/สถานะ sent มาจาก `setShareStatus` เดิมของ PR52 ไม่เปลี่ยน
· ถ้า `/requested` ล้ม → คืน `null`, หน้าจอยังแสดงผลการส่งตามจริง, สถานะผู้ขายไม่ขึ้น (ขาดได้ ไม่เกิน) และจะถูกบันทึกเมื่อผู้ขายเปิดลิงก์

## 5. เทส (คำสั่งจริง, exit code)

| ชุด | ผล |
|---|---|
| `tests/supplier-request-on-send.test.ts` (ใหม่) | RED 9/10 (ไม่มีฟังก์ชัน) → GREEN 10/10 |
| `tests/functions/supplier-po.test.ts` เพิ่ม 6 เคส `/requested` + view/answer | RED 7 → GREEN |
| supplier-confirmation / supplier-po / supplier-link-lifecycle / send-outcome-order | ผ่านทั้งหมด (อยู่ใน full) · `issueLink` 66 เทสเดิมผ่านโดยไม่แก้ |
| delivery-risk / delivery-metrics (review finding) | RED 2 → GREEN · 4 ชุดที่เกี่ยวข้อง 83/83 |
| `npx vitest run` (full) | exit 0 · 145 files · **1763/1763** |
| `npm run test:rules` (Rules + emulator) | exit 0 · **237/237** (ที่ `682b1aa`; หลังจากนั้นไม่แตะ functions/Rules) |
| `playwright -c playwright.line-send.config.ts` desktop + android | exit 0 · **54/54** · A2 8 เคส |
| e2e RED proof | ใส่ SendWizard ของ PR52 กลับ → เคส "LINE ส่งแล้ว" และ "สองหน้า" FAIL · ใส่กลับ → PASS |
| tsc app/functions/worker/e2e · oxlint · i18n · build · bundle | ผ่านทั้งหมด |
| **CI ครั้งแรกของ #57 (`3b513ca`)** | **e2e FAIL 2** — `supplier-date-approved.spec.ts:102` (th/en) คาดว่า mint แล้วเป็น `waiting` ทันที = ตัวบั๊ก A2 · MAIN พลาดเองเพราะรันแค่ line-send ไม่ได้รัน `test:e2e` เต็ม |
| แก้ `297124f` (test-only) | helper `reviseQty()` = เตรียมลิงก์ → ยืนยันว่ายังไม่ถาม → `/requested` เหมือน wizard |
| `npm run test:e2e` (เต็ม, emulator) | exit 0 · **90 passed**, 2 skipped (เท่า CI) |
| e2e configs อื่นใน CI | match 2 · search 12 · orders 29 · toast 16 · products-responsive 16 · transit 13 — ผ่านทั้งหมด |

เทสตามรายการ R65: mint ไม่ mark ✓ · ส่งถึง → mark ✓ · ยกเลิก ✓ · ล้ม ✓ · ไม่แน่ใจ → ถามคน ("ส่งแล้ว"/"ยังไม่ได้ส่ง") ✓ · หลายหน้าไม่ mark ก่อนหน้า 1 ถึง ✓ ·
ซ้ำ idempotent ✓ · ผิดแบรนด์ (server + เปลี่ยนแบรนด์ระหว่าง picker) ✓ · ไม่มีสิทธิ์ ✓ · stale ✓ · server ล้มแล้ว UI ยังถูก ✓ · ลิงก์ผู้ขายใช้ได้ ✓ · LINE flow เดิมไม่พัง (54/54) ✓
หมายเหตุ: ความล้มเหลวที่เคยแก้กลางทาง — RED ครั้งแรกด้วย `git stash` ไม่มีผลเพราะโค้ดถูก commit แล้ว จึงพิสูจน์ใหม่ด้วยการใส่ไฟล์ของ PR52 ชั่วคราว (ผลข้างบน)

## 6. Independent review

| Commit | Reviewer | ชนิด | ผล |
|---|---|---|---|
| `682b1aa` | Gemini session ใหม่ (ไม่ได้เขียนโค้ด; โค้ดโดย MAIN/Claude) | **cross-model** | **APPROVE** · Must 0 · Should 2 · `review-a2.md` (`2ef165e`) |
| `3b513ca` (แก้ Should 1) | Gemini session ใหม่ | cross-model, delta | **APPROVE** · 0/0 · ย้อน fix แล้วเทสใหม่ fail จริง · `review-a2-delta.md` (`646d315`) |
| `297124f` (แก้ e2e) | Gemini session ใหม่ | cross-model, test-only delta | **APPROVE** · ไม่มี assertion ถูกลด · `review-a2-delta2.md` (`46afa67`) |

Should 2 (ปุ่ม revoke แสดงกับลิงก์ unsent) ไม่แก้: `unsent` อาจหมายถึง "ส่งแล้วแต่ mark ล้ม" (client เก่า) ซึ่ง revoke ยังถูกต้อง
ไม่มีการนับ review ของ MAIN เป็น approval · ไม่มีการใช้ GPT/Codex/Claude เป็น subagent

## 7. Branch / Commit / PR

- Branch `fix/20261024-a2-request-on-send` · commits `682b1aa` + `3b513ca` + `297124f` (head) · **PR #57** (draft, ฐาน `fix/20261022-line-po-reliability` = PR52)
  https://github.com/yutthachai-hr/PZM-LLP-Stock-2026/pull/57 · **CI exact head `297124f`: 10/10**
- ส่วนอื่นในรอบเดียวกัน: PR19 extraction → **PR #58** https://github.com/yutthachai-hr/PZM-LLP-Stock-2026/pull/58 (separate-agent APPROVE)

## 8. Production deployment: **NOT DONE**

Preview QA ของ A2 ทำไม่ได้จริงบน Cloudflare Preview: Functions ของ preview ตอบ `503 preview_isolated` และแอป preview อยู่ใน demo mode
(ไม่มีลิงก์ผู้ขาย) → QA จริงต้องรอ staging (blocker เดียวกับ PR39) หรือ production หลัง #53 → #52 → #57 ตามลำดับพร้อมอนุมัติ

## 9. Blocker ที่เหลือ

- #57 ต้อง release หลัง #53 (P0) และ #52 (มือถือจริง) · หลัง #52 merge ต้อง retarget #57 ไป `main` แล้วรัน CI ใหม่
- Firebase: **ไม่ blocked** — official API ใช้ได้ (อ่าน Rules สด 11:00Z) · ไม่ต้อง login ซ้ำ
- ข้อความ exception ตัวจริงของ 502 (optional)

## 10. สิ่งที่ Owner ต้องทำ (เฉพาะที่จำเป็น)

1. (ไม่บังคับ) ถ้าต้องการข้อความ 502 ตัวจริง: เลื่อนดูหน้าต่าง console ของ 9Router ช่วง **16:08–16:10 น.** และ **16:40–16:42 น.** วันนี้ หาบรรทัด `ERROR 502 · antigravity/gemini-3.8-flash-high`
2. อนุมัติ Release A (PR54 Rules) และ B (PR53) ตามรายงาน R66 — A2 (#57) ต้องรอหลังสองอันนี้และ #52
