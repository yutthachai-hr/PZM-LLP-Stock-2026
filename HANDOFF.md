# Inventory Pzm — สรุปส่งต่องาน

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

## 5. ตัวเลขทดสอบ (unit + rules tests, รันผ่านหมดทุกครั้งก่อน commit)

```
npm test              # 679 unit tests
npm run test:rules    # 166 rules tests (ต้องมี Java สำหรับ emulator) — รวม firestore-rules-budget.test.ts ที่ replay เอกสารกว้างสุด
npm run build          # tsc -b + typecheck functions/ (Cloudflare) + vite build
npm run lint            # 0 errors
npm run i18n:check      # ครบทุกข้อความ
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

## 9. เริ่มงานต่อใน session ใหม่ยังไง

บอก Claude session ใหม่ประมาณนี้:

> อ่านไฟล์ `HANDOFF.md` ในโปรเจกต์ `pizza-stock` ก่อน แล้วอ่าน `SECURITY-NOTES.md` กับ `README.md` ประกอบ โปรเจกต์นี้ deploy อยู่จริงแล้ว (Firebase project `pzm-stock-x5`, repo `yutthachai-hr/PZM-LLP-Stock-2026`) ห้ามลองอะไรกับข้อมูลจริงโดยไม่ถามก่อน ให้ทดสอบผ่าน `npm run demo` เสมอ

สิ่งที่ Claude ใหม่ควรทำเป็นอันดับแรกเมื่อรับงานต่อ:
1. `git log --oneline -20` ดูว่าทำอะไรมาล่าสุด
2. `git status` เช็คว่ามีอะไรค้าง uncommitted
3. เช็คหัวข้อ **"6. ค้างอยู่"** และ **"10. ปฏิทินคลัง"** (Phase A–B เสร็จแล้ว ต่อ Phase C) — branch งานคือ `feat/inventory-calendar`
4. ถ้าจะแก้ rules หรือ collection ใหม่ — ถามเจ้าของก่อนเสมอตามกติกาข้อ 7

---

*เอกสารนี้อยู่ใน git จะติดไปกับ repo ทุกที่ที่ clone — อัปเดตทุกครั้งที่มีการเปลี่ยนแปลงสถาปัตยกรรมสำคัญ หรือ deploy รอบใหญ่*
