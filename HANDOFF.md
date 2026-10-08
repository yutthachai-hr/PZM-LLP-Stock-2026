# Inventory Pzm — สรุปส่งต่องาน

## 0. สถานะปัจจุบัน — อ่านส่วนนี้ก่อน (อัปเดต 8 ต.ค. 2569)

> **อัปเดตล่าสุด 8 ต.ค. 2569 ช่วงบ่าย:**
>
> - **สถานะ RC:** ดู `docs/release/rc-readiness.md` (ตารางแยก PASS / FAIL / BLOCKED / NOT RUN)
> - **งานที่เจ้าของต้องทำบน cloud:** ดู `docs/ops/owner-gates.md`
>   - A: ลบ preview เก่า
>   - B: cron Worker ที่ deploy อยู่เป็นแค่ตัว placeholder จึงยังไม่เคยมี cron รันเลย
>   - C: ส่งออก metric รายชั่วโมง (เหตุการณ์อ่านข้อมูลพุ่งวันที่ 6 ต.ค. ยัง**ไม่ปิด**)
> - **Branch:**
>   - `integration/ops-os-rc1` push ขึ้น GitHub แล้วที่ `0261c48` (เจ้าของ push เอง) ส่วน commit หลังจากนั้นยังอยู่ในเครื่อง
>   - merge `main` ล่าสุด (`476fa35` แบรนด์ R&D) เข้ามาแล้ว
>   - preview ของ branch นี้ถูกแยกจาก production แล้ว (`0261c48`) จึง push ได้อย่างปลอดภัย
> - **Production ตอนนี้:** deployment `aa6b85cb` = `476fa35`
> - **Goose:** สรุปผลเป็น RESEARCH ONLY (`docs/research/goose-adoption-decision.md`)
>
> ข้อความในตารางข้างล่างบางส่วนเขียนไว้ก่อนการอัปเดตนี้

> ส่วนนี้คือความจริง ณ ปัจจุบัน หัวข้ออื่นข้างล่าง (§1 เป็นต้นไป) เป็นประวัติ ซึ่งอาจล้าสมัยแล้ว ถ้าข้อมูลขัดกัน ให้เชื่อส่วนนี้

| เรื่อง | ค่าปัจจุบัน |
|---|---|
| Repo หลัก | `github.com/yutthachai-hr/PZM-LLP-Stock-2026` ⚠ **public** บน GitHub (ข้อความใน §1 ที่ว่า private ล้าสมัยแล้ว) |
| Branch ที่ใช้รวมงาน | **`integration/ops-os-rc1`** (สร้าง 8 ต.ค. จาก `claude/phase-a-ledger-continue-uzbbb5`) ยังอยู่ในเครื่องเท่านั้น **ยังไม่ push** (เหตุผลดูข้อ ⚠ preview ข้างล่าง) |
| HEAD ของ integration | ดู `git log -1 integration/ops-os-rc1` ส่วน merge `main` คือ `ba753aa` |
| Branch งานของ Claude | `claude/phase-a-ledger-continue-uzbbb5` · บน GitHub อยู่ที่ `2ae7bbb` · ในเครื่องอยู่ที่ `99ef7ea` (มี commit G25/G18/G19/G21 ที่ยังไม่ push) |
| Production `main` | **`2a8d578`** (merge perf/firestore-read-budget, 6 ต.ค.) |
| ที่ deploy แล้ว | เว็บ: Cloudflare Pages build `main` ให้อัตโนมัติไปที่ `https://pzmstock.pages.dev` (ถ้าอยู่บน `main` ถือว่า deploy แล้ว) |
| ที่ยังไม่ยืนยัน | rules + indexes ของ `2a8d578` (`audienceKeys`, notification index) ซึ่งหลักฐานของ main กำหนดให้ deploy *ก่อน* merge **เจ้าของต้องยืนยันว่า deploy แล้ว** ถ้ายังไม่ได้ deploy กระดิ่งแจ้งเตือนจะ fallback ไปจำกัดที่ 60 รายการ |
| ที่ยังไม่ deploy | ทุกอย่างบน integration: Phase G (G1–G17), G18/G19/G21/G25, outbox, Supabase shadow, rules ใหม่ (version / traceId) และ Worker shadow cron |
| Supabase | มีแค่ **shadow** ยังไม่มี project จริงเชื่อมอยู่ outbox merge แล้วแต่ **ปิดอยู่** (`OUTBOX_ENABLED` ไม่ได้ตั้ง) Worker replicate ก็ต่อเมื่อมี `SUPABASE_DB_URL` Firestore ยังเป็น source of truth ไม่มี dual-write และไม่มี cutover |
| Phase G | G1–G16 เสร็จพร้อมหลักฐาน (`docs/evidence/phase-g-agent-safety.md`) · **G17 Laya: NOT EVALUATED** มีแต่ harness ยังไม่ได้ artifact จริง (`phase-g17-laya.md`, `docs/agent-safety/02-upstream-verification.md`) · Kat/Reflex: NOT_RUN |
| ชุดแรก G18–G27 | G25, G18-lite, G19, G21 มีบน integration แล้ว (`docs/evidence/phase-g-batch1.md`) ส่วน G20 และ G22–G27 ยังไม่ทำ |
| CI | **ไม่มีเลย** ทั้ง workflow, branch protection และ ruleset ข้อเสนออยู่ที่ `docs/engineering/ci-proposal.md` (ยังไม่ได้เปิดใช้อะไร) |

### ⚠ ข้อควรระวังก่อน push / deploy

1. **Preview ต่อกับ production:** Cloudflare Pages build ทุก branch ที่ push เป็น preview และใช้ Firebase **ตัวจริง** (มีเฉพาะ branch `demo` ที่เป็น demo mode) ข้อเสนอให้แก้ 1 บรรทัดอยู่ใน `ci-proposal.md` ควรได้รับอนุมัติก่อน push integration
2. **ลำดับ deploy ของ G25:** rules ใหม่จะปฏิเสธการแก้ PO หรือสินค้าที่ไม่ขยับ `version` **ต้อง deploy แอปก่อน rules** และ tab PWA เก่าจะเขียนไม่ผ่านจนกว่าจะ reload
3. **ห้าม merge เข้า `main` เอง** เพราะ `main` deploy production อัตโนมัติ

### Release blockers (RC ยังไม่ freeze)

- [ ] เจ้าของอนุมัติการ push integration และการแก้ preview
- [ ] e2e และ flaky runs ผ่านบน integration (cloud หรือ CI)
- [ ] baseQty dry-run กับ backup จริง (เจ้าของทำ)
- [ ] ตรวจ backtest Phase G กับ backup จริง (เจ้าของทำ)
- [ ] Firestore read budget ไม่ถดถอย (รัน `e2e/read-budget.spec.ts` ของ main บน integration)
- [ ] ไม่มี P0/P1 ค้าง
- [ ] verify ผ่านจาก clean checkout
- [ ] CI ตาม `ci-proposal.md` เปิดใช้และเขียว

**ห้าม freeze RC จนกว่าทุกข้อข้างบนจะผ่าน แล้วต้องขออนุมัติเจ้าของก่อน**

### เปิดงานต่อใน session ใหม่

```bash
cd pizza-stock-ledger            # worktree ของ integration/ops-os-rc1
git status --short && git log --oneline -8
npm ci && npm run verify -- --full   # 15 ด่าน รวม rules emulator (ต้องมี Java) และ Rust (ต้องมี cargo)
```

---

## ประวัติ (historical — ดู §0 สำหรับสถานะปัจจุบัน)

เอกสารนี้เขียนไว้ให้เปิดงานต่อได้จากศูนย์ ไม่ว่าจะเป็น Claude session ใหม่หรือ account ใหม่ — สรุปทุกอย่างที่ทำไปแล้ว อะไร deploy แล้วบ้าง อะไรค้างอยู่ และกติกาที่ต้องรู้ก่อนแตะโค้ดต่อ

อัปเดตล่าสุด: **14 กันยายน 2569** — ดู `git log` สำหรับ commit ล่าสุด

---

## 1. สถานะตอนนี้ (ยืนยันแล้ว ณ วันที่เขียน)

| อย่าง | สถานะ |
|---|---|
| Git `main` | ตรงกับ `origin/main`; สั่งซื้ออัตโนมัติ 15 ก.ย.; รายการขอสั่งซื้อ + `manager` 15 ก.ย.; Cloudflare-only 17 ก.ย.; **ปฏิทินคลัง Phase A + purchasing polish 17 ก.ย.** (branch `feat/inventory-calendar` ยังใช้ต่อสำหรับ Phase B–D) |
| Firestore rules | **deploy แล้ว 17 ก.ย.** ตรงกับไฟล์ที่ commit (รวม expression-budget split, supplier `orderDays/cutoffTime`, PO `expectedAt`) |
| Hosting | **Cloudflare Pages เท่านั้น (ตัดสลับ 17 ก.ย.)** `https://pzmstock.pages.dev` build จาก `main` อัตโนมัติ; branch `demo` → `https://demo.pzmstock.pages.dev` (demo mode จากชื่อ branch) — Netlify เลิกใช้แล้ว |
| Firebase project | `pzm-stock-x5` (ทั้งสองแบรนด์ใช้ project เดียวกัน แยกด้วย collection prefix) |
| Repo | `github.com/yutthachai-hr/PZM-LLP-Stock-2026` (private) |
| Demo mode | `npm run demo` — แยกจากของจริงสนิท ปลอดภัยสำหรับทดสอบทุกฟีเจอร์ |

**ถ้าเปิด session ใหม่แล้วจะ deploy อะไร ให้เช็คก่อนเสมอ:**
```bash
git status --short && git log --oneline -5
npx firebase deploy --only firestore:rules --project pzm-stock-x5
```
ถ้าขึ้น "already up to date, skipping upload" แปลว่า rules ตรงกับโค้ดอยู่แล้ว ไม่ต้องทำอะไรเพิ่ม

---

## 2. ระบบนี้คืออะไร

**Inventory Pzm** — ระบบบริหารสต๊อกสำหรับ 2 แบรนด์ในบริษัทเดียวกัน (Pizza Mania และ Le Lapin) บน React + TypeScript + Vite + Tailwind, Firebase **Spark (ฟรี)**

ข้อจำกัดที่คุมทุกการตัดสินใจด้านสถาปัตยกรรม: **Firebase Spark ให้ 50,000 document reads/วัน และ 20,000 writes/วัน สำหรับทั้งสองแบรนด์รวมกัน** ทุกฟีเจอร์ที่เพิ่มเข้ามาถูกออกแบบให้กิน quota น้อยที่สุด — อ่านครั้งเดียวต่อ session ไม่ subscribe แบบ realtime ถ้าไม่จำเป็นจริง ๆ, ใช้ field แทนการเพิ่ม collection ใหม่เมื่อทำได้ (อ่านแผนโควตาฉบับเต็มที่ [`FIREBASE_QUOTA_PLAN_FOR_GEMINI.md`](FIREBASE_QUOTA_PLAN_FOR_GEMINI.md))

---

## 3. โครงสร้างที่ต้องเข้าใจก่อนแตะโค้ด

- **Multi-tenancy แบบ prefix ชื่อ collection**: `products` = Pizza Mania, `lelapin__products` = Le Lapin ฟังก์ชัน `resolveCollection()` ใน `src/brand/brand.ts` จัดการเรื่องนี้ — ห้ามเขียน query ตรงไปที่ชื่อ collection โดยไม่ผ่านตัวนี้
- **Backend abstraction** (`src/backend/types.ts`): มี 2 implementation จริง (`firestore.ts`, `local.ts` สำหรับ demo) และ 1 test double (`tests/helpers/memory-backend.ts`) — เทสต์ทุกตัวรันผ่าน backend ปลอม ไม่แตะ Firestore จริง
- **`DataContext`** เปิด subscription แบบ realtime อยู่ **7 ตัวเท่านั้น** (products, locations, stockLevels, movements-30วันล่าสุด, notes, minOverrides, users) — อะไรที่ไม่ใช่ 7 ตัวนี้ต้องอ่านแบบ one-shot (`getAll`/`getRange`/`getBy`) แล้ว cache เอง
- **firestore.rules**: ไฟล์เดียว, catch-all `match /{collection}/{docId}` กับ allow-list `staffWritable()`/`adminWritable()` ที่ต้องลงทั้งสองชื่อแบรนด์เสมอ ทุก collection มี validator ของตัวเองที่ใช้ `hasOnly()` ปิดรูป
- **ถอด auto-logout 20 นาทีออกอย่างถาวร (14 ก.ย.)**: ตามคำสั่งเจ้าของระบบ อุปกรณ์สาขา/แท็บเล็ตจะคงสถานะเข้าสู่ระบบไว้ตลอดเวลา ไม่มีการเตะออกเมื่อไม่ใช้งาน เพื่อไม่ให้ขัดจังหวะการนับสต๊อกและป้องกัน Cold Start Read Spike บน Firestore (ดูรายละเอียดและแผนโควตาใน `FIREBASE_QUOTA_PLAN_FOR_GEMINI.md`) ส่วน `clearLocalCaches()` จะล้าง IndexedDB เฉพาะตอนกด "ออกจากระบบ" เองเท่านั้น; ledger ที่โหลดตอนเปิดลดจาก 90 → 30 วัน (`RECENT_DAYS`)
- **i18n**: ข้อความไทยคือ key เอง ไม่มีไฟล์ key แยก เช็คด้วย `node scripts/i18n-check.mjs` — เครื่องมือนี้มองไม่เห็น template literal และ Thai ใน JSX comment ระวังตรงนี้

---

## 4. Feature ที่สร้างไปแล้ว (เรียงตามลำดับที่ทำ)

### สต๊อกพื้นฐาน + หน่วยนับ
- หน่วยที่กรอกได้ตอนรับเข้า/เบิก/ปรับสต๊อก มาจาก dropdown ที่เจ้าของตั้งเองใน **ตั้งค่า** (`src/services/entryUnits.ts`) ไม่ใช่พิมพ์เอง
- **กติกาหน่วย 20 ก.ย. 2569 (กลับด้านจาก 13 ก.ย.)**: ยอดคงเหลือ**แถวเดียวต่อสินค้าต่อคลัง เป็นหน่วยหลักของสินค้า** (`unitType`) ทุกจำนวนที่คีย์เป็นหน่วยอื่นถูก**แปลงตอนบันทึก**ด้วยอัตราของสินค้านั้น (`Product.unitConversions` "1 Carton = 500 EA" — ตอนนี้เป็นอัตราจริง ไม่ใช่อ้างอิง) หรือมาตรฐาน g↔kg / ml↔L (แค่สองอย่างนี้ตามที่เจ้าของเลือก) movement เก็บทั้ง `entryQty`+`entryUnit` (ที่คีย์) และ `qty` (หน่วยหลัก) → อัตรา ณ ตอนบันทึก = qty/entryQty คงอยู่ตลอดแม้แก้อัตราภายหลัง โมดูล: `src/lib/inventoryRules/uom.ts` (pure, Worker ใช้ด้วย) + `src/lib/uom.ts` (`entryFor` โยน AppError) `describeQty()` = "2 Carton (= 1000 EA)"
- **5 หน่วยของบริษัท (เจ้าของอธิบาย 20 ก.ย.)**: EA = หน่วยนับเล็กสุด/สำคัญสุด (สิ่งที่เบิกออก); Pack = ชั้นกลาง; Carton = หน่วยซื้อ ตั้งเป็น Pack/EA/KG ก็ได้; KG = ชั่งน้ำหนัก บางตัวนับชิ้นด้วย; **Lot = ฟืนอย่างเดียว (1 Lot = 1 คันรถ) → เป็นหน่วยหลักของสินค้าฟืนเอง ไม่ใช่อัตราแปลง** และควรเอา Lot ออกจากลิสต์หน่วยกลาง (เจ้าของทำเองใน UI) แถวอัตราอ่านว่า **`per` label = `size` of `of`** (`UnitConversion {label,size,per?,of?}`; `of` = แถวอื่นหรือหน่วยหลัก) จึงต่อเป็นชั้นได้: {Carton,12,of:'Pack'}+{Pack,25} → Carton = 300 EA; {KG,1,per:2.72} บนสินค้า EA = "2.72 KG = 1 EA"; {EA,1,per:10} บนสินค้า KG = "10 EA = 1 KG" `resolveFactor` ไล่ chain (กันวน/ค้าง ≤6 ชั้น) `normaliseConversions(rows, base)` ทิ้งแถวอ้างอิงหน่วยที่ไม่มี/วนลูป `breakdown()` = "1 Carton 20 EA" ใต้ยอดในหน้าสินค้า/Stock Card; QtyInput เตือน (ไม่บล็อก) เมื่อหน่วยนับได้เศษ ("0.368 EA") editor: `ConversionRows` (`[per] [unit▾] = [size] [of▾]`) prompt `DefineConversionModal` มี of▾ และปุ่ม "สลับ" ("1 KG = ? EA")
- **หน่วยที่ยังไม่มีอัตรา** จะเลือกได้แต่ระบบ**ถามอัตราครั้งเดียว** (`DefineConversionModal` "1 Pack = ? EA") บันทึกลงสินค้า (`services/products.addConversion`; rules ยอมให้ staff แก้ได้เฉพาะ `unitConversions`+`updatedAt`) แล้วไม่ถามอีก แก้ได้ที่หน้าสินค้า (Products → อัตราแปลงหน่วย) ใบสั่งซื้อ/ขอสั่งซื้อ: หน่วยไม่มีอัตรา = สั่งไม่ได้/บล็อกอนุมัติ (`blockingIssues`)
- **PO**: บรรทัดเก็บ `baseQty` (หน่วยหลัก ณ อัตราตอนสั่ง) ตอนรับของแปลงด้วยอัตราของบรรทัด (`baseQty/orderedQty`) ไม่ใช่อัตราปัจจุบัน; บรรทัดเก่าไม่มี `baseQty` ใช้อัตราสินค้าตอนรับ ถ้าไม่มี → ปฏิเสธพร้อมชื่อสินค้า+หน่วย ใบ PO ยังพิมพ์หน่วยที่สั่ง (ผู้ขายเห็น "3 Pack") มี "= 36 EA" ตัวเล็ก
- **ยอดเก่าแยกหน่วย (legacy)**: แถว `loc__prod#Unit` และ movement ที่มี `entryUnit` แต่ไม่มี `entryQty` ยังทำงานแบบเดิม (void/แก้วันที่ได้) จนกว่าจะแปลงด้วย **ตั้งค่า → "แปลงยอดแยกหน่วยเป็นหน่วยหลัก"** (`services/unitMigration.ts`: ต่อสินค้า, ต้องมีอัตราครบ, เขียน `entryQty`+`qty` ต่อ movement พร้อม edit ที่เซ็นชื่อ แล้ว `rebuildProductLevels` — idempotent/รันซ้ำได้) Products/Reports โชว์ badge "ยังไม่แปลง" `qtyAt` ยังมองแค่แถวหลัก `changeProductUnit` ปฏิเสธถ้ายังมีอัตรา/ประวัติที่แปลงแล้ว
- **เปลี่ยนหน่วยหลักของสินค้าที่มีประวัติแล้ว (21 ก.ย.)**: **ตั้งค่า → "เปลี่ยนหน่วยหลักพร้อมคำนวณ"** (`services/unitRebase.ts` + `pages/settings/RebaseUnitSection.tsx`, admin) — `changeProductUnit` แค่เปลี่ยนป้าย (75 KG → "75 Lot" ถูกสำหรับฟืน ผิดสำหรับชีส) ตัวนี้คำนวณจริง 2 โหมด: **ตามอัตรา** ("1 EA = 2.72 KG") ทุกแถวที่คีย์เป็นหน่วยเดิมกลายเป็น `entryUnit`=หน่วยเดิม, `entryQty`=ที่คีย์, `qty`=หาร factor (อ่านได้ "27.2 KG (= 10 EA)"); แถวที่คีย์เป็นหน่วยใหม่อยู่แล้วกลายเป็นแถวหลักตรง ๆ; PO ที่เปิดอยู่ถูกเขียนใหม่เป็น Revision; อัตราของสินค้าถูก restate (`{label: หน่วยเดิม, size: 1, per: factor}` + ตัวอื่นหาร); สาขาที่แปลงแล้วไม่เต็มหน่วยต้องกรอกนับจริง (บันทึกเป็น adjust reason `opening` ผ่าน `setStockCount`) **นับจริงใหม่** (catch weight เช่น PARMA HAM ขาละไม่เท่ากัน): แถวน้ำหนักเดิมกลายเป็น legacy row บนยอด `#KG` แล้วปิดยอดนั้นด้วย adjust reason `count` ที่เซ็นชื่อ ยอดใหม่ = นับจริงทุกสาขา (บังคับกรอก) และห้ามมี PO เปิดอยู่ ทุกแถวมี edit ลงชื่อ, รันซ้ำได้ (แถวที่เป็นหน่วยใหม่แล้วถูกข้าม), สินค้าถูกสลับหน่วย **หลังสุด** แล้ว `rebuildProductLevels` ไม่ต้องแก้ rules (ใช้ movementEdit/orderEdit เดิม) เทสต์ `tests/unit-rebase.test.ts`
- แก้ไขรายการย้อนหลังได้ครบ: จำนวน/วันที่/หมายเหตุ/**หน่วย**/**คลังต้นทาง-ปลายทาง** — ย้ายยอดข้ามคลัง/หน่วยได้โดยไม่ต้องยกเลิกแล้วคีย์ใหม่
- **ประวัติการแก้ไขทุกครั้งเก็บสะสม** (`edits[]` บน movement) ไม่ใช่แค่ "แก้ล่าสุดโดยใคร" — กันการสวมชื่อ, rules บังคับว่าต้องต่อประวัติพอดี 1 รายการและเซ็นชื่อผู้เรียกเองเท่านั้น
- แก้หน่วยของ**ตัวสินค้าเอง**ได้ (ไม่ใช่แค่รายการ) พร้อม restamp ประวัติเก่าทั้งหมดให้ตรง — มี cap 1,000 รายการต่อครั้งกันงานหนักเกิน
- ซ่อนสินค้าได้ (ไอคอนตา 👁/🙈) แทนการลบ — ยอด/ประวัติอยู่ครบ กู้คืนได้
- ผู้ขายก็ซ่อนได้แบบเดียวกัน (`active: false`) — หายจาก dropdown หน้าสั่งซื้อและหน้าแก้ไขสินค้า, หาเจอที่ตัวกรอง "ที่ซ่อนไว้" ในหน้าผู้ขาย (ตัวกรอง: สถานะ / รับคืนของ / เรียงตาม พับหลังปุ่มเหมือนหน้าสินค้า)
- ~~อัตราแปลงหน่วยอ้างอิง (ไม่บันทึกแปลง)~~ → ตั้งแต่ 20 ก.ย. เป็นอัตราจริง (ดูข้อกติกาหน่วยด้านบน) หน่วยที่มีอัตราจะเป็นตัวเลือกในช่องหน่วยแม้ไม่ได้อยู่ในลิสต์ Lot/Pack/EA ของตั้งค่า (ขนาดลังไม่เท่ากันทุกสินค้า ไม่ควรเป็นลิสต์ส่วนกลาง) `QtyInput` ส่ง `QtyEntry {qty, entryQty, entryUnit, factor}`; `entryUnitsFor()` ให้ `factor: number|null`; `UnitSelect` สำหรับหน้าที่แยกช่องตัวเลข

### ปฏิทินคลัง (`src/pages/Calendar.tsx`)
- อ่านทีละเดือน ไม่ subscribe (`stockEvents` collection)
- กดช่องวัน → panel ด้านขวาแสดงงานวันนั้น + "เพิ่มงานวันนี้" (ใส่วันที่ให้แล้ว); กดการ์ดสรุป → ไปมุมมองรายการ
- ผู้รับผิดชอบเลือกได้ **ทุกคน / หลายคน / คนเดียว** — `assignedTo` เป็น `string[]` (งานเก่าเป็น string เดี่ยว อ่านผ่าน `assigneesOf()`), "ทุกคน" คือ `assignedToAll: true` ไม่ใช่ list ทุก uid — **rules deploy แล้ว 13 ก.ย.** รับทั้งสองแบบ
- ประเภท "สั่งประจำสัปดาห์" **ถูกถอดออกแล้ว** (13 ก.ย.) — งานสั่งของอยู่ในหน้าสั่งซื้อ และ rules ก็ไม่เคยยอมรับ type นี้อยู่แล้ว จึงไม่มี event แบบนี้ใน production

### ผู้ขาย (`src/pages/Suppliers.tsx`, `src/lib/supplierName.ts`, `src/services/supplierImport.ts`)
- อ่านชื่อผู้ขายจากวงเล็บในชื่อสินค้าอัตโนมัติ (454 ชื่อ → **103 ผู้ขาย** หลังกรองขนาดบรรจุ/รวมสะกดผิด)
- หน้า "นำเข้าจากชื่อสินค้า" ให้ตรวจรับก่อนเขียนจริง ไม่ auto-apply
- เปลี่ยนชื่อผู้ขาย → เขียนทับวงเล็บในชื่อสินค้าทุกตัวที่ผูกกับเจ้านั้นอัตโนมัติ
- ลิงก์ผู้ขาย↔สินค้าเก็บเป็น field `supplierId` บนตัวสินค้า **ที่เดียว** — หน้าผู้ขาย, หน้าสั่งซื้อ, ตัวนำเข้า และหน้าแก้ไขสินค้า อ่าน/เขียนฟิลด์นี้ทั้งหมด ส่วน `supplierItems` เก็บแค่**ราคาซื้อ** (เขียนเฉพาะตอนมีราคา) ไม่ใช่ตัวลิงก์ — ก่อน `e311b9b` หน้าผู้ขายอ่านจาก `supplierItems` จึงขึ้น "ยังไม่ได้ผูกสินค้า" ทั้งที่นำเข้าไปแล้ว 299 รายการ
- ปุ่ม "เพิ่มสินค้า" ในหน้าผู้ขาย แบ่ง dropdown เป็น 2 กลุ่ม: สินค้าที่ยังไม่มีผู้ขาย (สำหรับตัวที่ชื่อไม่มีวงเล็บ) และสินค้าที่อยู่กับรายอื่น (เลือกแล้ว = ย้าย พร้อมลบราคาเก่า)

### ระบบสั่งซื้อ (`src/pages/Orders.tsx`, `src/services/purchaseOrders.ts`) — collection ที่ 4: `purchaseOrders`
- เลือกผู้ขาย → สินค้าของเจ้านั้นเด้งมาให้ทั้งหมดอัตโนมัติ
- **หน่วยที่สั่ง** ใช้ตัวเลือกเดียวกับหน้ารับเข้า (หน่วยของสินค้า → กรัม/มล. → หน่วยที่เจ้าของตั้งใน ตั้งค่า) เก็บเป็น `entryUnit` บนบรรทัดเฉพาะเมื่อไม่ใช่หน่วยของสินค้า และตอนตรวจรับจะเข้ายอดคงเหลือของหน่วยนั้น (สั่ง 3 Pack → ยอด `#Pack` = 3 ไม่ใช่ 3 KG) — เลือกหน่วยไม่ตรงกับหน่วยรับเข้า**ได้** แต่ขึ้นเตือนสีแดงทั้งที่บรรทัดและก่อนปุ่มยืนยัน (กติกาเจ้าของ 13 ก.ย.)
- ตรวจรับของแบบเช็กลิสต์: ติ๊กถูก หรือแก้จำนวน+**ต้องใส่เหตุผล** ถ้าไม่ตรง, **ต้องมีเลขบิล**ก่อนเข้าคลังเสมอ
- ยืนยันรับแล้ว → เขียน stock receipt จริงทันที (เส้นทางเดียวกับรับเข้าด้วยมือ)
- Dashboard: แท็บรอรับของ/รับของแล้ว/สรุปตามผู้ขาย, เตือนสีแดงถ้าเกิน 3 วันยังไม่ได้ของ
- ใบสั่งซื้อพิมพ์ A5 ได้ หรือแคปหน้าจอส่งไลน์
- ปุ่ม Excel / PDF ข้างช่วงวัน ออกรายการสั่งซื้อ 1 แถวต่อ 1 บรรทัดสินค้า (วันไหน ผู้ขายไหน สินค้าอะไร เท่าไร รับแล้วเท่าไร บิลอะไร)
- ใบที่ "รับของแล้ว" **ลบไม่ได้แม้แต่ Admin** (เป็นหลักฐานของ stock receipt ที่ลบไม่ได้เหมือนกัน)
- **18 ก.ย. — ใบสั่งซื้อไม่ลบอีกต่อไป (กันทุจริต)**: "ยกเลิก" = สถานะ `cancelled` + `cancelReason` + `cancelledBy/Name/At` (ต้องใส่เหตุผล) เลข PO ไม่ถูกนำกลับมาใช้; แท็บ "ยกเลิกแล้ว" เป็นตาราง; ใบขึ้นตรา "ยกเลิกแล้ว" สีแดง; Excel/PDF มีคอลัมน์ผู้ยกเลิก+เหตุผล; rules: staff ลบได้เฉพาะ `status == 'draft'` (ร่างจากชุดนำเข้า Excel ที่ระบบสร้างซ้ำได้ — `deletePurchaseOrder` ก็รับเฉพาะร่าง), ใบยกเลิกแล้วแก้ไม่ได้ยกเว้น admin
- **18 ก.ย. — แก้ไขใบที่สั่งแล้ว = PO Revision** (`amendPurchaseOrder`): เลขเดิมคงไว้, `revision` นับ 1,2,3, `revisions[]` เก็บ `{rev, at, by, byName, reason, changes[]}` โดย `changes` เป็น data (`qty|add|remove|expectedAt|note` + from/to) แล้วแปลข้อความตอนแสดง; ใบขึ้น "PO-00002 · Rev.1"; ประวัติการแก้ใต้ใบใน OrderSheet; badge "แก้ไขแล้ว — ยังไม่ส่งใหม่" เมื่อ `needsResend()` (เคยส่ง LINE แล้วและ `sentAt` < revision ล่าสุด); **rules: บรรทัด/กำหนดส่งของใบที่สั่งแล้วเปลี่ยนได้เฉพาะพร้อม `revisions` ที่ยาวขึ้น** (หรือตอนรับของ) — แก้เงียบ ๆ ถูกปฏิเสธ; ร่างยังแก้อิสระ; ใบรับแล้วปิดถาวร
- **กำหนดส่ง (`expectedAt`)** ตั้งได้ตอนสร้างเท่านั้น: หน้าสั่งเอง (prefill จาก lead time) และ **popup ตอนแปลง PR → PO** (`ConvertModal` ใน RequestReview: วันต่อผู้ขาย, `convertToOrders({ expectedAt: {supplierId: ms} })`) หลังจากนั้นเปลี่ยนผ่าน Revision เท่านั้น (`setExpectedDelivery` ถูกลบ 18 ก.ย.)
- **บั๊กวันที่รับของ (แก้ 18 ก.ย.)**: `receivePurchaseOrder` เคยประทับ `receivedAt = Date.now()` ทั้งที่ stock movement ใช้วันที่เลือก → ใบรับของทุกใบขึ้นวันคีย์; ตอนนี้ใช้ `params.date`; ใบเก่าซ่อมด้วย Settings → ดูแลข้อมูล → "ซ่อมวันที่รับของตามใบรับสินค้า" (`repairReceivedDates`: ดึง `date` จาก movement ที่ `movementDocNo` ชี้) **เจ้าของต้องกดเองครั้งเดียวต่อแบรนด์หลัง deploy**
- **เลข PO รันแยกตามผู้ขาย** (`counters/purchaseOrder__<supplierId>`, 14 ก.ย.) — ใบเก่า 8 ใบที่ออกใต้ตัวนับรวมยังเลขเดิม (rules ล็อกไว้) ตัวนับของแต่ละเจ้าเริ่มจาก max(จำนวนใบที่มี, เลขสูงสุดที่พิมพ์ไปแล้ว) เพื่อไม่ให้เลขซ้ำ (`orderCounterFloors`)
- **ไฟล์สำรอง (format v3)** รวม suppliers / supplierItems / stockEvents / purchaseOrders แล้ว — ก่อนหน้านี้ 4 collection นี้ไม่อยู่ในไฟล์เลย กู้คืนแล้วใบสั่งซื้อและผู้ขายจะหายหมด; ใบสั่งซื้อเป็น append-only ตอนกู้คืนเหมือน ledger (ไม่ทับใบที่รับของไปแล้ว); rebuild ยอดคงเหลือหลังกู้คืนรู้จักยอดแยกหน่วย (`#Pack`) แล้ว — เดิมล้างเป็น 0

### สั่งซื้ออัตโนมัติจาก Excel (branch `feat/purchase-automation`, 14 ก.ย.) — collection ที่ 5–6: `purchaseBatches`, `productAliases`

เป้าหมายจากเจ้าของ: พนักงานไม่ต้องจำว่าสินค้าซื้อจากใคร ไม่ต้องสร้าง PO ทีละเจ้า ไม่ต้องเซฟรูปเอง — Excel → จับคู่ผู้ขาย → จัดกลุ่ม → ร่าง PO → รูป → อนุมัติ → ส่ง LINE ทีละราย ผู้ขายยังได้ "รูปใบสั่งซื้อ 1 รูป" เหมือนเดิม ไม่เพิ่มบริการเสียเงิน ใช้ LINE ส่วนตัวของพนักงาน

**กติกาเดียวที่อยู่เหนือทุกอย่าง: ระบบไม่เดาผู้ขาย** แถวไหนไม่แน่ใจ (ชื่อไม่ตรง, ชื่อเดียวกันสองผู้ขาย, ช่องจำนวนเป็นคำว่า "ตาม", หน่วยแปลก) → "ต้องตรวจ" และไม่เข้าใบสั่งซื้อจนกว่าคนจะเลือก

**ไฟล์ Excel จริง** (`samples/` — gitignored, ห้าม commit): ชีตเดียวมีหลาย "บล็อก" วางข้างกัน บล็อกละวันสั่ง หัว `ชื่อวัตถุดิบ | รอบส่ง | หน่วย | SKV | SRS | ONNUT | รวม | จำนวนสั่ง | เรียกเข้า` ตำแหน่งเริ่มไม่คงที่ ช่องจำนวนมี ตัวเลข / `-` / `ตาม` → `src/lib/orderSheet.ts` หาบล็อกจากหัวตารางเอง (ไม่ fix คอลัมน์) ถ้าหาไม่เจอมีหน้าให้พิมพ์ตัวอักษรคอลัมน์เอง (จำใน localStorage)

**การจับคู่ชื่อ** `src/lib/productMatch.ts`: normalise (ตัดวงเล็บผู้ขาย, `2.26KG`=`2.26 KG`, `kg.`) → ตรง SKU / alias ที่เคยยืนยัน / ชื่อตรงพอดี 1 รายการ = ตอบได้; ชื่อตรงหลายรายการ (`BLUE CHEESE 3 KG` มี TOPFOOD กับ FOOD PROJECT) = ถาม; ที่เหลือเสนอ candidate (Dice ของคำ) ให้เลือก **ไม่ auto-confirm fuzzy เด็ดขาด** (`PEPPERONI` ตรง 3 รายการ → ถาม) ยืนยันแล้วเก็บเป็น `productAliases` (staff เขียนได้) ครั้งหน้าไม่ถามอีก

**โมเดล** (`src/types.ts`): `Product.supplierId` = ผู้ขายประจำ (มีอยู่แล้ว) + `alternateSupplierIds[]`; `Supplier.defaultLocationId/leadTimeDays`; `SupplierItem.minOrderQty`; `PurchaseBatch` = 1 ครั้งนำเข้า (`PB-YYYYMMDD-NNN`, rows/groups/history ในเอกสารเดียว, history append-only = audit log); `PurchaseOrder` เพิ่ม `batchId`, `status:'draft'` (มีใน type/rules อยู่แล้ว เพิ่งมีคนเขียน), `approvedBy/At`, `shareStatus` (`shareOpened|sent|skipped|failed`) — **`sent` = LINE รายงานว่าส่งแล้ว (shareTargetPicker คืน `status:'success'`) ไม่ใช่ผู้ขายอ่านแล้ว** หน้าจอใช้คำว่า "ส่งเข้า LINE แล้ว"

**บริการ** `src/services/purchaseBatch.ts`: `buildBatchRows` → `assessRows` (pure, คำนวณ issue ใหม่ทุกครั้งที่แก้: unknown/ambiguous/noSupplier/qtyUnclear/unitMismatch/duplicateProduct = review; supplier/product ซ่อน = block; belowMoq/suspiciousQty (>3× สูงสุดใน 90 วัน เมื่อมี ≥3 ครั้ง)/possibleDuplicateOrder (สั่งเจ้าเดิมวันนี้แล้ว) = warn ต้องติ๊ก) → `groupRows` (เฉพาะแถวที่มีผู้ขาย) → `ensureDraftOrders` (ร่าง PO ต่อกลุ่มที่พร้อม ผ่าน `createPurchaseOrder` ตัวเดิม เลขรันต่อผู้ขายเหมือนเดิม; แถวเปลี่ยน = ลบร่างสร้างใหม่, ใบที่อนุมัติแล้วไม่แตะ) → `approveBatch` → `settleSendStatus`. `src/services/purchaseOrders.ts`: `approvePurchaseOrder` (draft→ordered, orderedAt ใหม่, ลงชื่อ), `setShareStatus`; ตรวจรับปฏิเสธ draft

**หน้าจอ** `src/pages/purchase/`: `/purchase` (ชุด 30 วัน + filter), `/purchase/import` (ไฟล์ → รอบ/คลัง → preview ทุกแถวพร้อมเหตุผล → สร้าง; ไฟล์ซ้ำ (SHA-256) เตือนและต้องยืนยัน), `/purchase/:id` (การ์ดต่อผู้ขาย + ดูรูป + อนุมัติ, แถวต้องตรวจ + `ResolveRowModal`, อนุมัติทั้งหมดที่พร้อม, `SendWizard` 1/N ส่ง LINE/ข้าม, ประวัติ). หน้า "สั่งซื้อ" เดิมไม่แตะ มีปุ่มไปทั้งสองทาง Dashboard มี widget วันนี้ (`PurchaseWidget`)

**สิทธิ์** (ใช้ 2 บทบาทเดิม ตามที่เจ้าของเลือก 14 ก.ย.): staff = นำเข้า/จับคู่/เลือกผู้ขายจากรายการของสินค้า (ประจำ+สำรอง)/อนุมัติ/ส่ง; admin เพิ่ม = เลือกผู้ขายใดก็ได้ + ตั้งเป็นผู้ขายประจำจากหน้า resolve, ยกเลิกชุดที่มีใบอนุมัติแล้ว, ลบชุด (rules)

**ส่ง LINE** `src/share/`: interface `PurchaseShareProvider` (ฝั่ง PO ไม่ import LINE เลย) — `lineLiffProvider` ใช้ `@line/liff` `shareTargetPicker` (image message = URL สาธารณะ 2 อัน) ; `webShareProvider` = เมนูแชร์ของเครื่อง (ใช้เมื่อไม่มี `VITE_LIFF_ID` เช่น localhost) ตอบได้แค่ "เปิดแล้ว" แล้วถามคนว่าส่งหรือยัง. **รูปต้องมี URL**: Firebase Spark ไม่มี Storage → `functions/api/po-image.ts` + Cloudflare KV (token สุ่ม 128 บิต, 7 วัน, อัปโหลดต้องมี Firebase ID token ที่ verify กับ Google JWKS; demo ใช้ `PO_IMAGE_DEMO_KEY`) — typecheck ใน `npm run build` ผ่าน `functions/tsconfig.json` (เดิมเป็น Netlify Blobs ถึง 17 ก.ย.)

**ทดสอบใน demo แล้ว** (14 ก.ย.): ไฟล์ 3 ผู้ขาย → 4 กลุ่มหลังแก้ชีสกำกวม → ร่าง PO-00001 ต่อเจ้า → อนุมัติทั้งหมด → wizard ส่ง/ข้าม → "ส่งครบแล้ว" ทุกก้าวอยู่ในประวัติ; หน้าจอ 375px ผ่าน

---

### รายการขอสั่งซื้อ — พนักงานขอ → หัวหน้าอนุมัติ → PO (branch `feat/purchase-requests`, 15 ก.ย.) — collection ที่ 7: `purchaseRequests`

เจ้าของเปลี่ยนทางเข้า: **ไม่ใช้ Excel เป็น input อีกต่อไป** (หน้า import ยังอยู่ แต่ถอดจากเมนู เหลือปุ่ม "นำเข้า Excel (ทางเลือก)" ในหน้าสั่งซื้อ) พนักงานสร้าง "รายการขอสั่งซื้อ" (PR) ในแอป → หัวหน้าตรวจ/แก้/อนุมัติ → ระบบสร้างใบสั่งซื้อ (PO) ต่อผู้ขายจากจำนวนที่อนุมัติ → ส่งรูปเข้า LINE ด้วย `SendWizard` ตัวเดิม **PR ≠ PO**: PR คือคำขอ PO คือใบที่ส่งผู้ขาย ตัดสินใจกับเจ้าของ 15 ก.ย.: เพิ่มบทบาท **`manager` (หัวหน้า)**; ผู้ขอเลือกผู้ขายรายใดก็ได้แต่ถ้าไม่ใช่ประจำ/สำรองจะติดธง "เลือกผู้ขายเอง" ให้หัวหน้าเห็น; 1 คำขอ = 1 คลังปลายทาง

**บทบาท** `Role = 'admin' | 'manager' | 'staff'` (`src/types.ts`, rules `manager()` = admin หรือ manager) — manager ทำได้ทุกอย่างที่ staff ทำ + ตรวจ/แก้/ส่งกลับ/ไม่อนุมัติ/อนุมัติ PR; **แตะ catalogue/ผู้ขาย/ผู้ใช้ไม่ได้** (ยัง `admin()`) ตั้งบทบาทที่ Settings → ผู้ใช้ ("หัวหน้า") **เจ้าของต้องตั้งให้หัวหน้าเองหลัง deploy** ไม่งั้นไม่มีใครอนุมัติได้นอกจาก admin

**สถานะ** `draft → pendingApproval → (returned → pendingApproval อีกครั้ง, revision+1) → approved → poCreated` หรือ `rejected`; "READY_FOR_ORDER" ในสเปก = `approved` ที่ยังไม่มี `orders`; admin `reopenRequest` ได้จาก approved/rejected → pendingApproval (มีประวัติ) ตารางเปลี่ยนสถานะอยู่ที่เดียว `src/lib/purchaseRequestStatus.ts` (`canTransition`, `canEditItems`, `isReadyForOrder`, `liveItems`)

**โมเดล** `PurchaseRequest` (เอกสารเดียวต่อคำขอ, `PR-00001` counter `purchaseRequest` ต่อแบรนด์): `items[]` ≤200 แต่ละบรรทัดมี `requestedQty` (ของผู้ขอ, `null` ถ้าหัวหน้าเพิ่ม) **และ** `approvedQty` (หัวหน้าแก้; ตอนส่งตรวจจะ copy จาก requestedQty) ทั้งสองค่าคงอยู่เสมอเพื่อ audit, `supplierChoice: primary|alternate|custom`, `managerAdded`, `removed {by,at,reason}` (หัวหน้านำออกระหว่างตรวจ = soft-remove ต้องมีเหตุผล; ผู้ขอลบตอนร่าง = ลบจริง); `history[]` append-only ≤500 (ทุก action พร้อม old→new); `orders[]` เติมครั้งเดียวตอนแปลงเป็น PO; `PurchaseOrder.requestId` ชี้กลับ

**บริการ** `src/services/purchaseRequests.ts` — ทุก mutation เป็น `mutate(id, fn)` = transaction อ่าน-แก้-เขียน ตรวจสถานะ/สิทธิ์ในนั้น: `createRequest`, `addItem`, `setRequestedQty` (ก่อนส่งเท่านั้น), `setApprovedQty` (manager, pendingApproval), `removeItem`, `changeSupplier`, `setItemNote`, `setRequestHeader`, `submitRequest` (`blockingIssues`: ≥1 บรรทัด, จำนวน>0, สินค้า/ผู้ขาย/คลังยังใช้งาน), `returnRequest`/`rejectRequest` (เหตุผลบังคับ), `approveRequest` (block ถ้ามี issue), `reopenRequest` (admin), `convertToOrders` (ต้อง approved และ `orders` ว่าง + `getBy(requestId)` กันซ้ำ → `createPurchaseOrder` ต่อผู้ขายด้วยเลขรันต่อผู้ขายเดิม → transaction สุดท้ายเขียน `orders` + `poCreated`; เรียกซ้ำถูกปฏิเสธ), `noteExport`

**Rules** `validRequest` (hasOnly, enum, ขนาด list, approved⇒approvedBy ฯลฯ), `createdHonestly` (createdBy==requestedBy==uid, status draft), `requestEdit` (history ไม่หด, docNo/createdBy/requestedBy แช่แข็ง), `requestMove` (ใครเปลี่ยนสถานะไหนได้: ส่งตรวจ = ผู้ขอหรือ manager; returned/approved/rejected = manager และลงชื่อ uid ตัวเอง; poCreated จาก approved เท่านั้น; reopen = admin) ลบ = admin

**หน้าจอ** `src/pages/requests/`: `/requests` (30 วัน, filter ทั้งหมด/ของฉัน/รออนุมัติ/ส่งกลับ/พร้อมสร้าง PO/สร้างแล้ว/ไม่อนุมัติ; หัวหน้าเปิดมาเจอ "รออนุมัติ" เรียงเก่าสุดก่อน ถ้าไม่มีก็ "ทั้งหมด"), `/requests/new` + `/requests/:id` → `RequestPage` เลือก `RequestEditor` (ร่าง/ส่งกลับ และคนนี้แก้ได้) หรือ `RequestReview` (หัวหน้า/อ่านอย่างเดียว) — editor หน้าเดียวไม่ซ้อน modal: คลัง+หมายเหตุ / `ProductPicker` (แท็บ "สินค้า" = ค้นชื่อ/SKU debounce ลูกศร+Enter → เลือกผู้ขาย (ประจำ/สำรอง/รายอื่น-ติดธง) + จำนวน + หน่วย Enter = เพิ่ม; แท็บ "ผู้ขาย" = เลือกผู้ขายแล้วใส่จำนวนทีละบรรทัด) / ตะกร้าจัดกลุ่มผู้ขาย แก้จำนวน/หน่วย/ผู้ขายในที่ **เอกสารถูกสร้างตอนเพิ่มบรรทัดแรก** (lazy) แล้ว URL ย้ายไป `/requests/:id` โดยไม่ remount editor. Review: สถิติ, ตารางต่อผู้ขาย ช่อง "อนุมัติ" แก้ในที่ (เซฟตอน blur), เปลี่ยนผู้ขาย, หมายเหตุ, นำออก+เหตุผล, หัวหน้าเพิ่มสินค้าด้วย `ProductPicker` ตัวเดียวกัน (บรรทัดนั้น "ขอ = —"), ปุ่ม อนุมัติทั้งหมด/ส่งกลับ/ไม่อนุมัติ (`ReasonModal`), หลังอนุมัติ PDF/Excel (`src/lib/requestExport.ts` จัดกลุ่มผู้ขาย มีทั้งขอ/อนุมัติ) + "สร้างใบสั่งซื้อ" (ยืนยัน, ครั้งเดียว), หลังสร้าง "ส่ง LINE ทั้งหมด (N)" เปิด `SendWizard` + ลิงก์ "ดูในหน้าสั่งซื้อ", แท็บประวัติ. Dashboard `RequestWidget` แทน `PurchaseWidget`; เมนู "รายการขอสั่งซื้อ" แทน "สั่งซื้ออัตโนมัติ"; หน้าสั่งซื้อโชว์ "จากรายการขอสั่งซื้อ" บนใบที่มี `requestId` และ "สั่งของใหม่ (สั่งเอง)" ยังใช้ได้

**ทดสอบ**: `tests/purchase-requests.test.ts` (20 รวม acceptance: RED OAK 5→3, ROCKET 3, COKE CAN 5, หัวหน้าเพิ่ม COKE ZERO 5 → ACK PO-00001 + THAINAMTHIP PO-00001; แปลงซ้ำถูกปฏิเสธ; requested/approved ครบ), rules tests สำหรับ manager + ทุก transition; **เดินใน demo แล้ว 15 ก.ย.** ทั้งสองแท็บของ picker, ส่งตรวจ, แก้อนุมัติ, เพิ่มโดยหัวหน้า, อนุมัติ, PDF/Excel, สร้าง PO 2 ใบ, wizard, ส่งกลับ→แก้→ส่งใหม่ (ครั้งที่ 2), 375px ผ่าน. หมายเหตุเครื่องมือ: ปุ่ม "Return" ของ browser automation ส่ง `key=""` ไม่ใช่ Enter — ต้องกด `Enter`

---

### UI สามขนาดหน้าจอ (21 ก.ย., branch `feat/mobile-shells` → main)
- **มือถือ <768**: แถบล่าง หน้าแรก·สต๊อก·**+**·ประวัติ·เพิ่มเติม (`components/nav/BottomTabBar.tsx`; ปุ่ม + เปิด `ActionSheet` รับเข้า/เบิก-โอน/ปรับ/ขอสั่งซื้อ (+สั่งของใหม่สำหรับหัวหน้า/ผู้ดูแล)); `/more` (`pages/More.tsx`) คือเมนูที่เหลือ+ภาษา/สลับแบรนด์/ออกจากระบบ; ลิ้นชักเมนูเดิมเอาออกแล้ว ไม่มี hamburger
- **แท็บเล็ต 768–1279**: รางซ้าย 72px (`NavRail.tsx`) ไอคอน+คำ ทุกเมนู ปุ่ม + ในราง; **คอม ≥1280**: เมนูซ้าย 256px + sheet ขาว เหมือนเดิม (ย้าย breakpoint จาก `lg` เป็น `xl`)
- เมนูทุกแบบอ่านจาก `components/nav/navItems.ts` ที่เดียว (`navFor`, `TAB_ITEMS`, `actionsFor`, `moreItemsFor`, `isMoreRoute`, `titleFor` — เทสต์ `tests/nav-items.test.ts`); `lib/viewport.ts` (`useViewport()`) ใช้เฉพาะเมื่อพฤติกรรมต่างกัน ไม่ใช่ layout
- `Modal` บนมือถือเต็มจอ (หัวติดบน, prop `footer` ติดล่าง); `compact` = แผ่นสั้นจากล่าง (Confirm ใช้); `FormActions` ติดเหนือแถบล่าง (`--tabbar-h` ใน index.css); DemoBanner ก็อยู่เหนือแถบ
- **รอบ 2 หน้าคีย์ (branch `feat/mobile-keying`)**: `components/QtySheet.tsx` (จำนวน+หน่วยบนมือถือ ใช้ Modal compact+footer; กันเบิกเกินคงเหลือ), `lib/lines.ts` (`upsertLine` — สินค้าเดิม = แถวเดิม, ทดสอบ `tests/lines.test.ts`), `LineBuilder` แยกโหมด phone (ผลค้นหาเป็นลิสต์ใต้ช่อง + การ์ด + ชีต) / อื่น (แถวเดิม), `TodayTransactions` พับได้บนมือถือ, `WithTodayPanel` วางข้างจาก `lg`; ปรับสต๊อกบนมือถือใช้ชีตเดียวกัน (ทิศทาง+เหตุผลอยู่ในชีต, แถวสรุปแตะเพื่อแก้)
- **รอบ 3 รายการ (branch `feat/mobile-lists`)**: `DataTable` การ์ดต่ำกว่า `md` — `Column.card` = 'value' (ตัวเลขใหญ่ข้างชื่อ) / 'meta' (บรรทัดเดียว, ค่าเริ่มต้น) / 'hidden'; `cardParts()` ทดสอบ `tests/data-table-cards.test.ts`; `Pagination` บนมือถือเป็นปุ่ม 'โหลดเพิ่ม' (ขยาย pageSize); ฟิลเตอร์หน้ารายงาน/ประวัติเป็น 2 คอลัมน์บนมือถือ; หน้าสินค้าโชว์หน่วยติดตัวเลขบนการ์ด
- **รอบ 4 หน้าแรก (branch `feat/mobile-home`)**: `pages/PhoneHome.tsx` (= TodayPanel ของแดชบอร์ด + `TodayTransactions` ทุกประเภทกรอง `byUserId` เปิดไว้ (`startOpen`) + RequestWidget; `DashboardPage` คืน PhoneHome เมื่อ `useViewport()==='phone'`); `StatGroup` 2 คอลัมน์บนมือถือ; เดินตรวจ 375px แล้ว: ปฏิทิน (มี agenda อยู่แล้ว) ตั้งค่า ตรวจรับของ ส่ง LINE ขอสั่งซื้อ — ไม่มีอะไรล้นจอ
- spec `docs/superpowers/specs/2026-09-21-mobile-tablet-ui-design.md`, แผน `docs/superpowers/plans/2026-09-21-mobile-{shells,keying,lists,home}.md` — **ครบ 4 รอบแล้ว (21 ก.ย.)**

### ต้นทุนและประวัติราคา (22 ก.ย., branch `feat/cost-history`)
- `Product.cost` = ต้นทุนต่อหน่วยหลักเสมอ และเขียนโดย `services/productCost.ts` เท่านั้น (`setProductCost({price, unit, effectiveAt, note})` → คำนวณ `cost = price / resolveFactor(unit)` ทศนิยม 4 ตำแหน่ง, append ลง `Product.costHistory` (≤100 รายการ, เรียงตามวันที่มีผล), `cost` = รายการที่วันที่มีผลล่าสุด) — ฟอร์มสินค้าไม่เขียน `cost` อีกแล้ว (ตัด key ออกก่อน updateProduct/createProduct; สินค้าใหม่บันทึกราคาต่อจาก create)
- ทำไม: ต้นทุนที่กรอกเป็นราคาลังทั้งที่หน่วยหลักเป็นซอง ทำให้ Ketchup 11,536 ซอง มีมูลค่า 3.4 ล้าน (22 ก.ย.) แก้ไปแล้ว 8 ตัวทั้งสองแบรนด์ (ดู samples/unit-audit-2026-09-21.md §F)
- UI: `components/CostBlock.tsx` ในหน้าสินค้า (ราคา · ต่อ 1 [หน่วยหลัก/หน่วยที่มีอัตรา] · มีผลตั้งแต่ · หมายเหตุ → โชว์ '= ฿x ต่อ 1 EA' ก่อนบันทึก + ประวัติราคา); รายงาน → แท็บ **ราคาต้นทุน** (`pages/reports/CostReport.tsx`: ต้นทุนตอนนี้/ราคาที่กรอก/มีผล/ราคาก่อนหน้า+% /ครั้ง/โดย/มูลค่า, กรอง เคยปรับราคา/ยังไม่มีต้นทุน, Excel = ทุกแถวของประวัติ)
- rules: `validProduct` เพิ่ม `costHistory` (list ≤100) — **ต้อง deploy rules ก่อน merge** (เทสต์ `tests/firestore-rules.test.ts` มีแล้ว); เทสต์ `tests/product-cost.test.ts`

### เหตุการณ์โควตา Firestore เกิน (22 ก.ย. เที่ยง) — สาเหตุและแก้แล้ว
- **77k/50k reads/วัน หมดโควตา ทำอะไรกับ Firestore ไม่ได้จนกว่าจะรีเซ็ต (~14:00 น. เวลาไทย)** สาเหตุหลักคือ session นี้เอง กด "ตรวจความสอดคล้องของยอด"/"ดาวน์โหลดไฟล์สำรอง" ซ้ำหลายครั้งระหว่างตรวจ unit rebase + ต้นทุนสินค้าในวันเดียว — ไม่ใช่การใช้งานปกติของพนักงาน (รับเข้า/เบิก/ปรับ/สั่งซื้อ/ดูสินค้า ใช้ listener ที่มีขอบเขต + range cache ของปฏิทินอยู่แล้ว ไม่แตะทั้ง collection)
- **บั๊กจริงที่แก้ (branch `fix/quota-reads`)**: `buildBackup()` เดิมอ่าน `stockMovements` เต็ม collection **3 รอบ** ต่อการกดดาวน์โหลด 1 ครั้ง (ก่อน/ในลูป/หลัง) และ `recomputeLevels()` อ่านเต็ม 2 รอบ — ทั้งคู่แค่เพื่อเช็คว่า "มีอะไรเปลี่ยนระหว่างอ่านไหม" เปลี่ยนเป็น `movementsChangedSince(db, since)` (`services/stock.ts`) ใช้ `getRange` เช็คช่วงแคบ ๆ (createdAt/updatedAt หลัง `since`) แทน — ปกติได้ 0 แถวกลับมา ราคาถูกกว่าเดิมมาก; เอาการเรียก `findLevelDrift()` ซ้ำหลัง `recomputeLevels()` ใน Settings.tsx ออก (ยอดที่เพิ่งเขียนตรงกับ ledger ที่เพิ่งอ่านโดยนิยามอยู่แล้ว) เทสต์ `tests/quota-reads.test.ts`
- **ปุ่ม "คำนวณยอดคงเหลือใหม่"/"ตรวจความสอดคล้องของยอด" ยังคงอ่านทั้ง collection ต่อการกด 1 ครั้ง** (คนละเรื่องกับบั๊กข้างบน — ธรรมชาติของการตรวจสอบทั้งหมดคือต้องอ่านทั้งหมด) เพิ่มคำเตือนใต้ปุ่มว่าไม่ควรกดซ้ำโดยไม่จำเป็น — วินัยการใช้ (ทั้งเจ้าของและผมเอง) สำคัญกว่าตัวโค้ด ต่อไปถ้าต้องตรวจสอบสินค้าเดียวหลัง unit rebase ให้ใช้ query แบบ scoped ต่อสินค้า (`getBy('productId', ...)` ที่ `rebuildProductLevels` ใช้อยู่แล้ว) แทนปุ่มตรวจทั้งระบบ
- **ทดสอบฟีเจอร์ใหม่ต่อไปนี้**: ทำใน `npm run demo` (localhost:5175) ก่อนเสมอ — เป็นคนละ Firebase project กับของจริง ไม่กระทบโควตา ใช้ของจริง (Chrome tab ของเจ้าของ) เฉพาะตอนต้อง verify ด้วยข้อมูลจริงหรือแก้ข้อมูลจริงเท่านั้น และเลี่ยงการกด reload/สลับแบรนด์ซ้ำ ๆ โดยไม่จำเป็นระหว่างตรวจงาน

### แก้ไขโปรไฟล์ของตัวเอง + จัดคอลัมน์จำนวน/หน่วยให้ตรงกัน (22 ก.ย., branch `feat/edit-profile`, live)
- **โปรไฟล์**: เมนูบัญชี (มุมขวาบน) และกล่องผู้ใช้ท้ายแถบข้าง มีปุ่ม "แก้ไขโปรไฟล์" ใหม่ (`src/components/ProfileModal.tsx`) — เปลี่ยนชื่อที่แสดง (ขึ้นทุกเอกสารที่ทำรายการ) และเปลี่ยนรหัสผ่านของตัวเอง (`services/users.ts changeOwnPassword`: cloud ใช้ Firebase Auth reauthenticate ด้วยรหัสผ่านเดิมก่อนเปลี่ยน; local/demo เช็ค `localPassword` ตรงแล้วเขียนทับ). อีเมลกับสิทธิ์ (role/active) แก้ไม่ได้เอง — ยังเป็นของแอดมินเท่านั้น
- **Rules deploy แล้ว (22 ก.ย., ยืนยันจากเจ้าของ)** — เดิม `users/{uid}` ให้แอดมินแก้ได้เท่านั้น แม้จะแก้ชื่อตัวเอง เพิ่ม branch ใหม่: บัญชี active แก้ `name` ของตัวเองได้ (เท่านั้น — ไม่แตะ role/active/email) โดยไม่ต้องเป็นแอดมิน. เทสต์ `tests/firestore-rules.test.ts` (+2 คดี) ผ่านครบ 158 คดี. การเปลี่ยนรหัสผ่านใช้ได้อยู่แล้วโดยไม่ต้องรอ deploy (เป็น Firebase Auth ล้วน ไม่แตะ Firestore)
- **จัดแถวจำนวน/หน่วยในหน้ารับเข้า/เบิก/โอน/ปรับสต๊อก** (`src/components/QtyInput.tsx`): เดิมกล่องเลือกหน่วย (`<select>`) กว้างตามความยาวข้อความหน่วยที่เลือกอยู่แถวนั้น ("EA" แคบกว่า "กรัม (g)") ทำให้กล่องจำนวนข้าง ๆ ขยับไม่เท่ากันทุกแถว ดูไม่เรียบร้อย (เจ้าของ 22 ก.ย.) — เปลี่ยนเป็นความกว้างคงที่ทั้งกล่องจำนวนและกล่องเลือกหน่วย ทุกแถวเท่ากันเป๊ะไม่ว่าจะเลือกหน่วยไหน

### ส่ง LINE บนมือถือ — กลับมาที่ใบเดิมหลัง LINE Login (22 ก.ย., branch `fix/liff-resume`)
อาการ: กด "ส่ง LINE" ครั้งแรกบนมือถือ → ไป LINE Login → กลับมาหน้ารายการสั่งซื้อโดยหน้าต่างส่งหายไป ("เด้งกลับมาหน้าเดิม"). แก้ใน `src/share/liffResume.ts`: `redirectUri` ของ `liff.login()` = หน้าเดิม + `?send=<orderId>` (ค่าเดินทางใน URL ไม่ใช่ storage เพราะบน iPhone แอปหน้าจอหลักกับ Safari ไม่แชร์ storage กัน) แล้ว `Orders.tsx` / `RequestReview.tsx` / `PurchaseBatchReview.tsx` อ่านพารามิเตอร์ครั้งเดียว เปิด `SendWizard` ที่ใบนั้น แล้วล้าง URL. **แอปที่ติดตั้งบนหน้าจอหลัก (PWA)** ทำ login round trip ไม่ได้เลย → พาไปเปิดหน้าเดิมในแอป LINE ผ่าน `https://liff.line.me/<liffId>/<path>?send=<id>` (`liffBoot.ts` แปลง `liff.state` กลับเป็นเส้นทาง) ซึ่งใน LINE ล็อกอินอยู่แล้ว — ครั้งแรกต้องเข้าระบบแอปในเบราว์เซอร์ของ LINE หนึ่งครั้ง (storage แยก). `SendWizard` แสดงข้อความบอกล่วงหน้าว่าจะเกิดอะไร (`liffNeedsLogin()`). tests: `tests/share-provider.test.ts` (+3).

### จัดหน้าตาใหม่ทั้งแอปตามภาพ mock-up (22–23 ก.ย. — **R0–R9 ขึ้นของจริงแล้ว 23 ก.ย. 2569**)
เจ้าของส่งภาพออกแบบ 10 หน้า (ภาพรวม/สินค้าคงคลัง/เบิก-โอน/ปรับสต๊อก/ปฏิทิน/Stock Card/รายงาน/สั่งซื้อ/ขอสั่งซื้อ/ผู้ขาย) และสั่งให้ทำ **ทั้งหน้าตาและฟีเจอร์ใหม่** ครบทั้ง desktop/tablet/phone
**แผนงานทั้งหมดอยู่ที่ `docs/superpowers/specs/2026-09-22-full-restyle-design.md`** — 10 รอบ (R0 ชิ้นส่วนกลาง → R7 ทุกหน้า → R8 บาร์โค้ด → R9 กล่องข้อความ), แต่ละรอบ deploy จบในตัว, มีตารางว่าภาพขออะไรกับข้อมูลจริงมีอะไร, มี 5 จุดที่ต้องแก้ firestore.rules, และ §9 บอกวิธีเริ่มงานต่อในแอคเคาท์ใหม่
การตัดสินใจของเจ้าของ: **ไม่เอาขั้นอนุมัติ**ของปรับสต๊อก/โอนสาขา · เอา**สแกนบาร์โค้ด** + **กล่องข้อความภายใน** · **ไม่เอา**ปุ่มคู่มือการใช้งาน

**ขึ้นจริงแล้ว (23 ก.ย. 2569)** — ทำทีละรอบบน branch ที่แตกจากรอบก่อนหน้าเป็นขั้นบันได จนถึง `feat/messages` ที่มีครบ R0–R9 → **deploy `firestore.rules` ขึ้น `pzm-stock-x5` แล้ว merge เข้า `main` แบบ fast-forward และ push (`1ef3c09..805d6a3`) เมื่อ 23 ก.ย. 2569** — 97 ไฟล์, +8802/−2357 บรรทัด (ด่านก่อขึ้นผ่านทั้งหมด: 679 unit, 166 rules, lint, i18n, worker, build)
- **R0** `feat/frame` — `src/components/frame/*` (PageHero, StatTile/StatRow, FilterBar, ChipRow, StatusChip, SectionCard, WithSidePanel/SummaryList/RecentList/TipCard, RowMenu, ItemCell, FramePage), `components/charts/` (recharts ผ่าน `lazy()` แยก chunk 391 kB), DataTable `selection`+`rowMenu`, Pagination "ไปยังหน้า", token `--color-tile-*`; หน้าไหนห่อด้วย `FramePage` = Layout ไม่วาดแผ่นขาว (ใช้ `:has([data-frame])`)
- **R1** `feat/restyle-dashboard` — ภาพรวมตามภาพ 01 + `lib/stats/periodCompare.ts` (เทียบเมื่อวาน/30 วัน, **ไม่แสดงลูกศรถ้า ledger window ไม่ครอบคลุม**); ตารางสต๊อกเต็ม+ตัวเลือกคลังย้ายออกจากหน้าแรก (อยู่ที่สินค้าคงคลัง); มือถือเพิ่มสินค้าใกล้หมด 5 + เมนูด่วน
- **R2** `feat/restyle-products` — แยก `pages/products/*`; การ์ดตัวเลข = ตัวกรองสถานะ; ชิปหมวด 8 อันดับ; ตาราง/กริด; เลือกหลายแถว → ซ่อน/ตั้งขั้นต่ำ/ส่งออก Excel (tablet+); ไอคอนหมวดแทนรูป (`lib/categoryIcon.ts`)
- **R3** `feat/restyle-keying` — **`adjustStockLines()`** ใหม่ใน stock engine (หลายบรรทัด เลข ADJ- เดียว, ติดลบบรรทัดเดียว = ปฏิเสธทั้งใบ, สินค้าซ้ำ = ปฏิเสธ, +6 เทสต์); ปรับสต๊อกเป็นตารางหลายรายการ (จำนวนในระบบ → นับได้ หรือ ± → เหตุผลต่อแถว → มูลค่า); เบิก/โอนมีการ์ดเลือกโหมด 2 ใบ; LineBuilder บน tablet+ เป็นตาราง + หมายเหตุต่อบรรทัด (2xl); แผงข้าง = สรุปวันนี้ + รายการวันนี้ (แก้ได้เหมือนเดิม) + คำแนะนำ. ร่างของหน้าปรับสต๊อกเปลี่ยน key เป็น `adjust-lines` (ร่างแบบเก่าในเครื่องถูกทิ้ง)
- **R6** `feat/restyle-reports` — หน้าใหม่ **`/products/:id/card`** (อ่าน movement ของสินค้านั้นตัวเดียวด้วย `readProductLedger` — 1 query ต่อสินค้าต่อ session) + `lib/stats/balanceSeries.ts`; รายงานมีแท็บ **ภาพรวม** เป็นแท็บแรก + `lib/stats/insights.ts`; ลิงก์จาก ⋮ สินค้า, ช่องค้นหาบน, สินค้าใกล้หมดในหน้าแรก ชี้มาหน้านี้ (หน้าประวัติเดิมยังอยู่)
- **R7** `feat/restyle-calendar` — ปฏิทินตามภาพ 05 (การ์ดในช่องวัน, คำอธิบายสี, ตัวกรองด่วนเป็นชิป, แผงงานที่จะมาถึง + สรุปเดือนนี้); ประวัติ/นำเข้าอยู่บน canvas
- **R4** `feat/restyle-purchasing` — สั่งซื้อ+ขอซื้อตามภาพ 08/09; เพิ่ม `PurchaseRequestItem.urgency` (ค่าเริ่มต้น "ปกติ" เก็บเป็นฟิลด์ที่ไม่มีอยู่จริง, ผู้ขอแก้ตอนร่าง หัวหน้าแก้ตอนตรวจ) — **ไม่ต้องแก้ rules** เพราะ rules ตรวจแค่ขนาดของ `items` ไม่ได้ตรวจฟิลด์ในแต่ละบรรทัด; หน้าขอซื้อมีสองมุมมอง (ตามใบ / ตามรายการสินค้า) ติ๊กรายการแล้วกด "สร้างใบสั่งซื้อ" = แปลงใบที่อนุมัติแล้วทั้งใบ (flow เดิม); หน้าสั่งซื้อเพิ่มตัวกรองผู้ขาย/สถานะ + ติ๊กหลายใบส่ง LINE รอบเดียว
- **R5** `feat/restyle-suppliers` — **แก้ rules #2** (`validSupplier` + `code, contactName, phone2, address, taxId, paymentTerms, category, links`); รหัสผู้ขาย **V-00001** ออกอัตโนมัติสำหรับรายใหม่ + ปุ่มออกย้อนหลังให้รายเดิมทั้งหมด (กดซ้ำได้ ไม่ซ้ำเลข ตามที่เจ้าของเลือก); ตารางใหม่ + แผงรายละเอียดขวา (ข้อมูลทั่วไป / ประวัติการสั่งซื้อ / เอกสารเป็นลิงก์ Drive)
- **R8** `feat/barcode` — **แก้ rules #1** (`validProduct` + `barcode` ≤64); `@zxing/browser` เป็นตัวสำรองเมื่อเบราว์เซอร์ไม่มี `BarcodeDetector` (โหลดเมื่อใช้); สแกนแล้วขึ้นบรรทัดทันทีในหน้ารับเข้า/เบิก-โอน/ปรับสต๊อก, บาร์โค้ดเข้าไปอยู่ในช่องค้นหาทุกที่, ⋮ ในหน้าสินค้ามี "สแกนเพื่อผูกบาร์โค้ด", และมีหน้านำเข้าบาร์โค้ดจาก Excel (แสดงแผนก่อนเขียนทุกครั้ง) — **กันบาร์โค้ดซ้ำในโค้ด** เพราะ rules query ไม่ได้
- **R9** `feat/messages` — **แก้ rules #4 #5** (collection `messages` + `lelapin__messages`, และ `users` self-update รับ `messagesReadAt`); กระดิ่งข้อความในแถบบน ไม่มี listener (อ่านเป็นช่วงวันผ่าน rangeCache, รีเฟรชทุก 5 นาทีเฉพาะตอนเปิดแผง); แก้ข้อความไม่ได้, ปักหมุดได้เฉพาะหัวหน้า, **ลบของคนอื่นได้เฉพาะแอดมิน**, **เก็บ 90 วัน** (Worker ลบให้ในรอบรายวัน) ตามที่เจ้าของเลือก; backup เป็น format 8

**ที่เจ้าของต้องทำเองหลังขึ้นจริงแล้ว**
1. ปิดแท็บแอปทุกแท็บแล้วเปิดใหม่ — เป็น PWA กดรีเฟรชเฉย ๆ ยังได้ service worker ตัวเก่า
2. กดปุ่ม "ออกรหัสผู้ขาย" หนึ่งครั้งต่อแบรนด์ (R5) — กดซ้ำได้ เลขไม่ซ้ำ
3. เริ่มกรอกบาร์โค้ดสินค้าผ่าน Excel หรือหน้าสแกน (R8)

### ส่ง LINE วนลูปในเบราว์เซอร์ของ LINE — แก้แล้ว (23 ก.ย., branch `fix/line-send-loop`)
อาการ (คลิปจากเจ้าของ): กด "ส่ง LINE" แล้วแอปรีโหลดกลับมาหน้าเลือกแบรนด์ซ้ำ ๆ ไม่เคยขึ้นหน้าต่างเลือกแชท
สาเหตุ: WKWebView ที่อยู่ในแอปอื่นบน iOS รายงาน `navigator.standalone === true` และ `display-mode: standalone` เหมือนแอปหน้าจอโฮมทุกอย่าง → `isStandalone()` ใน `src/share/liffResume.ts` ตอบ true **ในเบราว์เซอร์ของ LINE เอง** → `share()` ส่งหน้าตัวเองไป `liff.line.me` ซึ่งก็เปิดหน้าเดิมซ้ำ ไม่มีตัวกันว่าเคยส่งไปแล้ว (ยืนยันจากคลิป: ข้อความใต้ปุ่มตอนอยู่ใน LINE เป็นเวอร์ชัน "จะเปิดในแอป LINE ให้" แปลว่า isStandalone()=true และ isInClient()=false)
แก้: `isInAppBrowser()` (ดู UA ` Line/`/FBAN/FBAV/Instagram) → `isStandalone()` ตอบ false ในนั้น · `share()` ไม่ส่งต่อถ้า `isInClient()` · จำไว้ใน sessionStorage ว่าส่งต่อไปแล้วหนึ่งครั้ง กดครั้งที่สองจะไป LINE Login แทน · **พา brand ไปกับ URL ด้วย** (`?send=<id>&brand=<brand>`) เพราะ brand อยู่ใน React state ล้วน กลับมาทีไรก็เจอหน้าเลือกแบรนด์ทุกที (`brandToResume()` + effect ใน `App.tsx`)
tests: `tests/share-provider.test.ts` 13 คดี (เพิ่ม 4)

### โควตาอ่านเต็มรอบที่ 3 (23 ก.ย.) — ลดค่าเปิดแอป + มีมาตรวัดแล้ว (branch `fix/read-quota`)
63k/50k วันเดียว และ 21 ก.ย. พุ่ง 89k · **สาเหตุไม่ใช่เครื่องมือตัวใดตัวหนึ่ง แต่คือ "ค่าเปิดแอปหนึ่งครั้ง × จำนวนครั้งที่เปิด"**
- เปิดแอปครั้งหนึ่ง = subscribe ทั้ง working set (products ~323 + stockLevels + movements + …) และ Firestore **คิดเงินใหม่ทั้งหน้าต่างทุกครั้งที่ listener ขาดการเชื่อมต่อเกินครึ่งชั่วโมง** ซึ่งคือทุกครั้งที่เปิดแอปจากหน้าจอโฮมบนมือถือ — ledger 30 วัน ≈ 470 รายการต่อการเปิดหนึ่งครั้ง
- `RECENT_DAYS` 30 → **7 วัน**; หน้าที่โชว์ตัวเลขเทียบเดือน (Dashboard, สินค้าคงคลัง, รายงาน→ภาพรวม) เรียก `useLedgerWindow()` ขอ 30 วันเอง (`covers()` ซ่อนตัวเลขเทียบไว้จนกว่าข้อมูลจะมา) ประวัติเก่ากว่านั้นกดโหลดได้ที่ `LedgerWindowNotice` เหมือนเดิม
- **ขอบหน้าต่างยึดเที่ยงคืน** (`src/data/ledgerWindow.ts` `windowStart()`) — เดิมเป็น `Date.now() - N วัน` ซึ่งเป็น query คนละอันทุกครั้งที่โหลด Firestore จึง resume ไม่ได้เลย
- **`npm run dev` เคยชี้ไปโปรเจกต์จริง** (ดูคอมเมนต์ใน `src/firebase/config.ts`) → ทุก hot reload = อ่านใหม่ทั้งชุด **ตอนนี้ `npm run dev` = เดโม**, ของจริงต้องพิมพ์ `npm run dev:live` เอง และลบ launch entry `pizza-stock-dist` ที่ preview ของจริงออก
- **มาตรวัดใหม่**: ตั้งค่า → "การอ่านข้อมูล (โควตา)" (แอดมิน) นับรายการที่อ่านแยกตามคอลเลกชันตั้งแต่เปิดหน้า + ปุ่มเริ่มนับใหม่ (`src/data/readMeter.ts`, นับใน `src/backend/firestore.ts`) — ครั้งหน้าไม่ต้องเดาอีก **ขอเลขจากหน้านี้ก่อนตัดสินใจตัดอะไรต่อ**
- ยังไม่ได้ตัด: `products` (323) และ `stockLevels` ที่เป็นก้อนใหญ่สุดของการเปิดแต่ละครั้ง — ต้องรู้ก่อนว่ามีกี่รายการและกี่รายการเป็น 0/ปิดใช้ ถึงจะตัดได้อย่างปลอดภัย

### เปลี่ยนหน่วยหลักแล้วต้นทุนไม่ถูกแปลง — แก้แล้ว (23 ก.ย., `fix/rebase-keeps-cost-honest`)
`rebaseProductUnit` แปลงจำนวนทุกแถวแต่**ไม่แตะ `cost`/`costHistory`** → ของที่ราคา ฿1,190/Carton พอ rebase เป็น EA ก็ยังเป็น ฿1,190 **ต่อชิ้น** มูลค่าสต๊อกเลยผิดไป 24 เท่า (ตระกูลเดียวกับเคส ketchup 3.4 ล้าน)
แก้: ราคาที่คีย์ไว้ (`price`/`unit`) ไม่เปลี่ยน — ใบเสร็จว่าอย่างไรก็อย่างนั้น; สิ่งที่คำนวณใหม่คือ `cost` ต่อหน่วยหลักใหม่ (resolve `price` ต่อหน่วยเดิมกับหน่วยใหม่; ถ้าแปลงไม่ได้ก็คูณด้วยอัตราเดียวกับจำนวน) · โหมด recount ไม่มีอัตราระหว่างสองหน่วยอยู่แล้ว จึงปล่อยให้เจ้าของตั้งราคาใหม่เอง · tests `tests/unit-rebase.test.ts` (+3)
**ยืนยันแล้วว่าเครื่องคำนวณถูก** สำหรับรูปแบบที่เจ้าของต้องการ (หน่วยหลัก EA + `1 Carton = 24 EA`): รับเข้า 2 Carton = 48 EA, เบิก 2 EA = 2 EA

### รับเข้าแบบเลือกใบสั่งซื้อก่อน (24–25 ก.ย., branch `feat/po-receive`) — **LIVE 25 ก.ย. 2569**
แทนหน้ารับหลายบิล (24 ก.ย.) ที่เพิ่งขึ้นไป — เจ้าของส่งสเปก "SELECT PO → AUTO LOAD → RECEIVE ALL → EDIT EXCEPTIONS → DOCUMENT → REVIEW → CONFIRM" และตอบ 3 ข้อ: **PO ขาดส่ง = เปิดค้างรับได้หลายรอบ**, **ทีละบิลทุกโหมด**, **ปุ่มตรวจรับของในหน้าสั่งซื้อ → /receive?po=**.
- **ใช้ engine เดิม ไม่สร้างใหม่**: `receivePurchaseOrder` (วัดกับยอด *ค้างรับ* แทนยอดสั่ง, `receivedQty` สะสม, `receipts[]` ต่อรอบ ≤50, status คง `ordered` จนครบหรือ `closeRemainder`) · `closeOrderRemainder` (ปิดยอดค้างโดยไม่มีของมา, ต้องเคยรับมาก่อน) · ยกเลิก/แก้ไข PO ที่รับไปบางส่วนแล้ว **ถูกปฏิเสธ** (แก้ไขจะทำให้ยอดที่รับหาย) · `receiveStock` รับ `doc` = supplierId/supplierName/invoiceNo/docDate/poId/poDocNo แยกฟิลด์ + รูปเอกสารใน transaction เดียว · เหตุผลที่ไม่ตรงต่อบรรทัดไปอยู่ใน note ของแถวสต๊อกด้วย
- **ข้อมูลเก่าอ่านได้เหมือนเดิม**: ทุกจุดแสดง note ผ่าน `src/lib/receiptLabel.ts` `movementNote()` (แถวใหม่ = "SUPPLIER · IV · PO · note", แถวเก่า = note เดิม) · ตรวจเลขบิลซ้ำ `src/services/receiptDocs.ts` (ผู้ขายเดียวกัน + เลขเดียวกัน, ตัวพิมพ์เล็ก/ใหญ่ไม่มีผล; บิลก่อน 24/09/2569 ที่อยู่ใน note ตรวจไม่ได้ — หน้าจอบอกไว้ในวิธีใช้)
- **หน้าจอ** `src/pages/Receive.tsx` + `src/pages/receive/` (PoPicker, PoLines, DocumentCard, ReceiptReview, receipt.ts) · `src/components/ThaiDateField.tsx` (แสดง 24/09/2569 ทับ date picker ของเบราว์เซอร์) · ร่างทุกรุ่นเก่า (`{bills}`, `{note,lines}`) กลับมาได้ — บิลที่เกินหนึ่งรอคิว "รับบิลถัดไป" · ลิงก์ `?po=` ชนะร่างของ PO อื่นเสมอ (StrictMode/brand มาช้า เคยทำให้ร่างทับ)
- **หน้าสั่งซื้อ**: ป้าย "รับแล้วบางส่วน x/y", ปุ่ม "รับส่วนที่เหลือ" + "ปิดยอดค้าง", `?receive=` (ปฏิทิน) → /receive?po= · **ประวัติ**: `?doc=RC-xxxxx` กรองเอกสารเดียว + แสดงผู้ขาย/บิล/PO ใต้ชื่อสินค้า
- **Rules** (deploy แล้ว 25 ก.ย.): ฟิลด์ใหม่ของ movement/PO มี type check · PO เพิ่ม `receipts` ได้ทีละ 1 เท่านั้น ห้ามลด · `closedShortBy` ต้องเป็นผู้ทำ · PO ที่มี receipts ห้าม cancelled · **`orderLive(d, e)` ตรวจเฉพาะฟิลด์ที่ write นี้เขียน** (`orderWritten()` = added ∪ changed) + `orderEdit` bind `editedKeys()` ครั้งเดียว — ก่อนแก้ PO กว้างสุดเหลือ headroom ~20 expressions, หลังแก้ ~150 (วัดด้วย pad trick ตาม memory rules-expression-budget)
- tests: `tests/receive-receipt.test.ts` (12), `tests/receipt-docs.test.ts` (10), `tests/purchase-orders.test.ts` ส่งหลายรอบ (+11), rules + budget (PO 200 บรรทัด 40 receipts → รอบที่ 41 และปิดยอด; ใบรับ 40 แถวพร้อมเอกสารครบ)
- ไม่ได้ทำ (นอกขอบเขตที่ตกลง): รับบรรทัด PO เป็นหน่วยอื่นที่ไม่ใช่หน่วยที่สั่ง · แก้ฟิลด์เอกสารหลังยืนยัน · เปลี่ยน date input หน้าอื่นเป็น ThaiDateField (ใช้ซ้ำได้ — เสนอเจ้าของได้)

### ข้ามใบขอสั่งซื้อ (PR) + เตือนร่างค้าง (25 ก.ย., branch `feat/pr-skip`) — **LIVE 25 ก.ย. 2569**
เคส PR-00003 ร่างค้างตอนมือถือติดโควตา แล้วไปสร้างใบใหม่. สถานะใหม่ `skipped` (สุดทาง): จาก `draft`/`returned` เท่านั้น, เจ้าของใบหรือหัวหน้า/แอดมิน, ต้องมีเหตุผล (`skipReason/skippedBy/skippedByName/skippedAt`). **แก้ไม่ได้ ลบไม่ได้ แม้แอดมิน** — rules: `requestEdit` ปฏิเสธทุก update ของใบที่ `skipped`, `requestMove` อนุญาต → skipped เฉพาะผู้ขอ/manager ที่ลงชื่อตัวเอง, `allow delete` ของแอดมินยกเว้น PR ที่ skipped. เปิด `/requests/new` แล้วมีร่าง/ใบส่งกลับของตัวเอง → กล่องเตือน (เปิดทำต่อ / ข้าม / สร้างใหม่ต่อ) อ่านจาก `requestCache` 30 วันเดียวกับหน้ารายการ. ใบที่ข้ามไม่นับเป็น "กำลังสั่ง" ใน `openPurchaseFor` อีก → คำแนะนำสั่งซื้อกลับมา. tests: `tests/purchase-requests.test.ts` (+4), rules (+2). เจ้าของกดข้าม PR-00003 เองในระบบจริง

### นับ ณ วันที่ — ยอดนับที่คีย์ทีหลัง (25 ก.ย., branch `feat/count-as-of`) — **LIVE 29 ก.ย. 2569** (ขึ้นพร้อมนับสต๊อกประจำเดือน)
ปัญหาจริง: ยอดนับเช้า 1/9/2569 ยังไม่ได้คีย์ แต่รายการรับ/เบิกเดือน ก.ย. เข้าไปแล้ว — ทุกทางที่ "ตั้งยอดตามที่นับ" เดิมคำนวณ `นับได้ − ยอดตอนนี้` วันที่ที่เลือกแค่ใช้ลงแถว จึงลบรายการหลังวันนับทิ้ง (Import กันไว้ด้วยการปฏิเสธสินค้าที่ขยับหลังวันนับ ซึ่งคือตัวที่ขยับบ่อยสุด)
- `lib/ledger.ts`: `balanceBefore(all, {productId, locationId}, before)` (เดินหน้าจาก ledger ทั้งหมด) และ `balanceAtDayEnd(now, later, scope, after)` (ถอยหลังจากยอดตอนนี้ ลบทุกแถวที่ลงวันที่ ≥ after) — ไม่นับแถว void และแถว legacy แยกหน่วย (อยู่คนละยอด)
- **ปรับสต๊อก**: เลือกวันที่ในอดีต → คอลัมน์ "ในระบบ ณ สิ้นวัน dd/mm/yy" = ยอดสิ้นวันนั้น (อ่าน movement ตั้งแต่วันถัดไปผ่าน `movementCache` ครั้งเดียวต่อวันที่ แล้ววาง live rows ทับ) → "จำนวนที่นับได้" เทียบกับยอดนั้น, ลงผลต่างในวันที่เลือก; ตอนกดบันทึกอ่านซ้ำแบบ force ถ้ายอดเปลี่ยนจะหยุดให้ตรวจใหม่; แถวแดง (ติดลบ) เทียบกับยอดตอนนี้
- **นำเข้า Excel**: `loadLedger()` + `lastCounts()` แทน `loadLastActivity()`; ปฏิเสธเฉพาะเมื่อมี **ยอดนับ** (adjust reason `opening`) วันเดียวกันหรือใหม่กว่า; รายการที่ขยับหลังวันนับถูกลงเป็นผลต่างจาก `asOfQty` (ขึ้นในกล่อง "มีรายการเคลื่อนไหวหลังวันที่นับ"); `applyImportPlan` ใช้ `postCountAsOf` และถ้ายอดนับเดือนก่อนของสินค้าเดียวกันล้มเหลว เดือนถัดไปจะไม่คำนวณบนผลต่างที่ไม่ได้ลง; ปุ่มนำเข้าปิดจนกว่า ledger จะโหลดเสร็จ (และปิดทันทีหลังนำเข้า กันกดซ้ำแผนเดิม)
- `services/stock.ts`: `postCountAsOf({countedQty, asOfQty, date,…})` ใช้ `fileCount` ร่วมกับ `setStockCount`; ปฏิเสธถ้าผลต่างทำให้ยอดตอนนี้ติดลบ ไม่ต้องแก้ rules (เป็น adjust ปกติ)
- tests: `tests/count-as-of.test.ts` (6), `tests/import-stock.test.ts` (ปรับ 3 + เพิ่ม 3 — พฤติกรรมเปลี่ยนโดยตั้งใจ); เดินใน demo แล้ว: ส.ค. 120 → ก.ย. +200 +30 −150, นับ 31/8 = 110 → ADJ −10 ลง 31/8, ยอด 190, Stock Card ยกมา ก.ย. = 110
- ขึ้นของจริง: merge `feat/count-as-of` เข้า main เมื่อเจ้าของสั่ง (ไม่ต้อง deploy rules)


### นับสต๊อกประจำเดือน + นำเข้าใบนับจาก Excel + WIP (29 ก.ย., branch `feat/monthly-count`) — **LIVE 29 ก.ย. 2569**
- เจ้าของสั่ง "ทำเลย" → deploy rules (`monthlyCounts` + `lelapin__monthlyCounts`, เพิ่มล้วน 77 บรรทัด) ก่อน แล้วค่อย push main
- รายละเอียดเต็ม (ใบนับ/นำเข้า/คำถามค้าง) อยู่ใน HANDOFF ของ branch `demo`; WIP อยู่ใน `docs/PLAN-wip-production.md`
- **ไม่มีข้อมูลเปลี่ยนเอง**: เจ้าของต้องกดเอง — ทะเบียนสินค้า → "เพิ่มสินค้า WIP" และ นับสต๊อกประจำเดือน → นำเข้าจาก Excel (ใบนับ 1/9 ลง 31/8 แบบตั้งยอดเริ่มต้น)
- ข้อ 3 ของ WIP (ผลิตตามสูตร ตัดวัตถุดิบอัตโนมัติ) ยังไม่ทำ — ต้องได้สูตรจริงจากเจ้าของ

### ข้อเสนอแนะประจำวัน — Master Automation Plan Phase 1 (25 ก.ย., branch `feat/daily-suggestions`) — **DEMO เท่านั้น ยังไม่ขึ้น production**
เจ้าของสั่ง: *"ยังไม่ต้อง push โชว์ใน demo ก่อน"* และ *"ระบบเดิม…ให้คงเดิมไว้ก่อนแล้วดึงระบบใหม่ขึ้นมาให้เปรียบเทียบ อย่าเปลี่ยนเองโดยไม่ถาม"* → คำแนะนำรายสินค้าในปฏิทิน/ปุ่ม "ขอสั่งซื้อ"/เลื่อนเตือน/กระดิ่ง **ไม่ได้แตะเลย**. การ์ดใหม่บนหน้าแรก (หัวหน้า/แอดมิน ทั้งคอมและมือถือ) `src/components/dashboard/DailySuggestions.tsx` ใช้ `feed.insights.reorders` ตัวเดียวกับปฏิทิน (`useCalendarFeed` คืน `insights` เพิ่ม) → `src/lib/inventoryRules/suggestions.ts` `dailySuggestions()`:
- คลังหลัก: เส้นเดียวกับปฏิทิน จัดตามผู้ขาย → ปุ่ม "สร้างร่างใบขอสั่งซื้อ" = `createRequest` + `addItems` (ใหม่: หลายบรรทัดใน transaction เดียว กติกาเดียวกับ addItem) → เปิด PR ต่อตามขั้นตอนเดิม
- สาขา: คิดใหม่ด้วย `recommend()` แต่ lead = `TRANSFER_LEAD_DAYS` 1 วัน (ค่าคงที่ ไม่ใช่ setting เพราะจะต้องแก้ rules) ไม่เกินของที่คลังมี แบ่งทีละสาขา และหักของที่ใบโอนร่าง/รออนุมัติจองไว้แล้ว → "สร้างร่างใบขอโอน" = `createDraft` + `saveItems` ของ Logistics (ไม่ได้แก้ไฟล์ Logistics)
- บรรทัดที่มีใบค้างอยู่ขึ้น "มีใบค้าง PR/TR-…" ไม่ติ๊ก ไม่ร่างซ้ำ. ไม่เขียนอะไรจนกว่าจะกดปุ่ม. อ่านจาก cache ของปฏิทิน/กระดิ่ง + ใบโอนเปิดอยู่ครั้งเดียวต่อการเปิดหน้า
- ข้อจำกัดที่รู้: คลังหลักยังไม่เผื่อของที่กำลังจะโอนไปสาขา (ถ้าโอนเยอะ คลังจะต่ำกว่าขั้นต่ำแล้วค่อยแนะนำวันถัดไป)
- **กับดัก:** `origin/demo` มี commit นี้แต่ `main` ไม่มี → `git push origin HEAD:demo` จาก main จะถูกปฏิเสธ (non-fast-forward) — ห้าม force; เมื่อเจ้าของอนุมัติให้ merge `feat/daily-suggestions` เข้า main แล้ว push ทั้งสอง. ถ้าต้อง push demo ก่อนนั้น ให้ merge main เข้า demo แทน
- tests `tests/daily-suggestions.test.ts` (9). Phase 2–5 ยังเป็นโครงในแผน รอเริ่มทีละ Phase

### Master Automation Plan Phase 2–5 (25 ก.ย., branch `feat/daily-suggestions`) — **DEMO เท่านั้น**
เจ้าของ: *"ทำให้เสร็จครบทุก phase แล้วขึ้น demo"*. ทั้งหมดอยู่บน `origin/demo` (ยังไม่เข้า main)
- **P2 Master QR:** `src/components/TransferQr.tsx` (ใช้ `BrowserQRCodeSvgWriter` จาก `@zxing/browser` ที่มีอยู่แล้ว ไม่เพิ่ม dependency) ปุ่ม "QR ใบโอน" บนใบโอนสถานะ inTransit/receiving พิมพ์ได้ · QR = URL หน้าตรวจรับ `lib/transferQr.ts` (`readTransferCode` รับ URL หรือ "TR-12") · "สแกน QR ใบโอน" บนใบรายการส่งสินค้า · หน้าตรวจรับมีแถบ "รับครบตามใบส่ง" กดครั้งเดียว = ติ๊กทุกบรรทัดตามจำนวนส่งแล้วยืนยันทันที (ซ่อนเมื่อมีผลต่าง) — แก้ไฟล์ Logistics แบบเพิ่มเท่านั้น
- **P3 สูตรอาหาร + POS:** collection ใหม่ `recipes` (types `Recipe`, `COL.recipes`) · `services/recipes.ts` (cache ต่อแบรนด์, รหัสห้ามซ้ำ "045"=45, ไม่ลบ ปิดแทน, `addMissingMenu` เติมรหัสเมนู 64 รายการจาก `lib/menuCodes.ts` ที่ดึงจาก menu-exam/) · หน้า `/recipes` (ไม่ได้เพิ่มเมนูใน NAV — เข้าทางลิงก์จากหน้าเบิก/โอน โหมด POS) · หน้าเบิก/โอน โหมดที่ 3 "ตัดตามยอดขาย POS" (`pages/issue/PosImport.tsx`, `/issue?mode=pos`) เลือกไฟล์ CSV/Excel เลือกคอลัมน์เอง (เดาให้ก่อน `lib/posImport.ts`) → จับคู่สูตรด้วยรหัสแล้วชื่อ/alias → รวมวัตถุดิบ → consumeStock ใบเดียว หมายเหตุ "ยอดขาย POS {วันที่} · {ไฟล์}" · เตือนถ้าสาขา+วันเดียวกันนำเข้าแล้ว · บรรทัดสต๊อกไม่พอไม่ติ๊ก · **rules เขียน+เทสต์แล้วแต่ยังไม่ deploy** (validRecipe/recipeEdit: หัวหน้า/แอดมินเท่านั้น ลงชื่อ ห้ามลบแม้แอดมิน) — ก่อนขึ้น production ต้อง deploy rules ก่อน push และถามเจ้าของ · demo seed มีสูตรตัวอย่าง 3 เมนู
- **P4 AI อ่านบิล:** `functions/api/ocr-bill.ts` (Pages Function, auth แบบเดียวกับ po-image) เรียก Gemini (`gemini-2.5-flash`, override ด้วย `GEMINI_MODEL`) **ต้องมี secret `GEMINI_API_KEY` ใน Cloudflare Pages (Preview สำหรับ demo, Production สำหรับของจริง)** ไม่มี = 503 ไม่มีรูปออกไปไหน · Gemini ตอบ 429 (โควตาฟรีหมด) → สลับไป Workers AI `llama-4-scout` ผ่าน binding `AI` ใน wrangler.toml อัตโนมัติ — การใส่ key คือการตัดสินใจของเจ้าของว่าจะส่งรูปบิลให้ Google · `lib/billOcr.ts` (cleanOcr ไม่เชื่อคำตอบ, matchOcrLines ใช้ `productMatch` เฉพาะ exact/alias) · `pages/receive/ocrApply.ts` เติมฟอร์มโดยไม่ทับที่คนพิมพ์ โหมด PO ใส่เฉพาะบรรทัดในใบสั่งและหน่วยที่สั่ง · ปุ่ม "อ่านบิลด้วย AI" ในการ์ดเอกสารของ /receive เมื่อแนบรูป (ซ่อนบน localhost)
- **P5 สรุปเข้า LINE:** ปุ่ม "แชร์สรุปเข้า LINE" บนการ์ดข้อเสนอแนะ → `lib/dailyDigest.ts` (Flex bubble แถวละลิงก์ https + ข้อความสำรอง) ส่งผ่าน LIFF shareTargetPicker (`SharePayload.flex` ใหม่) ถ้าไม่มี LIFF ใช้ share sheet/คลิปบอร์ด · กลับจาก LINE Login ด้วย `?digest=` แล้วแชร์ต่อ (`DIGEST_PARAM`)
- tests ใหม่: transfer-qr (3), daily-digest (3), pos-import (6), recipes (4), bill-ocr (3), ocr-fill (5), rules recipes (3). รวม unit 882 / rules 202

## 5. ตัวเลขทดสอบ (unit + rules tests, รันผ่านหมดทุกครั้งก่อน commit)

```
npm test              # 950 unit tests
npm run test:rules    # 214 rules tests (ต้องมี Java สำหรับ emulator) — รวม firestore-rules-budget.test.ts ที่ replay เอกสารกว้างสุด
npm run build         # tsc -b + typecheck functions/ (Cloudflare) + vite build
npm run lint          # 0 errors
npm run i18n:check    # ครบทุกข้อความ (0 warnings)
```

---

## 6. ค้างอยู่ / ต้องตัดสินใจต่อ

-2. **18 ก.ย. — branch `fix/po-history`** (วันที่รับของ, ยกเลิกไม่ลบ, กำหนดส่งตอนสร้าง, PO Revision): **ขึ้นของจริงแล้ว 18 ก.ย.** (rules deploy → merge main `875e9df` → bundle `index-aGpUe7cg.js` ตรงกับ build ในเครื่อง); ที่เหลือ: เจ้าของกด "ซ่อมวันที่รับของตามใบรับสินค้า" ทั้งสองแบรนด์. Phase B ของปฏิทินทำเสร็จแล้ว 18 ก.ย. — ดู §10 (stash `phase-b-wip` ถูกใช้แล้ว ลบทิ้งได้)

-1. **รายการขอสั่งซื้อ — ขึ้นของจริงแล้ว 15 ก.ย.** สิ่งที่เจ้าของต้องทำเอง: (ก) Settings → ผู้ใช้ → ตั้งบทบาท "หัวหน้า" ให้คนที่อนุมัติ (ทั้งสองแบรนด์ถ้าจำเป็น); (ข) กด "จัดเลขใบสั่งซื้อใหม่ตามผู้ขาย" ใน Settings (ทั้งสองแบรนด์) ให้เลข PO เดิมเรียงต่อผู้ขายตามที่ตัดสินไว้; (ค) บอกพนักงานว่าทางเข้าใหม่คือเมนู "รายการขอสั่งซื้อ" Excel เหลือเป็นทางเลือกในหน้าสั่งซื้อ

0. **สั่งซื้ออัตโนมัติ — ขึ้นของจริงแล้ว 15 ก.ย.** (rules deploy → merge → build). *(ขั้นตอนข้อ 1–6 ด้านล่างเป็นประวัติสมัย Netlify — ดู §8 สำหรับสภาพปัจจุบัน)* ทดสอบส่ง LINE จริงผ่านแล้วบนเดโม (เจ้าของส่งถึงคนอื่นได้). ที่ยังต้องรู้: LIFF app `2011602857-k9K8Zplx` ถูกใช้ทั้ง production (`[context.production.environment]`) และ demo — LIFF app มี Endpoint ได้อันเดียว ตัวไหนไม่ตรง Endpoint จะ login LINE ไม่กลับ (เดโมยอมเสียได้). **Netlify Blobs บนแผนฟรี**: ใช้ได้จริง (รูปถูกฝากและ LINE ดึงได้ตอนทดสอบ). ขั้นตอนตั้งค่าเดโมด้านล่างเก็บไว้เป็นประวัติ:
   1. **ลอง LIFF บน URL จริงก่อน** (localhost ใช้ LIFF ไม่ได้): เปิด branch deploy ชื่อ `demo` ใน Netlify UI (Site settings → Build & deploy → Branch deploys) — `netlify.toml` บังคับ `VITE_DEMO_MODE=1` ให้ context นี้แล้ว จะได้ `https://demo--pzmstock.netlify.app` ที่ใช้ browser storage ล้วน ไม่แตะ production
   2. ~~LIFF app~~ ทำแล้ว 14 ก.ย.: LIFF ID `2011602857-k9K8Zplx` อยู่ใน `netlify.toml` context `demo` แล้ว — ตรวจใน LINE Developers ว่า Endpoint URL = URL ข้อ 1 และ **Share target picker เปิดอยู่** (ถ้า Endpoint ตั้งเป็น pzmstock.netlify.app ไว้ ให้ย้าย id นี้ไป production context แทน)
   3. Netlify env สำหรับ `demo`: `PO_IMAGE_DEMO_KEY` และ `VITE_PO_IMAGE_DEMO_KEY` = สตริงสุ่มเดียวกัน (**ห้ามตั้งบน production**)
   4. เช็คว่า **Netlify Blobs เปิดใช้ได้บนแผนฟรี** (Site → Blobs) ถ้าไม่ได้ ทางสำรองคือให้ function อ่านรูปจาก Firestore doc ผ่าน REST ด้วย service-account key ใน env
   5. ส่งรูปจริงเข้า LINE ตัวเอง 1 ใบ ยืนยันว่าใบขึ้น "ส่งเข้า LINE แล้ว" และกดปิด picker แล้วสถานะไม่ขยับ
   6. ไปจริง: `npx firebase deploy --only firestore:rules --project pzm-stock-x5` **ก่อน** merge เข้า `main`; เพิ่ม LIFF app อีกตัว Endpoint = `https://pzmstock.netlify.app` → `VITE_LIFF_ID` บน production; Firebase Auth authorized domains ไม่ต้องแก้ (โดเมนเดิม)
   - ยังไม่ทำ (ตั้งใจ): ไม่มี LINE OA / bot / automation ใด ๆ; ไม่ส่งข้อความประกอบ (ผู้ขายได้รูปเดียว); ไม่ auto-merge แถวซ้ำ (ให้คนเลือก)

1. **3 รายการที่วงเล็บไม่ใช่ผู้ขายจริง** (ยังไม่ได้ยืนยันจากเจ้าของ):
   - `WOOD (On-nut)`, `WOOD (Sarasin)` — น่าจะเป็นชื่อสาขา ไม่ใช่ผู้ขาย
   - `BARLAY MALT (SHOPEE)` — ซื้อผ่าน Shopee น่าจะถูกแล้ว ไม่ต้องแก้
2. **6 สินค้าที่ชื่อไม่มีวงเล็บเลย** — เจ้าของบอกจะใส่ผู้ขายเองทีหลังที่หน้าแก้ไขสินค้า (ช่องมีให้แล้ว)
3. ฟีเจอร์ระบบสั่งซื้อที่ยังไม่ทำ (ไม่ได้อยู่ใน scope ล่าสุดที่ขอ แต่เผื่อถามต่อ): ไม่มีการแจ้งเตือนแบบ push/LINE เมื่อเกิน 3 วัน (แค่ badge สีแดงในแอป), ไม่มี recurring auto-create ใบสั่งซื้อรายสัปดาห์อัตโนมัติ (ต้องกดสร้างเองทุกครั้ง)

---

## 7. กติกาที่เจ้าของวางไว้ — ต้องรู้ก่อนทำงานต่อ

- **Firebase Spark ฟรี, ห้ามเพิ่ม cost โดยไม่จำเป็น** — งดใช้ `onSnapshot` ถ้า one-shot read พอ, งดเพิ่ม collection ใหม่โดยไม่ถามก่อน (ตอนนี้มี 7 ตัวที่ตกลงแล้ว: `stockEvents`, `suppliers`, `supplierItems`, `purchaseOrders`, `purchaseBatches`, `productAliases`, `purchaseRequests` — ตัวสุดท้ายอนุมัติในแผน 15 ก.ย.)
- ~~ห้ามแปลงหน่วยเอง~~ **เปลี่ยน 20 ก.ย. 2569**: ระบบ**ต้อง**แปลงเป็นหน่วยหลักด้วยอัตราที่เจ้าของตั้งต่อสินค้า (หรือ g↔kg, ml↔L) และ**ห้ามเดา** — หน่วยไม่มีอัตราถูกปฏิเสธจนกว่าจะระบุ (ถามครั้งเดียวตอนคีย์) ประวัติเก็บทั้งที่คีย์และที่แปลง
- **ห้ามลบ ให้ซ่อนแทน** — ใช้กับทั้งสินค้าและใบสั่งซื้อที่รับของแล้ว
- **ทุกการแก้ไขย้อนหลังต้องมีชื่อคนแก้ครบ ป้องกันการทุจริต** — ทั้ง movement และ purchase order
- **rules deploy ต้องทำก่อน push โค้ดที่แตะ field/collection ใหม่เสมอ** ไม่งั้น production จะปฏิเสธ write เงียบ ๆ
- **Firestore ประเมิน rules ได้ไม่เกิน 1,000 expression ต่อ request** และถ้าเกินจะตอบ "Missing or insufficient permissions" เฉย ๆ (17 ก.ย.: หัวหน้า/ผู้ดูแลกดอนุมัติ PR ไม่ได้เพราะเอกสารมี `note` เพิ่มมาหนึ่งช่อง; ใบสั่งซื้อที่มาจากคำขอ+ส่ง LINE แล้วก็จะรับของไม่ได้แบบเดียวกัน) แก้โดย `validShape(..., fresh)`: ตอน create ตรวจทั้งเอกสาร ตอน update ตรวจเฉพาะช่องที่ edit rule ยอมให้เปลี่ยน (`requestLive`/`orderLive`), bind `kind(name)` ครั้งเดียวด้วย `let`, และใน edit rule ใช้ `roleIsAdmin()/roleIsManager()` แทน `admin()/manager()` (writer() พิสูจน์ active แล้ว) — **เวลาเพิ่มช่องใหม่ให้ PR/PO ต้องรัน `npm run test:rules`** `tests/firestore-rules-budget.test.ts` replay เอกสารกว้างสุด ถ้าตกให้แยก validator ต่อ อย่าเพิ่ม check ลงใน path ของ update โดยไม่วัด (วิธีวัด headroom: pad rule ด้วย `&& true` ผ่านฟังก์ชันจนตก — 1 `true` ≈ 3 expression)
- **ใบสั่งซื้อที่รับของแล้ว**: rule เดิมบังคับ `receivedBy == ผู้เขียน` ทุกครั้งที่แก้ → คนอื่นแตะใบนั้นไม่ได้เลย (รวมปุ่มจัดเลขใหม่ของผู้ดูแล) แก้เป็น "receivedBy ไม่เปลี่ยน หรือเป็นผู้เขียน" 17 ก.ย.
- ก่อนตัดสินใจอะไรที่มีผลกว้าง (เพิ่ม collection, เปลี่ยนนโยบายเก่า, ลบข้อมูล) **ต้องถามเจ้าของก่อนเสมอ ห้ามเดา**

---

## 8. Cloudflare Pages — **โฮสต์เดียวของระบบ (ตัดสลับ 17 ก.ย.)** Netlify เลิกใช้แล้ว

| | |
|---|---|
| Production | `https://pzmstock.pages.dev` ← branch `main` (project `pzmstock`, account `dc0c72ca65f1d5eea15758565cd427f7`) |
| Demo | `https://demo.pzmstock.pages.dev` ← branch `demo` — **demo mode มาจากชื่อ branch** (`vite.config.ts`: `CF_PAGES_BRANCH === 'demo'` → `VITE_DEMO_MODE=1`) ใช้ browser storage ล้วน ไม่แตะ Firebase |
| รูป PO | `functions/api/po-image.ts` + `functions/po/[token].ts` → KV `po-images` (`227ca0f947374f5d9ddf9752b7ea506c`, binding `PO_IMAGES` ใน `wrangler.toml`) หมดอายุ 7 วันเอง; ฟรี 1,000 write/วัน = ~500 ใบ/วัน |
| Header/CSP | `public/_headers` (Vite คัดลอกเข้า `dist/` เอง) — `tests/image-host.test.ts` ล็อกโฮสต์ LINE ใน CSP และ no-cache ของ `sw.js` |
| LIFF | `src/share/lineLiffProvider.ts` `LIFF_BY_HOST` — **production** `pzmstock.pages.dev` → `2011611102-JhUfXMIe` (app "la mania", provider **Main Stock**, channel 2011611102, Endpoint = `https://pzmstock.pages.dev`); **demo** `demo.pzmstock.pages.dev` → `2011602857-k9K8Zplx` (app "llpzm stock", provider LLPZM Stock, channel 2011602857, Endpoint = `https://demo.pzmstock.pages.dev`). เจ้าของแยกสองแอปนี้โดยตั้งใจ (17 ก.ย.) — shareTargetPicker เปิดอยู่ทั้งสอง channel |
| Firebase | Authorized domains มี `pzmstock.pages.dev` แล้ว (เดโมไม่ต้อง — ไม่ใช้ Firebase) |
| Node | `.node-version` = 22 |

**สิ่งที่ต้องรู้เวลาแก้ config**: มี `wrangler.toml` แล้ว dashboard Cloudflare รับแค่ **Secrets** (ตัวแปรธรรมดาถูกล็อก "managed through wrangler.toml") → ค่าคงที่อยู่ในโค้ด/`wrangler.toml`, ค่าที่ขึ้นกับ branch derive จาก `CF_PAGES_BRANCH` ใน `vite.config.ts`. ก่อน 17 ก.ย. เดโมบน Cloudflare เคย build เป็นสำเนา production เพราะเหตุนี้ — แก้แล้ว

**Secrets ที่ต้องมีบน environment Preview** (สำหรับเดโมส่ง LINE): `PO_IMAGE_DEMO_KEY` (function) และ `VITE_PO_IMAGE_DEMO_KEY` (build, ค่าเดียวกัน) — ห้ามตั้งบน Production. ถ้าไม่ตั้ง เดโมยังใช้ได้ทุกอย่างยกเว้นอัปโหลดรูปไปส่ง LINE ("เครื่องนี้ยังไม่ได้ตั้งค่าที่เก็บรูป")

**ข้อมูล**: ไม่มีอะไรต้องย้าย — ข้อมูลทั้งหมดอยู่ใน Firestore `pzm-stock-x5` ซึ่งทั้งสองโฮสต์ชี้อยู่แล้ว; ที่หายไปกับ Netlify มีแค่รูป PO ชั่วคราว (อายุ 7 วัน) ใน Netlify Blobs และ URL `pzmstock.netlify.app`

**ตรวจว่า deploy ลง**: `curl -s https://pzmstock.pages.dev/ | grep -o 'assets/index-[^"]*\.js'` แล้ว hash ต้องตรงกับ `npm run build` ในเครื่อง; `curl -sI https://pzmstock.pages.dev/ | grep -i content-security` ต้องมี CSP; `curl -X POST https://pzmstock.pages.dev/api/po-image` ต้องตอบ 401

**เครื่องเก่าที่ยังเปิด `pzmstock.netlify.app`**: PWA จะยังเปิดจากแคชได้พักหนึ่ง แต่ LINE Login จะไม่กลับ (Endpoint ย้ายแล้ว) — ให้ทุกคนเปิด `https://pzmstock.pages.dev` แล้วติดตั้งใหม่ ลบ site Netlify ได้เมื่อไม่มีใครใช้ที่เก่าแล้ว

### ประวัติการเตรียม (คงไว้เพื่ออ้างอิง)

ทำไม: bandwidth ไม่จำกัด, 500 build/เดือน, Pages Functions + **KV** ฟรีโดยไม่ต้องผูกบัตร (ที่เก็บรูป PO ไม่ต้องพึ่ง Netlify Blobs), branch `demo` ได้ URL ของตัวเองฟรี

**ที่เตรียมไว้ตอนนั้น (ไฟล์ Netlify ถูกลบออกจาก repo 17 ก.ย.):**
- `functions/api/po-image.ts` + `functions/po/[token].ts` + `functions/_poImage.ts` — ที่เก็บรูป PO เวอร์ชัน Cloudflare (KV + `expirationTtl` 7 วัน, verify Firebase token เหมือน Netlify) typecheck ใน `npm run build`
- `cloudflare/_headers` — header/CSP ชุดเดียวกับ `netlify.toml` (test `tests/image-host.test.ts` ล็อกให้ตรงกัน) → `scripts/cf-postbuild.mjs` คัดลอกเข้า `dist/` เฉพาะตอน `CF_PAGES=1`
- `wrangler.toml` — `pages_build_output_dir = "dist"`, KV binding `PO_IMAGES` (ต้องใส่ id จริง)
- `public/_redirects` เดิม (`/* /index.html 200`) Pages อ่านได้เลย

**ขั้นตอนตอนจะย้ายจริง (เจ้าของทำ ~30 นาที, ไม่กระทบ Netlify จนกว่าจะชี้โดเมน):**
1. Cloudflare dashboard → Workers & Pages → **KV → Create namespace** ชื่อ `po-images` → คัดลอก id ใส่ `wrangler.toml` (`id = "..."`) → commit
2. Workers & Pages → **Create → Pages → Connect to Git** → repo `yutthachai-hr/PZM-LLP-Stock-2026` → production branch `main`, build command `npm run build`, output `dist`
3. Environment variables (Production): `NODE_VERSION=22`, `VITE_PO_IMAGE_HOST=/api/po-image`, `VITE_LIFF_ID=<LIFF app ที่ Endpoint = URL ใหม่>`; (Preview/branch `demo`): เพิ่ม `VITE_DEMO_MODE=1`, `PO_IMAGE_DEMO_KEY` + `VITE_PO_IMAGE_DEMO_KEY`
4. Settings → Functions → **KV namespace bindings**: `PO_IMAGES` → namespace ข้อ 1 (ถ้า wrangler.toml ถูกอ่านจะขึ้นเองอยู่แล้ว)
5. Deploy → ได้ `https://pzmstock.pages.dev` → ตรวจ: เปิดหน้าแรกได้, `curl -sI https://pzmstock.pages.dev/ | grep -i content-security` มี CSP, `curl -X POST .../api/po-image` ตอบ 401, bundle hash ตรงกับ `main`
6. **Firebase console → Authentication → Settings → Authorized domains → เพิ่ม `pzmstock.pages.dev`** (ไม่งั้น login ไม่ได้) และโดเมนจริงถ้ามี
7. LINE Developers → LIFF app ใหม่ Endpoint = URL ใหม่ (LIFF app มี Endpoint ได้อันเดียว) → ใส่ `VITE_LIFF_ID` ข้อ 3 → redeploy
8. ตัดสลับ: ชี้โดเมน/แจ้งพนักงานใช้ URL ใหม่, **เปิด Netlify ทิ้งไว้จนทุกเครื่องปิดแท็บแอปแล้วเปิดใหม่** (PWA cache) แล้วค่อยลบ site เดิม; rollback = กลับไปใช้ URL Netlify ซึ่งยังทำงานอยู่
9. หลังย้ายเสร็จ: ลบ `netlify/`, `netlify.toml`, `@netlify/*` ออกจาก repo และแก้ `src/services/poImages.ts` ให้ default เป็น `/api/po-image`

## 10. ปฏิทินคลัง + งาน + แจ้งเตือน — โครงการ 4 เฟส (เริ่ม 17 ก.ย.) **ครบ 4 เฟสแล้ว (18 ก.ย.) — Worker รอเจ้าของตั้งค่า**

แผนเต็มอยู่ใน repo ที่ `docs/PLAN-inventory-calendar.md` — สรุปสาระสำคัญไว้ที่นี่เพื่อให้ session/account อื่นทำต่อได้

**สเปกเจ้าของ (ย่อ)**: ปฏิทินเดือน/สัปดาห์/วัน/รายการ + filter (คลัง, ประเภท, สถานะ, ความสำคัญ, ผู้ขาย, ค้นหา); event ประเภท นับสต๊อก / รับของ / จัดซื้อ / ใกล้หมด / หมด / ปรับสต๊อก / ของเสีย / ตัดรอบผู้ขาย / แนะนำสั่งซื้อ / งาน; **ห้าม audit และ transfer**; expiry เลื่อนออก (ยังไม่มี batch/lot); drawer รายละเอียด + ปุ่มตามสิทธิ์; ตารางนับสต๊อกอัตโนมัติ (config ใน Settings); workflow scheduled→pending→inProgress→(waitingApproval)→completed / overdue; แจ้งเตือนในแอป (bell, priorities CRITICAL/HIGH/MEDIUM/INFO, preferences, escalation, daily brief, weekly summary); reorder recommendation + estimated stockout; threshold ปรับสต๊อก/ของเสีย; ห้ามสร้าง event/PR/PO ซ้ำ (deterministic id); ห้าม hardcode; ไม่ให้งาน background ผูกกับการเปิดแอป; วิเคราะห์โควตา Firebase ไม่ให้ชน 50k reads/วัน

**คำตัดสินของเจ้าของ (17 ก.ย.)**: (1) background jobs = **Cloudflare Worker + Cron (ฟรี)** เข้า Firestore ผ่าน REST ด้วย **service account key** ที่เก็บเป็น Cloudflare secret — เจ้าของจะสร้าง SA ใน GCP เอง (สิทธิ์ `roles/datastore.user` เท่านั้น) และวางเป็น secret `FIREBASE_SERVICE_ACCOUNT`; (2) ไม่ทำ expiry รอบนี้; (3) อนุมัติ collection ใหม่ 2 ตัว: `notifications`, `inventorySchedules` (+ field ใหม่บน suppliers/stockEvents/purchaseOrders); ถอด listener `notes` เพื่อเอาโควตา listener (สูงสุด 7) ไปให้ notifications; (4) ส่ง 4 เฟส ขึ้นของจริงทีละเฟส

**สถาปัตยกรรม (ทำแล้วใน Phase A)**
- `src/lib/inventoryRules/` = กฎธุรกิจล้วน (ห้าม import backend/react/i18n/firebase — จะถูก bundle เข้า Worker ด้วย): `time.ts` (วันแบบ Bangkok UTC+7 คงที่: `bkkDayStart/End/Key/FromKey/Weekday/AtTime`), `types.ts` (`CalendarItem` view-model: id deterministic, kind, sourceType/sourceId, titleKey+params, at, status, priority, meta), `calendarFeed.ts` (`buildFeed(input)` pure), `purchasing.ts` (`expectedDeliveryAt` = วันบนใบ → orderedAt+leadTimeDays → ไม่ทราบ; `isLate`/`daysLate`/`deliveryState`; `openPurchaseFor` กัน PR/PO ซ้ำ; `incomingFor`; `cutoffInstants`), `lowStock.ts` (`shortages()` กฎเดียวใช้ทั้ง Dashboard/TopBar/ปฏิทิน), `permissions.ts` (`actionsFor(item, actor)` — ตอนนี้ยัง admin-only สำหรับ edit/cancel/delete task)
- **derived vs persisted**: เก็บเป็นเอกสารเฉพาะ task (`stockEvents`); รับของ/PR รอ/ตัดรอบ/ใกล้หมด/หมด **คำนวณตอนอ่าน** จากข้อมูลที่โหลดอยู่แล้ว → ไม่มีซ้ำโดยโครงสร้าง; "overdue" เป็นสถานะคำนวณ ไม่เก็บ
- `src/data/rangeCache.ts` (`createRangeCache`) + `eventCache.ts` (wrapper ชื่อเดิม), `orderCache.ts` (orderedAt), `requestCache.ts` (createdAt): cache ช่วงวันต่อ session, **covering lookup** (ช่วงแคบใช้ของช่วงกว้างที่โหลดไว้), in-flight dedup, patch-in-place ไม่ invalidate; `src/data/useCalendarFeed.ts` อ่าน 3 ช่วง (orders ย้อน 45 วัน, requests ย้อน 30 วัน) แล้ว `buildFeed`; หน้า Orders/Requests patch cache เมื่อเขียน; **ช่วงต้อง day-aligned** (bkkDayStart/End) ไม่งั้น key เปลี่ยนทุกครั้ง
- หน้าจอ `src/pages/calendar/`: `CalendarPage` (เดือน/สัปดาห์/วัน/รายการตามวัน, การ์ดสรุป, filter, `?filter=today|attention|tasks|purchasing|stock|completed` และ `?item=<id>` จาก Dashboard, มือถือ = วันนี้→ต้องดูก่อน→งานของฉัน→7 วัน→ปฏิทินย่อ ตัวกรองพับ), `MonthGrid`, `WeekView`, `AgendaList`, `CompactMonth`, `ItemRow` (`itemTitle/itemSubtitle`), `ItemDrawer` (`<Modal sheet>` bottom sheet บนมือถือ; ปุ่ม: task start/complete/edit/cancel/delete, PO ดูใบ/ตรวจรับ → `/orders?po=|receive=`, PR → `/requests/:id`, low/out → ประวัติ / สร้าง PR (ถ้า `openPurchaseFor` เจอ แสดง "มีการสั่งซื้ออยู่แล้ว")), `EventEditor` (type เสนอแค่ stockCount/delivery/inventoryTask/other), `chips.ts` (icon/label/tone)
- Dashboard: `src/components/dashboard/TodayPanel.tsx` (วันนี้ + 7 วัน + การ์ด 4 ใบ); `RequestWidget` ใช้ requestCache
- ฟิลด์ใหม่: `Supplier.orderDays: number[]` (0=อา), `cutoffTime 'HH:mm'` (ฟอร์มผู้ขายมีปุ่มวัน+เวลา; rules validSupplier); `PurchaseOrder.expectedAt` (ตั้งตอนสั่ง เติมจาก leadTime, แก้ในแถวหน้า Orders ผ่าน `setExpectedDelivery`; `overdueOrders(orders, now, leadTimeOf)` ยึดวันนี้แทนกฎ 3 วันเมื่อมี); `StockEvent.status += 'waitingApproval'`, `productId?`, `supplierId?` (type เท่านั้น ยังไม่มีใครเขียน — rules ยังไม่รับ `waitingApproval`)
- `Modal` มี prop `sheet`; `Icon` เพิ่ม bell/clock/alertCircle/checkCircle/cart/box; `src/lib/search.ts` (`looseIncludes/looseMatch/looseScore`) ใช้กับทุกช่องค้นหา
- ถอดแล้ว: เมนู/route/หน้า "บันทึกช่วยจำ" + listener `notes` (ข้อมูล, rules, backup ยังอยู่)

**purchasing polish (17 ก.ย. ทำแล้ว)**: `PurchaseRequestItem.stockAtSubmit/stockTotalAtSubmit` snapshot ตอน `submitRequest` (ctx.qtyAt) → คอลัมน์ "คงเหลือ" ในหน้าตรวจ + export; PDF/Excel กดได้ตั้งแต่รออนุมัติ; `PoSheet` มี `lang` prop + `SheetLangToggle` (TH/EN, `translatorFor(lang)`, `formatDateFor`), ใบที่รับแล้ว = "ใบรับของ" ตรา + คอลัมน์สั่ง/รับจริง; เส้นในตารางใบเอาออก (เจ้าของสั่ง); `setDateLanguage` ทำให้วันที่เป็น ค.ศ. เมื่อ UI เป็น EN

**ค้างจากข้อความล่าสุดของเจ้าของ (ยังไม่ทำ — ทำก่อน Phase B)**
1. ชื่อคลัง "คลังหลัก/สาขาสารสิน/สาขาอ่อนนุช" ต้องเป็นอังกฤษเมื่อ UI เป็น EN → เสนอ: ฟิลด์ `nameEn?` บน locations (แก้ใน Settings, rules validLocation hasOnly) และ DataContext ส่ง `locations` ที่ชื่อสลับตามภาษา (Settings ใช้ raw); ไล่ Thai ที่เหลือ (แบรนด์ tagline ใน `src/brand/brand.ts`, ชื่อผู้ใช้เดโม)
2. เอาคำว่า "(แบรนด์น้อง)" ออกจาก tagline Le Lapin (`src/brand/brand.ts`)
3. **บั๊ก selection หลุด**: ลากเลือกข้อความใน Modal แล้วปล่อยเมาส์นอกกรอบ → overlay `onClick` ปิด modal ทำให้ selection หาย → แก้ใน `ui.tsx` Modal: ปิดเฉพาะเมื่อ mousedown **และ** mouseup อยู่บน overlay เอง
4. คงเหลือในหน้าตรวจ PR ต้องแยกต่อคลัง (คลังหลัก/สารสิน/อ่อนนุช) → เพิ่ม `stockByLocationAtSubmit: Record<locationId, number>` ตอน submit และแสดงใต้ตัวเลข
5. ใบสั่ง/ใบรับของ: "รับจริง" ให้ขึ้นบรรทัดใหม่ใต้ชื่อสินค้า (เขียว=ตรง, แดง=ต่าง คงสีเดิม); เปลี่ยนคำ "ภาษาในใบ" → "ภาษา"
6. ปรับดีไซน์ตารางปฏิทินให้สวยขึ้นตาม Figma "Content Calendar with Auto-Layout 2025 (Community)" file `MrYi0FVUiViBW50pcJ0Mef` node `4-644` — ใช้ Figma MCP `get_screenshot`/`get_design_context` ดู แล้วปรับ `MonthGrid`/`WeekView` (สี token เดิม ไม่ใส่ gradient)

**Phase B — ทำแล้ว 18 ก.ย.** (branch `feat/inventory-calendar`)
- **ตารางนับสต๊อก**: Settings → "ตารางนับสต๊อก" (admin) — ทุกวัน/สัปดาห์/2 สัปดาห์/เดือน (วันที่ไม่มีในเดือน = วันสุดท้าย)/ทุก N วัน, เวลาเริ่ม, ต้องเสร็จภายใน (ชม.), ผู้รับผิดชอบ, ต้องอนุมัติ, ความสำคัญ, เปิด/ปิด, preview 5 วันถัดไป (ฟังก์ชันเดียวกับที่ generator ใช้). เก็บใน `inventorySchedules` (`kind:'stockCount'`), แคชทั้ง collection ครั้งเดียวต่อ session (`useScheduleConfig`; reload เมื่อ cache ว่าง — บั๊กที่เจอตอนเดิน demo: save แล้วค้าง "กำลังโหลด" เพราะ effect โหลดแค่ตอน mount)
- **Generator** `generateStockCountTasks` (`src/services/automation.ts`): 1 range read (วันนี้→+14 วัน) + `getOne` เฉพาะ id ที่ขาด (กันงานที่ถูกเลื่อนออกนอกช่วงกลับมา) + 1 write ต่องานใหม่ ใต้ id `sc__<scheduleId>__<yyyymmdd>` (= `refKey`, rules บังคับ `refKey == id`) → รันซ้ำ/ทับกับ Worker = 0 ใหม่. เรียกจาก `CalendarPage` ตอนเปิด (`runOnOpen`: local mode เสมอ; cloud เฉพาะ manager/admin เมื่อ `meta/cronStatus.lastRunAt` เก่ากว่า 26 ชม. หรือไม่มี; วันละครั้งต่อเครื่องต่อแบรนด์ ผ่าน localStorage) และปุ่ม "สร้างงานตอนนี้" ใน Settings → งานอัตโนมัติ (manager+). **ก่อนมี Worker (Phase C) งานจะถูกสร้างเมื่อหัวหน้า/แอดมินเปิดปฏิทินเท่านั้น**
- **Workflow งาน** (`services/events.ts`): `startEvent` / `completeEvent(canApprove)` (งาน `requiresApproval` ที่พนักงานทำ → `waitingApproval`; หัวหน้าทำเอง = อนุมัติในขั้นเดียว) / `approveEvent` / `reopenEvent(reason)` (ส่งกลับ ล้าง completed*/approved*) / `rescheduleEvent(reason)` (เลื่อน dueAt ตาม, เก็บ `rescheduledFrom`) / `cancelEvent(reason)`; ทุกขั้นเขียน `history[]` ในชื่อผู้ทำ (≤100, เต็มแล้วตัดเก่าสุดยกเว้นบรรทัดแรก). `updateEvent` ต้องส่ง `previous` — เปลี่ยนเวลาเริ่ม = บันทึกเป็น rescheduled. `setEventStatus` ถูกลบ
- **Rules**: `validEvent` = `eventFrozen` (ตอนสร้าง) + `eventLive` (ทุกครั้ง, update ใช้แค่ `eventLive` — งบ expression); สร้างได้ `manager()` ในชื่อตัวเอง และต้อง `status=='upcoming'`; `eventEdit`: manager แก้ได้ทุกอย่างยกเว้น type/ที่มา/ผู้สร้าง, `approvedBy` ต้องเป็นตัวเอง; staff แก้ได้แค่ status/started*/completed*/history บนงานที่ `assignedToMe` (ชื่อ/ทุกคน/ไม่มีใคร), ไปข้างหน้าเท่านั้น (`old.status in [upcoming,inProgress]`); **`historyKept`: เปลี่ยน status หรือ startAt ต้องเขียน history, history ไม่หด, บรรทัดสุดท้ายต้อง `by == auth.uid`**; งานที่ `requiresApproval` จะ completed ได้ต้องมี `approvedBy`; ลบ: manager เฉพาะงานที่ตัวเองสร้างหรืองานจากตาราง, admin ทุกงาน (UI ไม่ให้ลบงานจากตาราง — ให้ยกเลิก ไม่งั้นจะถูกสร้างใหม่); `inventorySchedules` write gate ตาม prefix id (`prefs__<uid>` ตัวเอง, `snooze__` ทุกคน, อื่น admin); `meta/cronStatus` read active / write false
- **UI**: `ItemDrawer` ปุ่มตาม `taskActions` (`permissions.ts` — manager เข้ากลุ่มจัดการแล้ว, staff เฉพาะงานของตัวเอง) + แถว ที่มา/การตรวจ/เดิมกำหนด/เริ่มโดย/ทำเสร็จโดย/อนุมัติโดย/เหตุผลที่ยกเลิก + **ประวัติ** (ใหม่สุดก่อน, เลื่อน = เวลาเก่า→ใหม่ + เหตุผล); `RescheduleModal` + `ReasonModal` (เลื่อน/ส่งกลับ ต้องมีเหตุผล, ยกเลิก ไม่บังคับ); `EventEditor` มี "ต้องให้หัวหน้าอนุมัติเมื่อเสร็จ" และอ่านเอกสารกลับหลังบันทึก (`getEvent`) ให้ drawer เห็น history จริง; Settings: `src/pages/settings/{SchedulesSection,ThresholdsSection,AutomationStatus}.tsx`. **ThresholdsSection บันทึกค่าได้แล้ว แต่ยังไม่มีอะไรอ่าน** — ใช้ใน Phase C/D
- **Backup** FORMAT_VERSION 6: `inventorySchedules` อยู่ในไฟล์ (overwritable, best-effort เพราะ `prefs__<uid>` ของคนอื่นเขียนคืนไม่ได้)
- **Tests**: `tests/inventory-rules/{schedules,permissions}.test.ts`, `tests/automation.test.ts` (2 สัปดาห์ = 5 งาน, รันซ้ำ 0, งานที่เลื่อนออกไม่กลับมา, แยกแบรนด์), `tests/events.test.ts` workflow, rules (manager create, generated id=refKey, staff forward-only + assigned, history ต้องมี/ห้ามหด/ห้ามเซ็นชื่อคนอื่น, schedules/prefs/snooze/cronStatus), budget replay งานกว้างสุด (50 assignees, history 99) ผ่าน
- **ข้อจำกัดที่ตั้งใจ**: หัวหน้า (manager) อ่านรายชื่อผู้ใช้ไม่ได้ (rules `users` list = admin) → ตอนสร้าง/แก้งาน หัวหน้ามอบหมายได้แค่ "ทุกคน" หรือตัวเอง (คนที่มอบหมายไว้เดิมยังอยู่) — ถ้าเจ้าของอยากให้หัวหน้าเลือกพนักงานรายคน ต้องตัดสินใจเปิด `users` ให้ manager อ่าน (หรือทำ roster ย่อชื่อ+uid)
- **หลัง deploy**: client เก่า (PWA ที่ยังไม่ reload) ของพนักงานจะกด เริ่ม/เสร็จ ไม่ได้ (rules ใหม่บังคับ history) จนกว่าจะปิดแท็บเปิดใหม่ — ประกาศให้ปิดแอปเปิดใหม่
**Phase B ขึ้นของจริงแล้ว 18 ก.ย.** (rules deploy → main `ec00f43` → bundle `index-DnhNdwSW.js`)

**Phase C–D — ทำแล้ว 18 ก.ย.** (branch `feat/inventory-calendar`)
- **กฎล้วน** `src/lib/inventoryRules/`: `stockView.ts` (qtyAt/minFor/tracksProduct — DataContext ใช้ตัวนี้แล้ว ให้ Worker ได้ตัวเลขเดียวกัน), `usage.ts` (issue+consume ออก + adjust-out lost/broken/expired/damage; ต้อง ≥2 รายการ และ ≥7 วัน ไม่งั้น `avgDaily = null`; เฉพาะหน่วยหลัก), `reorder.ts` (จุดสั่ง = rate×lead + min; สั่ง = rate×(lead+coverDays) + min − (มี+กำลังมา), ปัดขึ้น, ≥ MOQ; ไม่มี rate → ≤ min ให้เติมถึง **2×min** (`MIN_STOCK_TARGET_FACTOR`); lead ไม่ตั้ง = **2 วัน** (`DEFAULT_LEAD_DAYS`); `stockoutSoon` = หมดก่อน lead+1 วัน), `adjustments.ts` (ของเสีย ≥ wasteValueBaht; ปรับ ≥ adjustValueBaht หรือ ≥ adjustPct% ของยอดก่อนปรับ; ไม่มีต้นทุน → ใช้ % อย่างเดียว), `insights.ts` (รวมทั้งหมด + `inProgress` จาก `openPurchaseFor` + snooze), `notifications.ts` (engine: `evaluate` → drafts id คงที่, `plan` → create/rearm/resolve, `isFor` + mute; critical ปิดไม่ได้), `copy.ts` (ข้อความไทยต่อ kind — เก็บแค่ kind+params ในเอกสาร)
- **Notification kinds**: taskSoon (ก่อนเริ่ม reminderBeforeMin), taskOverdue*, taskEscalated (เลย escalateAfterHours → หัวหน้า), taskApproval (ทันทีตอนส่งตรวจ), prSubmitted (ทันทีตอนส่ง PR), poArriving, poDelayed*, cutoffToday, lowStock*, outOfStock* (critical), stockoutSoon*, reorder* (ไม่แจ้งถ้ามี PR/PO อยู่แล้ว), adjustment/waste (ทันทีจากหน้าปรับสต๊อก, id = `<kind>__<docNo>__<productId>`), dailyBrief (หลัง 07:00), weeklySummary (จันทร์ 07:30). `*` = state: resolve เมื่อหาย, re-arm (ยังไม่อ่านใหม่) เมื่อกลับมา. เป้าหมาย: งาน → คนที่ได้รับมอบหมาย (หรือทุกคน), อื่น ๆ ส่วนใหญ่ → manager+admin, ของเข้าวันนี้ → ทุกคน
- **Rules `notifications`** (ทั้งสองแบรนด์): อ่าน = active; สร้าง = ในชื่อตัวเอง, `source:'client'`, `readBy` ว่าง, id ขึ้นต้นด้วย `<kind>__`; staff สร้างได้เฉพาะ taskApproval/prSubmitted/adjustment/waste, manager ได้ทุก kind; แก้ = เฉพาะ `readBy.<uid ตัวเอง>`+updatedAt หรือ manager (resolve/re-arm); ลบ = admin. Worker เขียนด้วย service account (นอก rules) — จำกัดใน code ให้เขียนได้แค่ stockEvents/notifications/meta (`worker/src/store.ts` + test)
- **แอป**: listener ตัวที่ 7 ใน DataContext (`createdAt ≥ เปิดแอป − 7 วัน`); กระดิ่งใน TopBar (`components/notifications/NotificationBell.tsx`: แท็บ ทั้งหมด/วิกฤต/งาน/สต๊อก/จัดซื้อ/ผู้ขาย, แตะ = ไปที่ลิงก์ + mark read, อ่านทั้งหมด); Settings → "การแจ้งเตือนของฉัน" (ทุกคน, `inventorySchedules/prefs__<uid>`); `useAutomation` (ใน Layout — ย้ายมาจาก CalendarPage) รัน generator วันละครั้ง + `runNotificationJobs` ทุก 30 นาที: **demo ทุก 5 นาทีเสมอ; ของจริงเฉพาะหัวหน้า/แอดมิน และเฉพาะเมื่อ Worker เงียบเกิน 26 ชม. (หรือยังไม่เคยรัน)**
- **ปฏิทิน (D)**: kind ใหม่ reorder / stockoutEstimate (วันนี้) / adjustment / waste (วันที่ของรายการ) + ตัวกรอง; drawer: แนะนำสั่ง (จำนวน, คงเหลือ, กำลังมา, ใช้/วัน, หมดใน, คิดจาก), ปุ่ม "สร้างรายการขอสั่งซื้อ" → `/requests/new?product=&location=&qty=` (RequestEditor เติมคลัง + การ์ด "เพิ่มลงรายการ"; สินค้าไม่มีผู้ขาย = บอกให้เลือกเอง), "ยังไม่สั่ง (ซ่อน 7 วัน)" = `snooze__reorder__<pid>__<loc>`
- **Worker** `worker/` (`pzmstock-cron`): `auth.ts` (JWT RS256 WebCrypto → token), `firestore.ts` (REST runQuery/batchGet/batchWrite, create = `exists:false`), `codec.ts`, `jobs.ts`; crons (UTC) `*/30` งาน, `0 0` = 07:00 สต๊อก/จัดซื้อ/สรุปวัน, `5 17` = 00:05 สร้างงานนับ + ลบแจ้งเตือนเกิน 30 วัน, `30 0 * * 1` = สรุปสัปดาห์; ทุกรอบเขียน `meta/cronStatus`; kill switch `WORKER_ENABLED`; query ตาม status (งานเปิด/PO ordered/PR เปิด) ไม่อ่านประวัติทั้งก้อน; ≤ ~28 subrequest/รอบ (ฟรีได้ 50). **ข้อควรรู้**: รอบ 30 นาทีใช้ query `kind == taskOverdue AND active == true` (สอง equality — Firestore ใช้ index merge; ถ้าเจอ error "requires an index" ใน `meta/cronStatus.error` ให้กดลิงก์สร้าง index)
- **สิ่งที่เจ้าของต้องทำเองเพื่อเปิด Worker** (ก่อนทำ ระบบใช้เครื่องหัวหน้าทำแทน — ใช้ได้แต่ต้องมีคนเปิดแอป):
  1. GCP Console (project `pzm-stock-x5`) → IAM → Service Accounts → สร้าง `pzmstock-cron` → role **Cloud Datastore User** (`roles/datastore.user`) อย่างเดียว → Keys → Add key → JSON (ดาวน์โหลด — ห้ามส่งในแชต/commit)
  2. `npx wrangler login` (บัญชี Cloudflare เดียวกับ Pages)
  3. `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT -c worker/wrangler.toml` แล้ววาง JSON ทั้งไฟล์
  4. `npm run worker:deploy` → เปิด `https://pzmstock-cron.<subdomain>.workers.dev/health` ต้องได้ `configured: true`
  5. วันรุ่งขึ้นดู Settings → งานอัตโนมัติ ต้องขึ้น "งานเบื้องหลังทำงานล่าสุด …" และ Firebase console → Usage เทียบกับตารางโควตาด้านล่าง
- **Tests**: `tests/inventory-rules/{notifications,reorder}.test.ts`, `tests/notifications-service.test.ts`, `tests/worker/{worker.test.ts,fakeStore.ts}` (job รันซ้ำ = 0, resolve/re-arm, สองแบรนด์, allow-list, crons ตรง wrangler.toml, codec, JWT verify), `tests/quota-budget.test.ts`, rules (notifications 4 เคส)
- **ไม่ได้ทำ (ตามสเปก/ตัดสินไว้)**: expiry/batch-lot, audit, transfer, push/อีเมล/LINE (มีแต่ในแอป), MOQ ในคำแนะนำของ Worker (supplierItems ไม่ได้อ่าน — แอปก็ยังไม่ส่ง MOQ เข้า insights)

**โควตา (model ใน `tests/quota-budget.test.ts`, ขนาดแคตตาล็อก ก.ย. 69)**: ~27.4k reads/วัน จาก 50k = baseline 12k + Worker ~11.4k (ส่วนใหญ่รอบ 07:00: สินค้า 460 + ยอดคงเหลือ 1,400 + ledger 30 วัน ต่อแบรนด์) + แอป ~4k; writes ~540/20k. ปุ่มลด: `usageWindowDays` ใน Settings (30 → 14 ลด ledger ครึ่ง), รอบ `*/30` เป็นรายชั่วโมง. ต้องเทียบกับ Firebase console → Usage หลัง Worker ขึ้นสองวัน

---

## 11. ผู้ขายยืนยันวันส่ง (Supplier PO Confirmation) — branch `feat/supplier-confirmation` (5 ต.ค.) **ยังไม่ขึ้นของจริง**

**คำตัดสินของเจ้าของ:**
- ส่ง PO ด้วย **LINE ส่วนตัว** ผ่าน LIFF shareTargetPicker เหมือนเดิม — **ห้ามย้ายไป LINE OA / Messaging API**
- เลื่อนช้ากว่าเดิมได้เอง ≤ `supplierMaxPostponeDays` (2 วัน) / ส่งเร็วขึ้นได้เสมอ / เกินนั้นต้องให้หัวหน้าหรือแอดมินอนุมัติ
- ลิงก์ใช้ซ้ำได้จนถึงวันส่ง และบันทึกทุกคำตอบ

**@All จริงทำไม่ได้กับวิธีส่งปัจจุบัน:** LIFF 2.31 shareTargetPicker รับได้แค่ text ธรรมดา, รูป, วิดีโอ, เสียง, ตำแหน่ง และ template/flex ที่มีแต่ปุ่ม URI (`@liff/send-messages/lib/type.d.ts`, เอกสาร LIFF) — **ไม่มี textV2** จึงสร้าง mention จริงไม่ได้ และไม่ปลอมเป็นข้อความ "@All" ทางเลือกในอนาคตมีแค่ automation ของ LINE Desktop (ต้องมีโปรแกรมรันบนคอม) หรือ OA ซึ่งเจ้าของไม่เอา

**การทำงาน:**
1. SendWizard ขอลิงก์จาก `POST /api/supplier-po/link`
2. หน้าแรกส่ง: ข้อความใบสั่งซื้อใหม่ (รูปแบบของเจ้าของ) → การ์ด Flex ปุ่ม [ยืนยันวันจัดส่ง] → รูปใบ
3. ผู้ขายเปิด `/supplier/po/<token>` (`supplier.html` แยก bundle ไม่มี Firebase) → `GET/POST /api/supplier/<token>`
4. เกินช่วงที่อนุญาต → หัวหน้า/แอดมินอนุมัติในหน้ารายละเอียด PO → `POST /api/supplier-po/decide`

**กติกาข้อมูล:**
- เซิร์ฟเวอร์ (service account) เขียนฟิลด์ supplier ของ PO ได้ฝ่ายเดียว — `orderEdit` hasOnly ของเดิมกัน client อยู่แล้ว จึง **ไม่ได้แก้ rules ของ PO** (มีเทสยืนยัน)
- `expectedAt` = วันที่คาดว่าจะได้รับจริง (ปฏิทินอ่านช่องนี้); `requestedDeliveryDate` ไม่ถูกทับ
- `status` ของ PO ไม่เปลี่ยน — ใช้ `supplierConfirmationStatus` แยก
- การตอบของผู้ขายไม่สร้าง revision
- allow-list ของสิ่งที่เซิร์ฟเวอร์เขียนได้อยู่ใน `functions/_lib/serverStore.ts`

**ไฟล์:** `src/lib/supplierConfirmation.ts` (กฎล้วน), `functions/_lib/*`, `functions/api/supplier*`, `src/supplier/*`, `src/pages/purchase/SupplierConfirmationPanel.tsx`, `src/data/useSupplierRefresh.ts`

**เทส:** `tests/supplier-confirmation.test.ts`, `tests/functions/supplier-po.test.ts`, rules tests (settings + ฟิลด์ที่เซิร์ฟเวอร์เขียนฝ่ายเดียว + budget)

**ลองในเครื่อง:**
- `.dev.vars` = `SUPPLIER_DEV_FIXTURE=1` + `SUPPLIER_LINK_SECRET` (gitignored)
- wrangler ในเครื่องต่อ binding `AI` ไม่ได้ถ้าไม่ login → ใช้สำเนาใน scratch ที่ wrangler.toml มีแค่ KV
- ขอลิงก์ด้วย `curl -X POST /api/supplier-po/link -H 'authorization: Bearer dev'`

**กับดัก:**
- `_redirects` ต้องชี้ไปที่ `/supplier` ไม่ใช่ `/supplier.html` — Pages จะ 308 แล้ว token หลุด
- รายการ `/* /index.html` ถูก wrangler ข้ามเป็น loop (ไม่เป็นไร Pages fallback ให้เอง)

**ลำดับขึ้นของจริง (เจ้าของต้องทำ):**
1. deploy rules **ก่อน** แอป — saveSettings เขียน key ใหม่ ถ้า rules เก่าจะปฏิเสธ
2. สร้าง service account (`roles/datastore.user`) แล้วใส่ Pages secret `FIREBASE_SERVICE_ACCOUNT` + `SUPPLIER_LINK_SECRET` (≥ 32 ตัว)
3. merge เข้า `main`

ถ้าไม่มี secret endpoint จะคืน 503 และส่งแบบเดิมทุกอย่าง (ใช้เป็นสวิตช์ปิดได้)

## 12. Supplier Intelligence + แจ้งเตือนแบบเด้ง (6 ต.ค.)

แผนเต็มอยู่ใน `docs/PLAN-supplier-intelligence.md` และ `docs/PLAN-realtime-notifications.md`

**Supplier Intelligence**
- **S1** `src/lib/deliveryMetrics.ts`: ผลการส่งของต่อ PO **คำนวณจากข้อมูลเดิม ไม่เก็บลง PO** จึงไม่มี migration และ PO เก่าใช้กฎเดียวกัน ตรงเวลาวัดกับวันที่ยืนยัน
- **S2**
  - `supplierPerformance.ts` และ `supplierScore.ts` (น้ำหนักอยู่ใน `SUPPLIER_SCORE_CONFIG` ที่เดียว ถ้าส่งของแล้วไม่ถึง 5 ใบไม่ให้เกรด)
  - หน้า `/suppliers/performance`
- **S3** `deliveryRisk.ts`: คะแนนจากกฎ /100 ทุกแต้มมีเหตุผลกำกับ (version `rules-1`) **ห้ามแสดงเป็น %**
- **S4** `inventoryRisk.ts`: ของหมดก่อนของมา, ของมาไม่พอ, ของเสี่ยงช้าแต่เผื่อเวลาน้อย คำแนะนำโอนต้องเหลือขั้นต่ำและ cover ให้ต้นทาง
- **S5** `deliveryDataset.ts`: ชุดข้อมูลสำหรับโมเดล (ไม่มี leakage, แบ่งตามเวลา) **ยังไม่ train อะไร**
- ข้อมูลทั้งหมดผ่าน session cache (`useSupplierIntel`) ไม่มี listener ใหม่
- **ยังไม่ได้เก็บ:** จำนวนที่ตีกลับ (หน้ารับของไม่บันทึก)

**แจ้งเตือนแบบเด้ง**
- `NotificationHost` ใน Layout ใช้ listener เดิมของกระดิ่ง
- `presentNotification()` คือที่เดียวที่ตัดสินว่าแจ้งเตือนแต่ละชนิดแสดงอย่างไร
- `notificationQueue.ts` กันซ้ำด้วย `id@createdAt` (re-arm = เด้งใหม่, reconnect = ไม่เด้ง) รวมหลายอันเป็นใบเดียว แต่ critical แยกใบเสมอ
- `notificationSound.ts` เสียงสร้างด้วย Web Audio
- ตั้งค่าเสียงและปิดชั่วคราวเก็บใน `prefs__<uid>.sound`
- แจ้งเตือนความเสี่ยงเป็น job `risk` ใน `evaluate` (เครื่องหัวหน้า/แอดมินรันทุก 30 นาที ส่วน Worker ยังไม่รัน job นี้) หนึ่งเอกสารต่อระดับที่ถึง
- Debug ได้จาก `window.__pzmNotificationLog`

**Rules ที่เปลี่ยน**
- `validPrefs` เพิ่ม `sound`
- staff สร้างแจ้งเตือน `poSent` ได้

## 13. PZM Operations OS: audit ทั้งระบบ + แก้ทีละเฟส (เริ่ม 6 ต.ค.)

**แผนที่เจ้าของอนุมัติ:** `docs/PLAN-operations-os.md` มีครบ 20 หัวข้อ + Top 10 + exit criteria และความเห็นแก้ 9 ข้อของเจ้าของ

**ลำดับความสำคัญ:** DATA → WORKFLOW → EFFICIENCY → EXCEPTIONS → OBSERVABILITY → INTELLIGENCE → AUTOMATION
**กติกาที่ต้องยึด:**
- ห้ามวาง AI/automation บนข้อมูลที่ยังไม่น่าเชื่อถือ
- **ห้าม merge เข้า main เอง** ต้องรอเจ้าของสั่ง
- ทดสอบการเขียนข้อมูลบน demo/emulator เท่านั้น

### เจ้าของตัดสินแล้ว (6 ต.ค.)
- อนุญาตให้ใช้ Playwright และ emulator สำหรับเทส
- ใช้ service account ตัวเดิมเขียนสต๊อกผ่าน Functions ได้ (ADR-001 ขยาย allowlist ทีละคำสั่ง)
- popup วิกฤตยังหายใน 4 วินาที แต่ให้**ค้างเป็นแถบแดงที่กระดิ่งจนกดรับทราบ**
- **พนักงานสร้าง PO สถานะ `ordered` เองไม่ได้แล้ว** ต้องให้หัวหน้า/แอดมินอนุมัติ (B4 ยังไม่ทำ)

**ยังไม่ได้ถาม:** collection `auditLog`, ตัดปุ่มล้างแคตตาล็อก (hard delete ที่มีประวัติปิดแล้วใน B3), รวม Batch Excel เข้า PR, lot/วันหมดอายุ

### Branch และสถานะ (ยังไม่มีอะไร merge เข้า main)
| Branch | งาน | สถานะ |
|---|---|---|
| `fix/import-review` | หน้ารีวิวนำเข้าไฟล์แบบการ์ด + คำแนะนำสินค้า (`src/lib/productSuggest.ts`) | เสร็จ รอสั่ง merge |
| `feat/integrity-auditor` | **Phase 0**: auditor + harness e2e + หลักฐาน | **PASS** รอสั่ง merge |
| `feat/phase-a-ledger` (แตกจาก `feat/integrity-auditor`) | **Phase A**: A1 + A2 เสร็จ | กำลังทำ |
| `claude/phase-a-ledger-continue-uzbbb5` (ต่อจาก `feat/phase-a-ledger`) | **Phase A**: A6 เสร็จ | กำลังทำ รอสั่ง merge กลับเข้า `feat/phase-a-ledger` |

### Phase 0 (เสร็จ): `docs/evidence/phase-0.md`
- **Auditor** `src/lib/integrityAudit.ts` อ่านอย่างเดียว ตรวจ 6 หมวด
  ```bash
  npm run audit:integrity -- <backup.json>
  ```
  ใช้ 0 reads
- กติกาการคิด key ของยอดคงเหลือแยกไปที่ `src/lib/levelKey.ts` ตัว auditor และ engine จึงใช้ร่วมกัน
- **Harness e2e**
  ```bash
  npm run test:e2e
  ```
  สั่ง `firebase emulators:exec` firestore+auth project `demo-pzm-e2e` ร่วมกับ Playwright และ `vite --mode e2e` port 5176
  - เปิดโหมดนี้ด้วย `.env.e2e` (`VITE_USE_EMULATOR=1`)
  - ใช้ได้บน localhost เท่านั้น และถูกตัดออกจาก build ของจริง (ตรวจแล้ว 0 hits ใน `main-*.js`)
- **Baseline จาก backup ของจริง** (`D:\AI Solution\pzm-stock-*-20261006-1500.json`)
  - ทั้งสองแบรนด์: 0 critical, ยอดคงเหลือ drift 0
  - **ข้อค้นพบ 1 ข้อ รอเจ้าของตัดสิน:** สินค้าเก่า "SAUSAGE MIX DOLCE (FOOD WAY)" หน่วย EA ถูกลบไปแล้ว แต่ยังมีของ **20 EA ค้างที่คลังหลัก** (RC-00019) ซึ่งมองไม่เห็นในแอป
- **ช่องโหว่ที่ยังเปิดอยู่** (เขียนเป็น `test.fail` ใน `e2e/hostile-client.spec.ts` วันที่ปิดได้ เทสจะแดง ให้ถอด marker ออก)
  - S1: staff เขียน `stockLevels` ตรงได้
  - S2: ใส่ `transferId` ปลอมได้
  - S5: staff แก้ movement ได้
  - B4: staff สร้าง PO `ordered` ได้

### Phase A (กำลังทำ) — commit `7aad548` บน `feat/phase-a-ledger`
- **A1 เสร็จ:** การรับของจาก PO ทำใน transaction เดียว (`receivePurchaseOrder` ใน `src/services/purchaseOrders.ts`)
  - อ่าน PO ใน tx แล้วใช้ `settleDelivery()` (pure function)
  - `planReceive()` (แยกออกมาจาก `receiveStock` ใน `stock.ts`) แล้ว commit movement + ยอดคงเหลือ + PO พร้อมกัน
  - movement id = `rc_<poId>_<operationId>_<n>`, `PoReceipt.receiptId` ใหม่
  - หน้า Receive เก็บ `operationId` ใน draft จนกว่าจะบันทึกสำเร็จ ถ้า retry จะได้ผลเดิมกลับมา (`replayed`) พร้อม toast
  - เครื่องที่แพ้ race จะถูก rules ปฏิเสธ ระบบอ่าน PO ใหม่แล้วแสดงข้อความว่า "ใบสั่งซื้อนี้เพิ่งมีคนรับของไป…"
  - e2e: สองเครื่องกดพร้อมกันแล้วสต๊อกเข้าครั้งเดียว (ก่อนแก้ได้ 20 แทน 10), คำตอบหายหลัง commit แล้วไม่บันทึกซ้ำ
- **A2 เสร็จ:** `remainingBaseQty()` ใน `src/lib/inventoryRules/purchasing.ts` เป็นที่เดียวที่คิดยอดค้างรับ ใช้ทั้ง `incomingFor` (คำแนะนำสั่งซื้อ) และ `inventoryRisk`
  - สูตร = (สั่ง − รับแล้ว) × อัตราแปลง ณ วันสั่ง
  - บรรทัดเก่าที่ไม่มี baseQty ใช้อัตราวันนี้ พร้อมธง `estimated`
  - เทสอยู่ใน `tests/incoming.test.ts`
  - ข้อมูลจริงตอนนี้ไม่มี PO ที่รับบางส่วนค้างอยู่ จึงไม่มีตัวเลขไหนเปลี่ยน
- **A6 เสร็จ (branch `claude/phase-a-ledger-continue-uzbbb5`):** แปลง PR → PO แบบ idempotent (`convertToOrders` ใน `src/services/purchaseRequests.ts`)
  - ทั้งหมดอยู่ใน tx เดียว: อ่าน PR ใน tx (ต้อง `approved`) → `tx.get` PO ทุกใบตาม id `po_<prId>_<supplierId>` (`conversionOrderId` ใน `src/lib/requestConversion.ts`) → อ่าน counter ของผู้ขายใน tx → สร้าง PO + counter + PR `poCreated` พร้อม `orders` ในคราวเดียว ถ้าบรรทัดไหนสั่งไม่ได้ (เช่น ไม่มีอัตราแปลง) จะไม่มีอะไรถูกเขียนเลย
  - PR ที่เป็น `poCreated` แล้ว → คืน `orders` เดิมโดยไม่เขียนอะไร (replay) กดซ้ำ/สองแท็บ/คำตอบหายหลัง commit ได้ PO ชุดเดียว เครื่องที่แพ้ race ถูก rules ปฏิเสธ (PO มีแล้ว กลายเป็น update) ระบบอ่าน PR ใหม่แล้วคืนผลของอีกเครื่อง ไม่มี error ขึ้นจอ
  - `createPurchaseOrder` แยกเป็น `newOrderFields` (pure) + `counterSeeds` + `nextOrderSeq` + `writeNewOrder` ใน `purchaseOrders.ts` หน้าสร้าง PO เองและการแปลง PR ใช้ชุดเดียวกัน
  - `conversionRunId` / `convertedAt` / `convertedBy` **ยังไม่ได้เป็น field บน PR** เพราะ rules ตอนนี้ (`requestEdit` hasOnly) จะปฏิเสธ จึงเก็บไว้ใน history entry `convertedToPo` (`runId`, `at`, `by`) แทน ส่วน field บนเอกสาร + rule `convertedBy == caller` ให้ทำพร้อม **A5 ใน A-rules**
  - **PR ค้างครึ่งทางของเก่า:** การแปลงจะปฏิเสธพร้อมบอกเลข PO ที่ค้าง และส่งแอดมินไปที่ **ตั้งค่า › ซ่อมรายการขอสั่งซื้อที่ค้าง** (`src/pages/settings/StuckRequestsSection.tsx`) ซึ่งอ่านเมื่อกดปุ่มเท่านั้น แสดงทีละใบ ให้เลือก "ผูกใบเดิม" (`convertToOrders({ adopt })` รับ PO เดิมแล้วสร้างเฉพาะผู้ขายที่ขาดใน tx เดียว แอดมินเท่านั้น) หรือ "ยกเลิกใบนี้" พร้อมเหตุผล ถ้ามี PO ซ้ำของผู้ขายเดียวกันหรือ PO ของผู้ขายที่ไม่อยู่ใน PR แล้ว ต้องยกเลิกก่อนจึงผูกได้ (`repairPlan`) **ไม่ทำอัตโนมัติ**
  - auditor ใช้ `stuckConversions()` ตัวเดียวกับเครื่องมือซ่อม
  - เทส: `tests/purchase-requests.test.ts` (replay, เลขต่อ counter, ล้มกลางทางไม่เหลืออะไร, PO ค้างเก่าถูกปฏิเสธ, adopt, blockers) · e2e `e2e/convert-request.spec.ts` (กดครั้งเดียว, ดับเบิลคลิก, สองแท็บพร้อมกัน, คำตอบหายหลัง commit, ซ่อม PR ค้างผ่านหน้าจอแอดมิน) ทั้งหมดผ่านบน emulator ภายใต้ rules จริง
- **ผลเทสล่าสุด (หลัง A6):** unit 1,175 ผ่าน · rules 217 ผ่าน · e2e 14/14 ตามคาด (รวม `test.fail` 4 ข้อของ hostile-client) · lint 0 errors · i18n ครบ · build ผ่าน
- **A7 เสร็จ:** amend / cancel / closeRemainder อ่านและเขียน PO ใน tx (`changeOrder`) ยกเลิกแข่งกับรับของได้ผลอย่างใดอย่างหนึ่ง ไม่มี PO ยกเลิกที่มีของเข้า
- **A8 เสร็จ (เลือก "ห้าม"):** แถวที่รับจาก PO แก้ได้เฉพาะหมายเหตุ ห้าม void ให้ปรับสต๊อกแทน เพราะ rules ไม่ให้ถอด receipt ออกจาก PO และไม่ให้ `received` กลับเป็น `ordered`
- **A10 เสร็จ:** `postMonthlyCount` รับ "ยอดที่นับ" แล้วคำนวณผลต่างใน tx = นับได้ − (ยอดตอนนี้ − movement หลังวันนับ) ถ้ายอดขยับหลังอ่านจะอ่านใหม่และลองใหม่ (สูงสุด 4 ครั้ง) ตรวจทุกสินค้าที่นับ ไม่เฉพาะที่มีผลต่าง
- **A2 backfill:** `npm run backfill:po-baseqty -- <backup.json>` เป็น dry-run อ่านอย่างเดียว **ยังไม่ได้รันบน backup จริง** (ไฟล์อยู่เครื่องเจ้าของ)
- **หน้าสั่งซื้อ (6 ต.ค. ตามภาพ mock-up ของเจ้าของ):** กดแถวแล้วเปิดแผงขวา (`src/pages/orders/OrderPanel.tsx`) สถานะบรรทัดแรกเป็น สั่งแล้ว / ส่ง LINE / ยืนยัน (EN: Ordered / LINE sent / Approved) อยู่ใน `src/pages/orders/statusWords.ts` แยกจากพจนานุกรมเพราะ "ส่ง LINE" กับ "ยืนยัน" เป็นคำบนปุ่มอยู่แล้ว
- **หลักฐาน Phase A:** `docs/evidence/phase-a.md` — PASS ทุกข้อ ยกเว้น dry-run บน backup จริงที่ต้องรันบนเครื่องเจ้าของ
- **ผลเทสล่าสุด (จบ Phase A):** unit 1,187 · rules 217 · e2e 17 expected / 0 unexpected / 0 flaky · lint 0 errors · i18n ครบ · build ผ่าน
- **ผลเทสล่าสุด (จบ A-sec):** unit 1,208 · rules 218 · e2e 20/0/0 ไม่มี `test.fail` เหลือ

### Phase A-rules (เสร็จบน emulator — ยังไม่ deploy) → `docs/evidence/phase-a-rules.md`
- **A4:** `transferId` ต้องเป็นเอกสารโอนจริงที่ผ่านอนุมัติแล้ว
- **A5:** PR ที่อนุมัติแล้วแก้รายการไม่ได้ และ `poCreated` ต้องมี history ของผู้แปลง
- **A9:** แก้ movement ได้เฉพาะแอดมิน และ void ต้องมี `voidReason`
- **B7:** เหตุผล adjust ต้องอยู่ใน enum
- **B4:** พนักงานสั่งเองได้แค่ร่าง ให้หัวหน้า/แอดมินกด "อนุมัติสั่งซื้อ"

### Phase A-sec / ADR-001 (เสร็จสำหรับ staff + หัวหน้า — ยังไม่ deploy) → `docs/evidence/phase-a-sec.md`
- คำสั่ง stock 11 ตัวรันผ่าน `POST /api/stock/<command>` บน service account
- ใช้ตัว transaction เดียวกับแอป (`src/commands/*`)
- rules ปิดการเขียน `stockLevels`/`stockMovements` จาก client ของ staff และหัวหน้าแล้ว (S1 ปิด)
- แอดมินยังเขียนได้ เพราะเครื่องมือดูแลข้อมูลยังเป็นทาง client
- **ลำดับ deploy ห้ามสลับ:**
  1. ตั้ง `FIREBASE_SERVICE_ACCOUNT` ใน Pages
  2. deploy แอป (`.env.production` → `VITE_STOCK_COMMANDS=all`)
  3. ตรวจว่า `POST /api/stock/receivePO` ตอบ 200
  4. deploy rules
- e2e ใช้ `e2e/command-server.mjs` (handler ตัวจริงบน emulator) ผ่าน proxy ของ Vite mode e2e

### Phase B (B1 B3 B5 B6 เสร็จ — B2 รอเจ้าของ) → `docs/evidence/phase-b.md`
- **B1 period lock:** เดือนที่ post ยอดนับแล้วที่คลังนั้น บันทึกย้อนหลังเข้าไม่ได้ (`requireOpenPeriod` ใน `src/commands/ledgerTx.ts`) แอดมินแก้ได้แต่ต้องใส่เหตุผล
- **B3:** ลบสินค้า/สถานที่ที่มี movement ไม่ได้ ให้ปิดใช้งานแทน
- **B5:** ตีกลับตอนรับ (จำนวน + เหตุผล enum) ไม่เข้าสต๊อก + พนักงานรับเกินยอดค้างได้ไม่เกิน 10%
- **B6:** `ocr-bill` / `po-image` เช็ค `active` + `revokedUsers`
- **B2 (`auditLog`) ยังไม่ทำ** จึงยังไม่ผ่านเกณฑ์ Phase B ข้อ "ทุก action มีแถว audit"
- ผลเทส: unit 1,223 · rules 218 · e2e 20/0/0

### Phase C (C1–C5 เสร็จ) → `docs/evidence/phase-c.md`
- **C1:** listener ที่ล้มแสดงแบนเนอร์พร้อมปุ่มลองใหม่, ErrorBoundary ต่อหน้า, intel อ่านล้มแล้วบอกว่าล้ม ไม่แสดงเป็น "ไม่มีความเสี่ยง"
- **C2:** แจ้งเตือน `transferStuck` (≥ 2 วัน, ≥ 5 วัน = วิกฤต) และ `poPartial` (รับบางส่วนแล้วเงียบ ≥ 7 วัน)
- **C3:** หน้า `/inbox` "งานรอตัดสินใจ" (หัวหน้า/แอดมิน)
- **C4:** แบนเนอร์ออฟไลน์ + draft ของใบขอโอน
- **C5:** แถบแดงวิกฤตค้างจนกด "รับทราบ", toast error ค้างจนปิด และไม่ทับ tab bar
- axe 0 serious บน 5 หน้า (เพิ่ม devDependency `@axe-core/playwright`, `--color-danger` เปลี่ยนเป็น #cc1f1f)
- **E4 รอเจ้าของ** (error reporting เขียนที่ไหน)
- ผลเทส: unit 1,233 · rules 218 · e2e 28/0/0

### Phase D (D1' D2' D3' D5' D6' เสร็จ — D4' รอเจ้าของ) → `docs/evidence/phase-d.md`
- **D1':** lazy routes: main 1,209 KB → 218 KB, JS ตอนเปิดแอป 3.50 MB → 1.66 MB, ตรวจด้วย `npm run check:bundle`
- **D2':** notifications เป็น context แยก + `SupplierIntelProvider`
- **D3':** rangeCache อ่านเฉพาะช่วงที่ขาด + readMeter นับ getOne/getBy
- **D5':** เปิด pinch-zoom + การ์ดมือถือ RequestReview / ผลงานผู้ขาย (ไม่ prefill จำนวนรับตามคำสั่งเจ้าของ 24 ก.ย.)
- **D6':** DataTable render layout เดียว + `paged`
- **Lighthouse ยังไม่ได้วัด** ต้องวัดในเครื่องเจ้าของ

### Phase E (E1 E2 เสร็จ) → `docs/evidence/phase-e.md`
- **E1:** Stock Card แสดง มี / จอง / พร้อมใช้ / กำลังมา / วางแผนเข้า
  - จอง = 0 เพราะอนุมัติโอนแล้วของออกทันที
  - PR approved และ PO ร่างนับเป็น "วางแผนเข้า" ไม่หักยอด
- **E2:** ผลต่างนับมาก (เกิน 10% หรือ 500 บาท) ต้องหัวหน้าติ๊กอนุมัติ และเก็บชื่อผู้อนุมัติ
- **E2:** blind count (rules เพิ่ม field `blind` **ยังไม่ deploy**)

### Phase F (F1 แบบแนะนำเท่านั้น) → `docs/evidence/phase-f.md`
- คำแนะนำทุกตัวแสดงที่มา
- `tests/suggest-only.test.ts` กันไม่ให้งานเบื้องหลังเขียน PR/PO/สต๊อก
- **ยังไม่เพิ่ม AI ใหม่** ต้องให้ Auditor 0 critical 14 วันบนข้อมูลจริงก่อน และ anomaly ต้องรอ B2
- ผลเทสล่าสุด: unit 1,248 · rules 219 · e2e 29/0/0

### ค้างที่ต้องให้เจ้าของตัดสิน/ทำ (รวมทุกเฟส)
1. **B2:** collection `auditLog`
2. **E4:** error reporting เขียนที่ไหน
3. **D4':** รวม Batch Excel เข้า PR / ตัดโหมดโอนใน Issue
4. lot/วันหมดอายุ
5. **Deploy ตามลำดับ:** service account → แอป → ตรวจ `/api/stock/receivePO` → rules
6. dry-run backfill baseQty และ Lighthouse บนเครื่องเจ้าของ
7. **E3:** ใส่ key ให้ cron Worker
8. Auditor 14 วันก่อนเปิด AI ตัวใหม่

### กับดักของ harness
- เอกสารที่ seed ต้องมี field `id` (rules อ่านค่านี้) ยกเว้น `users`
- `counters` ต้องมี `id` ด้วย
- การโหลดหน้าเต็มจะถามเลือกแบรนด์ใหม่ ใช้ `e2e/app.ts` `open()` ซึ่งจัดการให้
- ถ้ามี `firebase emulators:start` ค้างอยู่ จะยึดพอร์ต 8080/9099 ต้องปิดก่อนรัน `test:e2e`
- เครื่องที่แพ้ race ได้ `permission-denied` (rules `receipts.size == old+1`) ไม่ใช่ contention retry ข้อความ console นี้เป็นเรื่องปกติ
- e2e ต้องใช้ Java (ตัวเดียวกับ `test:rules`) และ `npx playwright install chromium`
- ใน Claude Code cloud ห้าม `playwright install` ให้สร้าง config ชั่วคราว (ไม่ commit) ที่ใส่ `launchOptions.executablePath: '/opt/pw-browsers/chromium'` แล้วรัน `npx firebase emulators:exec --only firestore,auth --project demo-pzm-e2e "npx playwright test -c <config>"`

## 14. Release hardening + Phase G (6–7 ต.ค.) — branch `claude/phase-a-ledger-continue-uzbbb5` **← งานล่าสุด อ่านก่อน**

**สถานะ:** ทำครบแล้ว **ยังไม่ freeze RC ยังไม่ merge และยังไม่ deploy** ทุกอย่างรอเจ้าของสั่ง

**หลักฐานแต่ละเรื่อง (`docs/evidence/`)**

| เรื่อง | ไฟล์ | สรุป |
|---|---|---|
| Phase G (G1–G10) | `phase-g.md` | engine แนะนำอย่างเดียว · version · data confidence · shadow mode · backtest แบบไม่รั่วข้อมูลอนาคต (ยังเป็น synthetic) |
| Firestore reads | `read-budget.md` | วัดบน emulator ขนาด production: ก่อนแก้ ≈ 201k/วัน → หลังแก้แอป ≈ 17.9k + Worker ≈ 5.9k ≈ **23.8k/วัน** |
| B2 auditLog | `b2-audit-log.md` | append-only · admin อ่านทีละ 50 · ไม่มี listener |
| E4 error reporting | `e4-error-reporting.md` | เขียนลง Workers log **ไม่ใช่ Firestore** · ตัดข้อมูลส่วนตัว/ธุรกิจออก · dedupe / rate limit / sampling |
| D4′ | `d4-intake.md` | Excel / OCR / แนะนำ / กรอกเอง ทั้งหมดผ่านใบขอซื้อ · `/purchase/import` redirect · batch เดิมยังเปิดดูและทำต่อได้ |
| Lot / expiry | `docs/adr/ADR-002-lot-expiry.md` | มีแค่ flag `trackLot` / `trackExpiry` (ค่าเริ่มต้น false) ยังไม่มีอะไรอ่านค่านี้ |
| Release gate | `release-gate.md` | ผลเทสทั้งหมด · flaky runs · business flow · dry-run baseQty |

**Bug จริงที่การรันซ้ำ (flaky runs) และ business flow เจอและแก้แล้ว**

1. **กด "ลองใหม่" แล้วแถบแดงไม่หาย** (live-error พัง 3/20)
   - listener ที่ถูกปฏิเสธ *หลัง* กดลองใหม่ไม่ถูกลองซ้ำ
   - แก้ที่ `DataContext.retryLive` + `LiveFailure.startedAt`
2. **ใบขอซื้อใหม่แสดงว่าง** หลังเพิ่มรายการแรก
   - ErrorBoundary ใช้ path เป็น key ทำให้ทั้งหน้า remount ตอน URL เปลี่ยนจาก `/requests/new` เป็น `/requests/<id>`
   - แก้ด้วย `resetKey` (ล้าง error โดยไม่ remount)

**ขั้นที่เจ้าของต้องทำเอง (เครื่องนี้ทำไม่ได้)**

1. dry-run baseQty บน backup จริง (ห้ามแก้ production):
   `npm run backfill:po-baseqty -- "D:\AI Solution\pzm-stock-<brand>-20261006-1500.json" --json bq.json`
   - รายงาน: valid / safe / ambiguous / invalid / closed / would-change
   - รายการ ambiguous ต้องให้คนตรวจทุกรายการ
2. backtest ของ Phase G บน backup จริง:
   `npm run intel:backtest -- "<backup.json>"`
3. อนุมัติ RC แล้ว deploy ตามลำดับ 0–10 ที่กำหนดไว้

**ห้ามเริ่ม Phase H เอง**

### 14.1 ต่อจากนี้: Agent Safety Foundation G11–G16 (เจ้าของสั่ง 7 ต.ค.) — **หยุดพักกลางงาน G11**

- **ข้อความสั่งงานฉบับเต็มของเจ้าของ:** ข้อความวันที่ 7 ต.ค. ที่กำหนด G11–G16 และ H1–H10
- **สรุปสาระและการออกแบบ:** `docs/agent-safety/00-inspection-and-design.md` (อ่านไฟล์นี้ก่อน) มีครบ 16 ข้อที่เจ้าของขอ:
  - โค้ดที่มีอยู่จริง: **ไม่มี** agent / KatGPT / Reflex / pstack / Rust และไม่มีเส้นทาง Agent → DB
  - สัญญา ActionProposal
  - กฎ Business Guard พร้อม ruleId
  - ขอบเขต Rust crate
  - การออกแบบ dataset และวิธี benchmark
  - ไฟล์ที่จะสร้าง และความเสี่ยง
- **RC ยังไม่ freeze:** gate เขียวที่ `69ed912` (`docs/evidence/release-gate.md`) แต่จะ freeze RC หลัง G16 เพราะ freeze แล้วแก้ได้แค่ bug

**สถานะทีละขั้น (อัปเดต 7 ต.ค. — session ที่สอง)** สรุปหลักฐานรวมอยู่ที่ `docs/evidence/phase-g-agent-safety.md`

| ขั้น | สถานะ |
|---|---|
| G11 | **เสร็จ** (`be36a9d`): เทสสัญญา proposal และเทส no-write-path ที่ไล่ import ต่อกันทั้งสาย |
| G12 | **เสร็จ** (`9c9f29e`): `guard.ts` + `snapshot.ts` + `safety/world.ts` |
| G13 | **เสร็จ** (`9abcee6`): `crates/pzm-integrity` + TS reference + 57 vectors (`npm run integrity:vectors`, `npm run integrity:bench`) |
| G14 | **เสร็จ** (`858d2af`, `c6806c2`): `npm run verify` และ `docs/engineering/pstack-workflow.md` (ยังไม่มี pstack ตัวจริง) |
| G15 / G16 | **เสร็จ** (`894e468`): `npm run safety:dataset` / `npm run safety:bench` — unsafe-allow 0/227 |
| G17 Laya | **ทำ harness แล้ว แต่ยังไม่ได้ประเมิน Laya** (`b8eabb7`): ยังไม่ได้รับ Laya / Kat / Reflex จากเจ้าของ arm B–G = NOT_RUN ดู `docs/evidence/phase-g17-laya.md` |
| G18–G27 | **มีแค่รายงาน audit และแผน** (`933c3f4`): `docs/agent-safety/01-g18-g27-audit-and-plan.md` รออนุมัติชุดแรก |
| Receiving supplier | **เสร็จ** (`7018770`): ระบบเลือกผู้ขายให้เอง ดู `docs/evidence/supplier-resolution.md` |
| Checkpoint | push แล้วที่ `2ae7bbb` (7 ต.ค. ตามเจ้าของสั่งข้อ 1 · ยังไม่ merge main) |
| feat/outbox | **merge เข้า branch นี้แล้ว** (`49ec21f`) แต่ outbox จะเขียนก็ต่อเมื่อตั้ง `OUTBOX_ENABLED=true` (`e3df8db`) |
| Supplier feedback | เก็บกลางใน `auditLog` แล้ว (`0731af0`) โดยไม่สร้าง collection ใหม่และไม่แก้ rules |
| ชุดแรก G18/G19/G21/G25 | **เสร็จ** ดู `docs/evidence/phase-g-batch1.md` ส่วน UI ของ G19 ย้ายมาแค่บางส่วน |
| ⚠ ก่อน deploy | rules ใหม่ของ G25 จะปฏิเสธการแก้ PO/สินค้าที่ไม่ขยับ `version` **ต้อง deploy แอปก่อน rules** (ดู batch1 §Deployment hazard) |
| Upstream | ตรวจแล้วที่ `docs/agent-safety/02-upstream-verification.md` · laya.aay.sh เป็นคนละโปรเจกต์ · ยังไม่ได้ติดตั้งอะไร |
| ปิดเฟส | **ยังไม่ freeze RC** ตามเจ้าของสั่งข้อ 6 รายการที่ยังขาดดูท้าย batch1 |

**Emulator บนเครื่องนี้:** มี Java 21 แล้ว จึงรัน `npm run test:rules` ได้ในเครื่องเลย และ `npm run verify` ก็รันให้ด้วย

**Rust บนเครื่อง Windows นี้:** ลง rustup แล้ว (เจ้าของอนุญาต 7 ต.ค.) และตั้ง GNU toolchain override เฉพาะ `crates/pzm-integrity` เพราะเครื่องนี้ไม่มี MSVC linker ให้รัน `cargo` จากในโฟลเดอร์ crate

**รายละเอียดของงานที่ยังไม่ทำ**

- **G12 guard**
  - เป็น pure function: `guard(proposal, snapshot)` คืน `ALLOW` / `DENY` / `NEEDS_HUMAN` พร้อม `{ruleId, reason, evidence}`
  - `combine()`: model ทำได้แค่ให้ผลเข้มขึ้น
    - guard DENY ต้องเป็น DENY เสมอ
    - ALLOW + model REJECT = DENY
    - ALLOW + ABSTAIN = NEEDS_HUMAN
  - period lock ใช้กติกาเดียวกับ `closedPeriod` ใน `src/services/stock.ts` (plan B1)
  - ส่วนแปลงหน่วยใช้ `resolveFactor` จาก `src/lib/inventoryRules/uom.ts`
  - floor ของต้นทางใช้ตรรกะเดียวกับ `src/intel/transfer.ts` (`SOURCE_KEEP_DAYS = 3`)
- **G13 Rust**
  - เครื่องนี้มี `cargo 1.97` และเข้าถึง crates.io ได้ ยังไม่มี target wasm32
  - ให้ TS สร้าง test vector ใน `crates/pzm-integrity/vectors/` แล้วให้ `cargo test` ได้ผลตรงกัน
  - ยังไม่ใส่ใน request path
  - วัด latency และ memory ของ CLI เทียบกับ TS
- **G14:** ไม่พบ pstack ใน repo หรือ environment นี้ ต้องขอตัวเครื่องมือหรือ source จากเจ้าของ ระหว่างนี้เขียน workflow ไว้และทำ gate ที่เป็นงานกลไกให้อัตโนมัติ
- **G15 / G16**
  - ใช้ generator แบบ seeded ให้ได้ไฟล์ซ้ำ byte ต่อ byte
  - อย่างน้อยหลายร้อย scenario แบ่งเป็น SAFE / UNSAFE / AMBIGUOUS และ attacks.jsonl
  - เทส invariance: ข้อความที่ถูกฉีดเข้ามาต้องไม่เปลี่ยนการตัดสิน
  - benchmark: unsafe-allow rate (ตัวหลัก), false reject, abstain, p50/p95

**กติกา**
- ห้าม AI เขียน DB โดยตรง
- ห้ามเริ่ม H1 ก่อนเจ้าของอนุมัติ
- ห้าม merge / deploy เอง

**วิธีรัน e2e ในเครื่อง cloud:** `PW_CHROMIUM=/opt/pw-browsers/chromium FLAKY_LABEL=x npx firebase emulators:exec --only firestore,auth --project demo-pzm-e2e "npx playwright test -c playwright.flaky.config.ts <spec>"`

## 9. เริ่มงานต่อใน session ใหม่ยังไง

บอก Claude session ใหม่ประมาณนี้:

> อ่านไฟล์ `HANDOFF.md` ในโปรเจกต์ `pizza-stock` ก่อน แล้วอ่าน `SECURITY-NOTES.md` กับ `README.md` ประกอบ โปรเจกต์นี้ deploy อยู่จริงแล้ว (Firebase project `pzm-stock-x5`, repo `yutthachai-hr/PZM-LLP-Stock-2026`) ห้ามลองอะไรกับข้อมูลจริงโดยไม่ถามก่อน ให้ทดสอบผ่าน `npm run demo` เสมอ

สิ่งที่ Claude ใหม่ควรทำเป็นอันดับแรกเมื่อรับงานต่อ:
1. `git log --oneline -20` ดูว่าทำอะไรมาล่าสุด
2. `git status` เช็คว่ามีอะไรค้าง uncommitted
3. **งานล่าสุดคือหัวข้อ 14** (release hardening บน `claude/phase-a-ledger-continue-uzbbb5`) — อ่าน `docs/evidence/release-gate.md` ก่อน
4. ถ้าจะแก้ rules หรือ collection ใหม่ — ถามเจ้าของก่อนเสมอตามกติกาข้อ 7

---

*เอกสารนี้อยู่ใน git จะติดไปกับ repo ทุกที่ที่ clone — อัปเดตทุกครั้งที่มีการเปลี่ยนแปลงสถาปัตยกรรมสำคัญ หรือ deploy รอบใหญ่*
