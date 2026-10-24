# R63 — แก้ Notification ให้เปิดใบโอนที่ถูกต้อง

24 ต.ค. 2026 · PR [#55](https://github.com/yutthachai-hr/PZM-LLP-Stock-2026/pull/55)
ฐาน `origin/main = 312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55`
HEAD `62fa3ba06cf481e4b5e25c07f60e5ea497124ac8` · **ยังไม่ merge/deploy Production**

## 1. Root cause ที่พิสูจน์แล้ว

`transferSubmittedDraft`, `transferArrivingDraft`, `transferIssueDraft` ใน
`src/lib/inventoryRules/notifications.ts` เขียน `/logistics/${t.id}` แต่ Router ใน `src/App.tsx`
มี `/transfers/:id` เท่านั้น และ catch-all ส่งกลับ `/`.
Bell ใช้ `n.link` ตรง ๆ; presentation ก็ไม่รู้จัก legacy link จึงไม่ได้จัดเป็น entity transfer.

Browser fixture แยก `id = tr-fixture` กับเลขเอกสาร `TR-00001` ชัดเจน:
- **RED บน main 312f8a7:** กดแจ้งเตือนแล้ว URL เป็น `/` ไม่ใช่หน้าใบโอน
  (`red-browser-312f8a7.log`).
- **GREEN บนโค้ดใหม่:** เปิด `/transfers/tr-fixture` และเห็น `TR-00001`.
- ไม่อ่าน/แก้ Notification ของจริง; fixture เป็น browser-storage demo เท่านั้น.

## 2. ไฟล์ที่เปลี่ยน

| ไฟล์ | การเปลี่ยน |
|---|---|
| `src/lib/inventoryRules/notifications.ts` | ทั้ง 3 generator ใช้ `/transfers/${t.id}` ไม่ใช้ docNo |
| `src/lib/notificationLink.ts` | normalizer ร่วม: legacy → canonical, ตรวจ route จริง, URI/traversal/scheme, trailing slash, brand query |
| `src/lib/notificationPresentation.ts` | entity/action URL ใช้ canonical; ลิงก์ผิดไม่มี primary action |
| `src/services/notifications.ts` | `notificationDestination` อ่าน transfer ใน brand ที่เริ่มกด; หาย/อ่านไม่ได้/brand เปลี่ยน → ไม่เปิด |
| `src/components/notifications/NotificationBell.tsx` | ตรวจปลายทางก่อน navigate/markRead; loading feedback, keyboard button, functional label Logistics |
| `src/components/notifications/NotificationHost.tsx` | popup ใช้ resolver เดียวกัน; opening state ระบุ card; invalid/missing คง unread |
| `src/i18n/en.ts` | แปลข้อความ error/feedback |
| `tests/notification-link.test.ts` | generator, canonicalization, entity, URL rejection, exact Router parity |
| `tests/notification-destination.test.ts` | document ID, 3 brands, missing/denied, brand-switch race, receive/trailing slash; ไม่มี write |
| `e2e/notification-navigation.demo.ts` | controlled browser fixtures 14 กรณี |
| `playwright.notification.config.ts` | demo-only, port 5206, ไม่ใช้ข้อมูลจริง |
| `.github/workflows/ci.yml` | เพิ่ม navigation E2E ใน CI |

ไม่มีการเปลี่ยน `firestore.rules`, stock balances, schema หรือ persisted notification category.

## 3. ความเข้ากันได้กับ Notification เก่า

- แปลง `/logistics/:id` ตอนอ่าน/กดเท่านั้น; **ไม่มี Firestore migration**.
- เก็บ safe query/hash; ตัด trailing slash ก่อนตรวจปลายทาง.
- ปฏิเสธ external URL, protocol-relative, backslash/control/whitespace, malformed percent encoding,
  traversal/encoded separators, unsupported routes. รายการ route ตรง App.tsx โดยมี test ตรวจ drift.
- Transfer URL ห้าม `brand`, `brandId`, `company` query เพื่อเปลี่ยนบริษัท.
- อ่านเฉพาะ namespace ปัจจุบัน; ไม่ค้น brand อื่นแม้มี id เหมือนกัน.
- ถ้าหาย/ถูกลบ แสดงข้อความไม่พบและคง unread; deep link ตรงใช้ empty state เดิม.
- ไม่เพิ่ม legacy Router alias: Notification เก่าถูกแก้ครบที่ normalizer แล้ว; bookmark เก่าที่
  เปิด `/logistics/...` โดยไม่ผ่าน Notification ยังไม่มี redirect (ทางเลือก ไม่ใช่ acceptance gate).

## 4. Tests / RED → GREEN

| หลักฐาน | ผล |
|---|---|
| Unit ก่อนแก้ generator/presentation | 5 failed / 25 passed (`red-unit-312f8a7.log`) |
| Browser main legacy Bell click | RED ลง `/` |
| Review รอบแรกพบ trailing-slash bypass | RED เพิ่ม 3 กรณี missing destination (`red-review-trailing-slash.log`) |
| Full unit สุดท้าย `--maxWorkers=2` | **143 files / 1765 passed** |
| Browser สุดท้าย | **14/14 passed** (`green-browser-final.log`) |
| Typecheck รวม e2e/functions/worker | PASS ผ่าน `npm run build` |
| Lint / i18n / build / bundle budget | PASS; main 240 KB, initial JS 1804 KB |

Browser ครอบคลุม desktop/mobile, keyboard Enter, Browser Back, canonical และ legacy Bell,
popup, admin/manager/staff fixtures, pizza/lelapin/rnd, missing/other-brand-only/invalid URLs,
trailing slash/receive, document ID ต่างจากเลข TR, และตรวจ stock/transfer storage ไม่เปลี่ยน.
ReadBy เปลี่ยนเฉพาะ valid notification ที่เปิด; invalid/missing ไม่ถูกเขียนว่าอ่านแล้ว.

รันเต็มครั้งแรกมี PDF timeout ใน `request-pdfmake.test.ts` ที่ไม่เกี่ยวกับ diff; isolated PDF
ผ่านเดิม และ full suite จำกัด workers ผ่านทั้งหมด ไม่เพิ่ม timeout/ไม่ลบ test.

## 5. SHA / CI / Independent Review

- `62bface`: fix หลัก.
- `62fa3ba`: ปิด trailing-slash/receive bypass + card-specific feedback + regressions.
- Exact HEAD `62fa3ba`: **CI 10/10 SUCCESS** (GitHub Actions run `40079208603` + Pages).
- Gemini รอบ 1: APPROVE_WITH_NITS แต่มี P2 จริง → MAIN เพิ่ม RED และแก้.
- Gemini รอบ 2: **APPROVE**, ไม่เหลือ P0–P3 ตามการตรวจรอบนั้น.
- Actual T3 target `opencode / 9router/gemini-3.8-flash-high`; OpenCode assistant metadata ยืนยัน
  `providerID=9router`, `model.id=gemini-3.8-flash-high` ไม่ใช่เชื่อ self-label อย่างเดียว.

## 6. Preview QA

Deployment ของ exact head: `https://722d9218.pzmstock.pages.dev`.
ใช้ profile Cloudflare Access ที่ Owner login ไว้เดิมใน `~/r58/preview-profile` โดยไม่ export
cookie/token และไม่ปิด Access. `/products` HTTP200 → seed controlled browser-storage fixture →
legacy Bell click → `/transfers/tr-fixture` → แสดง `TR-00001`, stockMovements ยัง `{}`.
หลักฐาน `preview-62fa3ba.json`.

SW ของ preview นี้ยังใช้ `index.html` เพราะ #53 ยังไม่ merge; R63 ไม่ได้แก้/อ้างว่าซ่อม LINE.

## 7. Release readiness / dependency

**READY_FOR_RELEASE_APPROVAL สำหรับ app navigation เท่านั้น**.
ต้องได้รับอนุมัติ Production merge/deploy; ไม่ตีความ CI/preview/review เป็น approval.
แนะนำปล่อย #53 แยกก่อน แล้ว sync main เข้า #55 และรัน exact-head CI ใหม่หาก SHA เปลี่ยน.
R61/PR54 เป็น Rules defect คนละสาเหตุ; #55 ไม่ต้อง deploy Rules เพื่อเปิด navigation.

## 8. Rollback

ก่อน merge: คง PR HOLD หรือ revert commit บน branch โดยไม่ force-push.
หลังปล่อยโดยได้รับอนุมัติ: rollback Cloudflare ไป deployment ที่อนุมัติก่อนหน้า และ revert
app commits ของ #55 บน main ผ่าน PR. ไม่มี database migration/stock write ที่ต้องย้อน.
Notification ที่เก็บ legacy link ยังอยู่ตามเดิม ไม่ลบ/เปลี่ยนข้อมูลจริงเพื่อทดสอบ.

## Skill evidence

`tdd` (`~/.agents/skills/tdd/SKILL.md`, โหลด yes): หา callsites → unit/browser RED → fix → GREEN.
`receiving-code-review` (Superpowers path, โหลด yes): พิสูจน์ P2 ของ reviewer ด้วย RED ก่อนแก้.
`principle-prove-it-works` (`~/.agents/skills/.../SKILL.md`, โหลด yes): ตรวจ browser ที่รันจริง,
preview deployment และ SHA/CI; ไม่ใช้ compile แทน navigation proof.
`verification-before-completion` / `ponytail` (Pi skills paths, โหลด yes): full gates, diff inspection,
ไม่เพิ่ม schema/dependency/migration. ยังไม่ตรวจ real-phone Production เพราะไม่มี release approval.
