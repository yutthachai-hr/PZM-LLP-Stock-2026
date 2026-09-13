# Inventory Pzm — สรุปส่งต่องาน

เอกสารนี้เขียนไว้ให้เปิดงานต่อได้จากศูนย์ ไม่ว่าจะเป็น Claude session ใหม่หรือ account ใหม่ — สรุปทุกอย่างที่ทำไปแล้ว อะไร deploy แล้วบ้าง อะไรค้างอยู่ และกติกาที่ต้องรู้ก่อนแตะโค้ดต่อ

อัปเดตล่าสุด: **13 กันยายน 2569** ที่ commit `5cbe0be`

---

## 1. สถานะตอนนี้ (ยืนยันแล้ว ณ วันที่เขียน)

| อย่าง | สถานะ |
|---|---|
| Git `main` | ตรงกับ `origin/main` ทุกตัว (`5cbe0be`), working tree สะอาด |
| Firestore rules | **deploy แล้ว ตรงกับไฟล์ที่ commit** (ยืนยันด้วย dry-run: "already up to date") |
| Netlify | build จาก repo อัตโนมัติทุกครั้งที่ push เข้า `main` |
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

ข้อจำกัดที่คุมทุกการตัดสินใจด้านสถาปัตยกรรม: **Firebase Spark ให้ 50,000 document reads/วัน และ 20,000 writes/วัน สำหรับทั้งสองแบรนด์รวมกัน** ทุกฟีเจอร์ที่เพิ่มเข้ามาถูกออกแบบให้กิน quota น้อยที่สุด — อ่านครั้งเดียวต่อ session ไม่ subscribe แบบ realtime ถ้าไม่จำเป็นจริง ๆ, ใช้ field แทนการเพิ่ม collection ใหม่เมื่อทำได้

---

## 3. โครงสร้างที่ต้องเข้าใจก่อนแตะโค้ด

- **Multi-tenancy แบบ prefix ชื่อ collection**: `products` = Pizza Mania, `lelapin__products` = Le Lapin ฟังก์ชัน `resolveCollection()` ใน `src/brand/brand.ts` จัดการเรื่องนี้ — ห้ามเขียน query ตรงไปที่ชื่อ collection โดยไม่ผ่านตัวนี้
- **Backend abstraction** (`src/backend/types.ts`): มี 2 implementation จริง (`firestore.ts`, `local.ts` สำหรับ demo) และ 1 test double (`tests/helpers/memory-backend.ts`) — เทสต์ทุกตัวรันผ่าน backend ปลอม ไม่แตะ Firestore จริง
- **`DataContext`** เปิด subscription แบบ realtime อยู่ **7 ตัวเท่านั้น** (products, locations, stockLevels, movements-90วันล่าสุด, notes, minOverrides, users) — อะไรที่ไม่ใช่ 7 ตัวนี้ต้องอ่านแบบ one-shot (`getAll`/`getRange`/`getBy`) แล้ว cache เอง
- **firestore.rules**: ไฟล์เดียว, catch-all `match /{collection}/{docId}` กับ allow-list `staffWritable()`/`adminWritable()` ที่ต้องลงทั้งสองชื่อแบรนด์เสมอ ทุก collection มี validator ของตัวเองที่ใช้ `hasOnly()` ปิดรูป
- **`clearLocalCaches()`** ตอน logout ล้าง IndexedDB ทั้งหมด — แท็บเล็ตที่ตั้ง auto-logout 20 นาที แปลว่าแทบทุก session คือ cold start ใหม่
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

### ปฏิทินคลัง (`src/pages/Calendar.tsx`)
- อ่านทีละเดือน ไม่ subscribe (`stockEvents` collection)
- ประเภท **สั่งประจำสัปดาห์** — ใช้แถบสถานะ "สั่งแล้ว/รับของแล้ว" แทนช่องกำหนดเสร็จ

### ผู้ขาย (`src/pages/Suppliers.tsx`, `src/lib/supplierName.ts`, `src/services/supplierImport.ts`)
- อ่านชื่อผู้ขายจากวงเล็บในชื่อสินค้าอัตโนมัติ (454 ชื่อ → **103 ผู้ขาย** หลังกรองขนาดบรรจุ/รวมสะกดผิด)
- หน้า "นำเข้าจากชื่อสินค้า" ให้ตรวจรับก่อนเขียนจริง ไม่ auto-apply
- เปลี่ยนชื่อผู้ขาย → เขียนทับวงเล็บในชื่อสินค้าทุกตัวที่ผูกกับเจ้านั้นอัตโนมัติ
- ลิงก์ผู้ขาย↔สินค้าเก็บเป็น field `supplierId` บนตัวสินค้า (ไม่ใช้ `supplierItems` เพราะจะกิน read เยอะกว่ามาก)

### ระบบสั่งซื้อ (`src/pages/Orders.tsx`, `src/services/purchaseOrders.ts`) — collection ที่ 4: `purchaseOrders`
- เลือกผู้ขาย → สินค้าของเจ้านั้นเด้งมาให้ทั้งหมดอัตโนมัติ
- ตรวจรับของแบบเช็กลิสต์: ติ๊กถูก หรือแก้จำนวน+**ต้องใส่เหตุผล** ถ้าไม่ตรง, **ต้องมีเลขบิล**ก่อนเข้าคลังเสมอ
- ยืนยันรับแล้ว → เขียน stock receipt จริงทันที (เส้นทางเดียวกับรับเข้าด้วยมือ)
- Dashboard: แท็บรอรับของ/รับของแล้ว/สรุปตามผู้ขาย, เตือนสีแดงถ้าเกิน 3 วันยังไม่ได้ของ
- ใบสั่งซื้อพิมพ์ A5 ได้ หรือแคปหน้าจอส่งไลน์
- ใบที่ "รับของแล้ว" **ลบไม่ได้แม้แต่ Admin** (เป็นหลักฐานของ stock receipt ที่ลบไม่ได้เหมือนกัน)

---

## 5. ตัวเลขทดสอบ (unit + rules tests, รันผ่านหมดทุกครั้งก่อน commit)

```
npm test              # 302 unit tests
npm run test:rules    # 117 rules tests (ต้องมี Java สำหรับ emulator)
npx tsc -b             # typecheck
npm run lint            # 0 errors
node scripts/i18n-check.mjs   # ครบทุกข้อความ
```

---

## 6. ค้างอยู่ / ต้องตัดสินใจต่อ

1. **3 รายการที่วงเล็บไม่ใช่ผู้ขายจริง** (ยังไม่ได้ยืนยันจากเจ้าของ):
   - `WOOD (On-nut)`, `WOOD (Sarasin)` — น่าจะเป็นชื่อสาขา ไม่ใช่ผู้ขาย
   - `BARLAY MALT (SHOPEE)` — ซื้อผ่าน Shopee น่าจะถูกแล้ว ไม่ต้องแก้
2. **6 สินค้าที่ชื่อไม่มีวงเล็บเลย** — เจ้าของบอกจะใส่ผู้ขายเองทีหลังที่หน้าแก้ไขสินค้า (ช่องมีให้แล้ว)
3. ฟีเจอร์ระบบสั่งซื้อที่ยังไม่ทำ (ไม่ได้อยู่ใน scope ล่าสุดที่ขอ แต่เผื่อถามต่อ): ไม่มีการแจ้งเตือนแบบ push/LINE เมื่อเกิน 3 วัน (แค่ badge สีแดงในแอป), ไม่มี recurring auto-create ใบสั่งซื้อรายสัปดาห์อัตโนมัติ (ต้องกดสร้างเองทุกครั้ง)

---

## 7. กติกาที่เจ้าของวางไว้ — ต้องรู้ก่อนทำงานต่อ

- **Firebase Spark ฟรี, ห้ามเพิ่ม cost โดยไม่จำเป็น** — งดใช้ `onSnapshot` ถ้า one-shot read พอ, งดเพิ่ม collection ใหม่โดยไม่ถามก่อน (ตอนนี้มี 4 ตัวที่ตกลงแล้ว: `stockEvents`, `suppliers`, `supplierItems`, `purchaseOrders`)
- **ห้ามแปลงหน่วยเอง** — ระบบต้องบันทึกตามหน่วยที่คนกรอกจริงเท่านั้น (ยกเว้นกรัม/กิโล, มล./ลิตร ที่อนุญาตไว้แล้ว)
- **ห้ามลบ ให้ซ่อนแทน** — ใช้กับทั้งสินค้าและใบสั่งซื้อที่รับของแล้ว
- **ทุกการแก้ไขย้อนหลังต้องมีชื่อคนแก้ครบ ป้องกันการทุจริต** — ทั้ง movement และ purchase order
- **rules deploy ต้องทำก่อน push โค้ดที่แตะ field/collection ใหม่เสมอ** ไม่งั้น production จะปฏิเสธ write เงียบ ๆ
- ก่อนตัดสินใจอะไรที่มีผลกว้าง (เพิ่ม collection, เปลี่ยนนโยบายเก่า, ลบข้อมูล) **ต้องถามเจ้าของก่อนเสมอ ห้ามเดา**

---

## 8. เริ่มงานต่อใน session ใหม่ยังไง

บอก Claude session ใหม่ประมาณนี้:

> อ่านไฟล์ `HANDOFF.md` ในโปรเจกต์ `pizza-stock` ก่อน แล้วอ่าน `SECURITY-NOTES.md` กับ `README.md` ประกอบ โปรเจกต์นี้ deploy อยู่จริงแล้ว (Firebase project `pzm-stock-x5`, repo `yutthachai-hr/PZM-LLP-Stock-2026`) ห้ามลองอะไรกับข้อมูลจริงโดยไม่ถามก่อน ให้ทดสอบผ่าน `npm run demo` เสมอ

สิ่งที่ Claude ใหม่ควรทำเป็นอันดับแรกเมื่อรับงานต่อ:
1. `git log --oneline -20` ดูว่าทำอะไรมาล่าสุด
2. `git status` เช็คว่ามีอะไรค้าง uncommitted
3. เช็คหัวข้อ **"6. ค้างอยู่"** ด้านบนว่ามีอะไรรอการตัดสินใจ
4. ถ้าจะแก้ rules หรือ collection ใหม่ — ถามเจ้าของก่อนเสมอตามกติกาข้อ 7

---

*เอกสารนี้อยู่ใน git จะติดไปกับ repo ทุกที่ที่ clone — อัปเดตทุกครั้งที่มีการเปลี่ยนแปลงสถาปัตยกรรมสำคัญ หรือ deploy รอบใหญ่*
