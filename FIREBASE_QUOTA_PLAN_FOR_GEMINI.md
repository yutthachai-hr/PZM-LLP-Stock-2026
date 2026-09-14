# Firebase Quota & Usage Plan for Gemini / AI Engineers
## Project: `pzm-stock-x5` (Pizza Mania & Le Lapin Stock System)

> **Core Constraint**: ระบบนี้รันบน **Firebase Spark Plan (Free Tier 100% ต้นทุน 0 บาท)**  
> โควตานี้ถูกแชร์ระหว่าง 2 แบรนด์ (Pizza Mania + Le Lapin) ใน Firebase Project เดียวกัน (`pzm-stock-x5`)  
> ทุกการตัดสินใจด้านสถาปัตยกรรมและโค้ด **ต้องคำนึงถึงขีดจำกัดโควตาฟรีเสมอ**

---

## 1. ขีดจำกัดโควตาจริงของ Firebase Spark (Daily Hard Limits)

| ทรัพยากร (Resource) | โควตาฟรีต่อวัน (Spark Plan) | สถานะความเสี่ยงในระบบนี้ | สาเหตุ & จุดเฝ้าระวัง |
|---|---|---|---|
| **Firestore Document Reads** | **50,000 reads / วัน** | 🔴 **ความเสี่ยงสูงสุด (Critical)** | โหลดแคตตาล็อก, สต๊อกคงเหลือ, Ledger ย้อนหลัง และ Realtime Listeners |
| **Firestore Document Writes** | **20,000 writes / วัน** | 🟢 **ความเสี่ยงต่ำมาก (Safe)** | บันทึกรับเข้า/เบิก/ปรับวันละ ~50-200 รายการ (~200-800 writes/วัน < 5%) |
| **Firestore Document Deletes** | **20,000 deletes / วัน** | 🟢 **ความเสี่ยงต่ำมาก (Safe)** | ระบบใช้นโยบาย "ซ่อนแทนลบ" (soft delete / `active: false`) |
| **Firestore Stored Data** | **1 GiB รวม** | 🟢 **ความเสี่ยงต่ำ (Safe)** | ข้อมูลตัวหนังสือ ~10-30 MB, รูปสินค้าบีบอัดเก็บแยกใน `productImages` |
| **Network Egress** | **10 GiB / เดือน** (~330 MB/วัน) | 🟢 **ความเสี่ยงต่ำ (Safe)** | เพย์โหลด JSON ขนาดเล็ก รูปภาพมี in-memory cache |
| **Firebase Authentication** | **50,000 MAU** | 🟢 **ความเสี่ยงต่ำมาก (Safe)** | ผู้ใช้ทั้งสองแบรนด์รวมกันมีพนักงานหลักสิบคน |
| **Firebase Hosting** | **10 GB Storage / 360 MB/วัน** | 🟢 **ความเสี่ยงต่ำ (Safe)** | เว็บเป็น PWA สร้างด้วย Vite แคชบนเบราว์เซอร์ผ่าน Service Worker |

---

## 2. วิเคราะห์ Usage Dashboard ของ `pzm-stock-x5` — ใช้อะไรไปบ้าง

### 2.1 โครงสร้าง Collections ใน Firestore (`pzm-stock-x5`)
ระบบใช้ Multi-tenant แบบ Collection Prefix:
- Pizza Mania: `products`, `stockLevels`, `stockMovements`, `locations`, ฯลฯ
- Le Lapin: `lelapin__products`, `lelapin__stockLevels`, `lelapin__stockMovements`, ฯลฯ

| Collection Name | ปริมาณเอกสารโดยประมาณ | รูปแบบการอ่าน (Read Pattern) | Reads ที่ใช้ต่อวัน |
|---|---|---|---|
| `products` / `lelapin__products` | 150 - 450 docs/แบรนด์ | `useLive` (Snapshot listener) ใน `DataContext` | ~300 - 600 reads (เมื่อเปิดแอป) + deltas |
| `locations` / `lelapin__locations` | 3 - 6 docs/แบรนด์ | `useLive` ใน `DataContext` | ~6 - 12 reads |
| `stockLevels` / `lelapin__stockLevels` | 300 - 800 docs/แบรนด์ | `useLive` ใน `DataContext` (แยกตามหน่วย `#unit`) | ~600 - 1,600 reads |
| `stockMovements` (Ledger) | หลายพัน docs (เติบโตต่อเนื่อง) | `useLive` บาวน์ดไว้ที่ **30 วันล่าสุด** (`RECENT_DAYS = 30`) | ~1,000 - 3,000 reads |
| `notes` / `lelapin__notes` | 10 - 20 docs | `useLive` ใน `DataContext` | ~20 - 40 reads |
| `productMinOverrides` | 10 - 50 docs | `useLive` ใน `DataContext` | ~20 - 100 reads |
| `users` | 5 - 20 docs | `useLive` เฉพาะเมื่อเป็น **Admin** (`enabled: isAdmin`) | ~10 - 40 reads |
| `suppliers` & `supplierItems` | ~100 suppliers | **One-shot read** แคชไว้ระดับ Session ไม่ใช้ realtime | 100 - 200 reads/วัน |
| `stockEvents` (ปฏิทิน) | ~20 - 50 docs/เดือน | **One-shot read** ตามช่วงเดือนที่เปิดดูในปฏิทิน | ~50 - 100 reads/วัน |
| `purchaseOrders` (ใบสั่งซื้อ) | ~50 - 200 docs | **One-shot read** กรองตามสถานะ/ช่วงเวลา | ~50 - 200 reads/วัน |
| `counters` | 1 - 10 docs | อ่านและเขียนใน Transaction เมื่อออกเลขบิล/PO | ~20 - 50 reads/วัน |

---

## 3. บทเรียนวิกฤต Quota Exceeded (14 กันยายน) & สิ่งที่ได้รับการแก้ไข

### วิกฤตที่เกิดขึ้น:
ในช่วงเช้าของวันที่ 14 กันยายน โควตา Document Reads (50,000 reads/วัน) ถูกใช้หมดเกลี้ยงก่อนเที่ยง ส่งผลให้ระบบขึ้น error `"Quota exceeded"` และไม่สามารถสั่งซื้อหรือบันทึกสต๊อกได้

### สาเหตุหลัก 3 ประการ:
1. **Idle Auto-Logout (20 นาที) + `clearLocalCaches()`**:  
   เดิมระบบมี Timer ตรวจจับความเงียบ 20 นาที เมื่อครบเวลาจะทำการ Logout และสั่งล้างแคช IndexedDB (`clearLocalCaches()`)  
   สาขาใช้แท็บเล็ตวางไว้บนเคาน์เตอร์ เมื่อไม่มีการแตะจอ 20 นาที แท็บเล็ตถูกเตะออก พอพนักงานเดินมาใช้งานใหม่ต้องล็อกอินใหม่ กลายเป็น **Cold Start ใหม่ทั้งหมด**  
   - การเปิด Cold Start 1 ครั้ง = อ่านสินค้า (400) + สต๊อก (800) + Ledger 90 วัน (3,000+) = ~4,200 reads ต่อเครื่อง  
   - มีแท็บเล็ต 3-4 สาขา โดนเตะออกชั่วโมงละ 2-3 ครั้ง → $4,200 \times 4 \text{ เครื่อง} \times 3 \text{ ครั้ง/ชม.} = 50,400 \text{ reads/ชม.}!$ โควตาวันละ 50,000 จึงหมดในเวลาไม่กี่ชั่วโมง!
2. **Ledger Query 90 วัน (`RECENT_DAYS = 90`)**:  
   อ่านย้อนหลัง 3 เดือนทุกครั้งที่มี cold start ทั้งที่การทำงานประจำวันดูเพียง 30 วัน
3. **การขาด Session Cache ในข้อมูลที่ไม่จำเป็นต้อง realtime**:  
   เช่น Suppliers และ Entry Units ที่เคยถูก fetch ซ้ำในหลายหน้า

### การแก้ไขและสถานะปัจจุบัน:
1. **ยกเลิกการเตะออกอัตโนมัติ 20 นาทีอย่างสมบูรณ์ (`useIdleLogout` ถูกถอดออก)**:
   - อุปกรณ์และแท็บเล็ตของสาขาจะคงสถานะ Login ตลอดเวลา ไม่มีการเตะออกเมื่อไม่ใช้งาน
   - พนักงานสามารถหยิบแท็บเล็ตมานับสต๊อกหรือคีย์งานได้ทันทีโดยไม่หลุด
   - ลด Cold Start ในแต่ละวันลงมากกว่า 95% เหลือเพียงการเปิดเครื่องตอนเช้า
2. **คงสภาพ IndexedDB Cache ไว้เสมอ**:
   - `clearLocalCaches()` จะถูกเรียกเฉพาะเมื่อกดปุ่ม "ออกจากระบบ" ด้วยตนเองโดยตั้งใจเท่านั้น
   - Firestore SDK ใช้แคชในเครื่องในการเช็ค snapshot ทำให้การเปิดแอปใหม่ใช้ reads เพียงเศษเสี้ยว (delta reads เท่านั้น)
3. **จำกัดช่วงเวลา Ledger ตอนเปิดระบบเหลือ 30 วัน (`RECENT_DAYS = 30`)**:
   - ลดปริมาณการอ่านประวัติย้อนหลังจาก ~3,000+ รายการ เหลือเพียง ~500-1,000 รายการ
   - หากต้องการดูประวัติเก่ากว่านั้น ผู้ใช้สามารถกดปุ่มขยายช่วงเวลาได้ในหน้ารายงาน/Ledger

---

## 4. กติกาเหล็กสำหรับ AI (Gemini / Claude) และวิศวกรซอฟต์แวร์

เมื่อเข้ามาพัฒนา ปรับปรุง หรือเพิ่มฟีเจอร์ในโค้ดเบสนี้ **ต้องปฏิบัติตามกฎ 7 ข้อนี้อย่างเคร่งครัด**:

### กฎข้อที่ 1: จำกัด Realtime Listener ไว้ที่ 7 ตัวใน `DataContext` เท่านั้น
ห้ามเพิ่ม `onSnapshot` หรือ `useLive` ในคอมโพเนนต์หรือหน้าจอใหม่โดยพลการ  
ข้อมูลใดที่ไม่ได้ต้องการการเปลี่ยนแปลงแบบวินาทีต่อวินาที (เช่น `suppliers`, `purchaseOrders`, `events`, `entryUnits`) **ต้องใช้ One-shot read (`getAll`, `getRange`, `getBy`) ร่วมกับ Session Cache**

### กฎข้อที่ 2: ต้อง Bounded Query ทุกครั้งสำหรับ Collection ที่โตตามเวลา
ห้ามเขียน `collection('stockMovements')` แบบไม่มีเงื่อนไข `where('date', '>=', limit)`  
ทุก collection ประเภท append-only ต้องมี limit เสมอเพื่อป้องกันไม่ให้ query กินโควตาทั้งวันในอนาคต

### กฎข้อที่ 3: ห้ามแปลงหน่วยนับโดยพลการ (Strict Entry Unit Rule)
ระบบเก็บข้อมูลยอดคงเหลือแยกตามหน่วยที่ผู้ใช้กรอก (`#Pack`, `#Lot`, `#EA`) เพื่อความโปร่งใสและถูกต้องตามหน้าบิลจริง ยอดสต๊อกใน `stockLevels` แยกแถวตามหน่วย ไม่มีการ convert ย้อนหลัง

### กฎข้อที่ 4: อย่าใช้ Document แยกย่อยเกินจำเป็น
- ตัวอย่างที่ดี: ข้อมูล supplier ผูกกับสินค้าผ่าน field `supplierId` บนเอกสาร `Product` โดยตรง แทนที่จะต้อง query คอลเลกชัน `supplierItems` ขนาดใหญ่ทุกครั้งที่เปิดหน้าสั่งซื้อ
- หลีกเลี่ยงการสร้าง collection ที่เก็บ 1 doc ต่อ 1 การตั้งค่าเล็ก ๆ ให้ยุบรวมใน `meta` หรือเก็บในตัว entity เอง

### กฎข้อที่ 5: แยกรูปภาพขนาดใหญ่ออกจาก Document หลัก
เอกสาร `Product` เก็บเฉพาะ metadata พื้นฐาน ส่วนรูปภาพ Base64 เก็บแยกใน `productImages` เพื่อไม่ให้การ fetch แคตตาล็อกสินค้าต้องดึงข้อมูลรูปภาพหลายเมกะไบต์โดยไม่จำเป็น

### กฎข้อที่ 6: ห้ามลบข้อมูลจริง ให้ใช้การซ่อน (Soft Delete)
ใช้ `active: false` สำหรับสินค้า, สาขา, ผู้ขาย เพื่อรักษา Audit Trail และ Foreign Key Consistency ในประวัติ Ledger ย้อนหลัง

### กฎข้อที่ 7: อุปกรณ์สาขาต้องคง Session ไว้ตลอดเวลา (No Auto Kick-out)
ห้ามใส่ Idle Timeout หรือ auto-logout ที่เตะผู้ใช้ออกโดยอัตโนมัติ เพราะจะทำลาย UX ในครัว/หน้าร้าน และสร้างความเสี่ยงต่อการเกิด Cold Start Read Spike บน Firestore

---

## 5. สรุปงบประมาณการอ่านเขียนประจำวัน (Daily Quota Budget Allocation)

```
[Spark Plan Daily Read Budget: 50,000 Reads]
│
├── 🟢 Morning Cold Starts (3-4 แท็บเล็ตสาขา + มือถือ 2-3 เครื่อง):
│   └── 6 อุปกรณ์ × ~1,200 reads (แคตตาล็อก + สต๊อก + Ledger 30 วัน) = ~7,200 reads
│
├── 🟢 Realtime Deltas ระหว่างวัน (รับของ, เบิก, ปรับสต๊อก ~100 ครั้ง):
│   └── 100 movements × 6 อุปกรณ์ = ~600 reads
│
├── 🟢 On-Demand Operations (ดูปฏิทิน, เปิดหน้าสั่งซื้อ, ออกรายงาน PDF/Excel):
│   └── ~1,500 reads
│
└── 🟡 Buffer ปลอดภัย (Safety Margin):
    └── ~40,700 reads (เหลือมากกว่า 80% ปลอดภัยจาก Quota Exceeded 100%)
```

แผนนี้ยืนยันว่าการนำ auto-logout 20 นาทีออก และตรึง Session ไว้ตลอดเวลา ร่วมกับการบาวน์ด Ledger 30 วัน ทำให้ระบบสามารถทำงานได้อย่างราบรื่นโดยไม่เกินขีดจำกัดฟรีของ Firebase Spark อย่างแน่นอน
