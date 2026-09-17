# Inventory Pzm — สรุปส่งต่องาน

เอกสารนี้เขียนไว้ให้เปิดงานต่อได้จากศูนย์ ไม่ว่าจะเป็น Claude session ใหม่หรือ account ใหม่ — สรุปทุกอย่างที่ทำไปแล้ว อะไร deploy แล้วบ้าง อะไรค้างอยู่ และกติกาที่ต้องรู้ก่อนแตะโค้ดต่อ

อัปเดตล่าสุด: **14 กันยายน 2569** — ดู `git log` สำหรับ commit ล่าสุด

---

## 1. สถานะตอนนี้ (ยืนยันแล้ว ณ วันที่เขียน)

| อย่าง | สถานะ |
|---|---|
| Git `main` | ตรงกับ `origin/main`; สั่งซื้ออัตโนมัติ merge 15 ก.ย.; **รายการขอสั่งซื้อ (purchase requests) + บทบาท `manager` merge 15 ก.ย.** (branch `feat/purchase-requests`) |
| Firestore rules | **deploy แล้ว 15 ก.ย.** ตรงกับไฟล์ที่ commit (รวม `purchaseRequests`, `manager()`, `requestId` บน purchaseOrders) |
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
- หน่วยที่เลือกจะถูก**บันทึกตามที่กรอกจริง ไม่แปลงค่า** — ยกเว้นกรัม↔กิโล/มล.↔ลิตรที่แปลงได้ตามที่เจ้าของอนุญาต
- ยอดคงเหลือแยกเป็น**คนละแถวต่อหน่วย** (`stockLevels` มี field `unit` เสริม) เพื่อไม่ให้ "10 Pack" กับ "2 KG" ถูกบวกปนกันโดยไม่มีใครสั่ง
- แก้ไขรายการย้อนหลังได้ครบ: จำนวน/วันที่/หมายเหตุ/**หน่วย**/**คลังต้นทาง-ปลายทาง** — ย้ายยอดข้ามคลัง/หน่วยได้โดยไม่ต้องยกเลิกแล้วคีย์ใหม่
- **ประวัติการแก้ไขทุกครั้งเก็บสะสม** (`edits[]` บน movement) ไม่ใช่แค่ "แก้ล่าสุดโดยใคร" — กันการสวมชื่อ, rules บังคับว่าต้องต่อประวัติพอดี 1 รายการและเซ็นชื่อผู้เรียกเองเท่านั้น
- แก้หน่วยของ**ตัวสินค้าเอง**ได้ (ไม่ใช่แค่รายการ) พร้อม restamp ประวัติเก่าทั้งหมดให้ตรง — มี cap 1,000 รายการต่อครั้งกันงานหนักเกิน
- ซ่อนสินค้าได้ (ไอคอนตา 👁/🙈) แทนการลบ — ยอด/ประวัติอยู่ครบ กู้คืนได้
- ผู้ขายก็ซ่อนได้แบบเดียวกัน (`active: false`) — หายจาก dropdown หน้าสั่งซื้อและหน้าแก้ไขสินค้า, หาเจอที่ตัวกรอง "ที่ซ่อนไว้" ในหน้าผู้ขาย (ตัวกรอง: สถานะ / รับคืนของ / เรียงตาม พับหลังปุ่มเหมือนหน้าสินค้า)
- **อัตราแปลงหน่วยอ้างอิง** (`Product.unitConversions`, `src/lib/units.ts`'s `normaliseConversions`) — แก้ปัญหาสินค้าที่สั่งซื้อ/เบิก/รับเข้าคนละหน่วยกัน (เช่น สั่งเป็นลัง เบิกเป็นแพ็ค รับเข้าเป็นชิ้น) ตั้งในหน้าแก้ไขสินค้าว่า "1 ลัง = 288 EA" แล้วช่องกรอกจำนวนทุกจุด (รับเข้า/เบิก/ปรับ/สั่งซื้อ) จะโชว์ตัวช่วยคูณ "≈ 576 EA (อ้างอิง)" ใต้ช่อง — **ไม่บันทึกแปลงอัตโนมัติเด็ดขาด** ตามกติกาเดิม ตัวเลขที่กรอกคือตัวเลขที่บันทึกเสมอ หน่วยที่มีอัตราแปลงจะกลายเป็นตัวเลือกในช่องหน่วยด้วยแม้ไม่ได้อยู่ในลิสต์ Lot/Pack/EA ของตั้งค่า (เพราะขนาดลังไม่เท่ากันทุกสินค้า ไม่ควรเป็นลิสต์ส่วนกลาง)

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

## 5. ตัวเลขทดสอบ (unit + rules tests, รันผ่านหมดทุกครั้งก่อน commit)

```
npm test              # 443 unit tests
npm run test:rules    # 133 rules tests (ต้องมี Java สำหรับ emulator)
npm run build          # tsc -b + typecheck functions/ (Cloudflare) + vite build
npm run lint            # 0 errors
npm run i18n:check      # ครบทุกข้อความ
```

---

## 6. ค้างอยู่ / ต้องตัดสินใจต่อ

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
- **ห้ามแปลงหน่วยเอง** — ระบบต้องบันทึกตามหน่วยที่คนกรอกจริงเท่านั้น (ยกเว้นกรัม/กิโล, มล./ลิตร ที่อนุญาตไว้แล้ว)
- **ห้ามลบ ให้ซ่อนแทน** — ใช้กับทั้งสินค้าและใบสั่งซื้อที่รับของแล้ว
- **ทุกการแก้ไขย้อนหลังต้องมีชื่อคนแก้ครบ ป้องกันการทุจริต** — ทั้ง movement และ purchase order
- **rules deploy ต้องทำก่อน push โค้ดที่แตะ field/collection ใหม่เสมอ** ไม่งั้น production จะปฏิเสธ write เงียบ ๆ
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

## 9. เริ่มงานต่อใน session ใหม่ยังไง

บอก Claude session ใหม่ประมาณนี้:

> อ่านไฟล์ `HANDOFF.md` ในโปรเจกต์ `pizza-stock` ก่อน แล้วอ่าน `SECURITY-NOTES.md` กับ `README.md` ประกอบ โปรเจกต์นี้ deploy อยู่จริงแล้ว (Firebase project `pzm-stock-x5`, repo `yutthachai-hr/PZM-LLP-Stock-2026`) ห้ามลองอะไรกับข้อมูลจริงโดยไม่ถามก่อน ให้ทดสอบผ่าน `npm run demo` เสมอ

สิ่งที่ Claude ใหม่ควรทำเป็นอันดับแรกเมื่อรับงานต่อ:
1. `git log --oneline -20` ดูว่าทำอะไรมาล่าสุด
2. `git status` เช็คว่ามีอะไรค้าง uncommitted
3. เช็คหัวข้อ **"6. ค้างอยู่"** ด้านบนว่ามีอะไรรอการตัดสินใจ (ข้อ -1 คือขั้นที่เจ้าของต้องทำเองให้รายการขอสั่งซื้อใช้จริงได้: ตั้งบทบาทหัวหน้า)
4. ถ้าจะแก้ rules หรือ collection ใหม่ — ถามเจ้าของก่อนเสมอตามกติกาข้อ 7

---

*เอกสารนี้อยู่ใน git จะติดไปกับ repo ทุกที่ที่ clone — อัปเดตทุกครั้งที่มีการเปลี่ยนแปลงสถาปัตยกรรมสำคัญ หรือ deploy รอบใหญ่*
