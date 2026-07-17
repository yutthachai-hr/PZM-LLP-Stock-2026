# 🍕 Pizza Mania — ระบบบริหารสต๊อก (Stock Management System)

ระบบบริหารสต๊อกสำหรับร้านพิซซ่า ใช้งานได้จริงระดับธุรกิจ ทำงานบน **PC และมือถือ**
รองรับ **หลายคลัง/หลายสาขา** อัปเดต **เรียลไทม์** และ **ต้นทุน 0 บาท**

---

## ✨ ความสามารถ

| # | ระบบ | รายละเอียด |
|---|------|-----------|
| 1 | สินค้าคงคลัง | เพิ่ม/ลบ/แก้สินค้าอิสระ, แก้หน่วยได้, ตั้ง Min Stock, **อัปโหลดรูปจากมือถือ/คอม/กล้อง**, แจ้งเตือนของเหลือน้อย |
| 2 | รับสินค้าเข้า | เพิ่มสต๊อกอัตโนมัติ, บันทึกชื่อผู้คีย์อัตโนมัติ, วันที่, แก้ไขรายการได้ |
| 3 | เบิก/โอนไปสาขา | คลังหลัก → สารสิน/อ่อนนุช, ตัดสต๊อกอัตโนมัติ, Dashboard รายสาขา |
| 4 | Dashboard | รวม + แยกสาขา, ค้นหา, แจ้งเตือนของเหลือน้อยบนหน้าจอ, ตั้ง Minimum เอง |
| 5 | เก็บบน Cloud | ใช้ได้ทุกเครื่องแบบเรียลไทม์, ทำงาน offline ได้ (PWA) |
| 6 | รายงาน | ดึงตามสาขา/วันที่/สินค้า → ดาวน์โหลด **Excel / PDF** (ภาษาไทย) |
| 7 | อื่นๆ | Notepad, Stock Card, ปรับสต๊อก, ผู้ใช้หลายระดับ (Admin/พนักงาน) |

**หลักการสำคัญ:** ทุกการเคลื่อนไหวถูกบันทึกเป็น Transaction ในบัญชีแยกประเภท (ledger)
ยอดคงเหลือคำนวณจาก transaction เสมอ — **ไม่มีการแก้ยอดด้วยมือ ตรวจย้อนหลังได้ 100%**

---

## 🚀 การติดตั้งและรัน

ต้องมี **Node.js 20+** ติดตั้งก่อน (ดาวน์โหลดจาก https://nodejs.org)

```bash
cd pizza-stock
npm install
npm run dev        # เปิด http://localhost:5173
```

Build สำหรับใช้งานจริง:
```bash
npm run build      # ได้ไฟล์ในโฟลเดอร์ dist/
npm run preview    # ทดลองเปิดไฟล์ที่ build แล้ว
```

### เข้าใช้งานครั้งแรก
เปิดเว็บ → หน้าจอจะให้ **สร้างบัญชีผู้ดูแลระบบคนแรก** (ชื่อ + อีเมล + รหัสผ่าน)
จากนั้นไปที่ **สินค้าคงคลัง → นำเข้าสินค้าตัวอย่าง (Pizza Mania)** เพื่อโหลดสินค้า ~150 รายการ

---

## ☁️ โหมดข้อมูล (สำคัญ)

ระบบทำงานได้ 2 โหมด:

### 1) โหมดในเครื่อง (ค่าเริ่มต้น — ไม่ต้องตั้งค่าอะไร)
ข้อมูลเก็บในเบราว์เซอร์เครื่องนั้น เรียลไทม์ระหว่างแท็บ/หน้าต่างของเครื่องเดียวกัน
เหมาะกับการทดลองใช้ทันที

### 2) โหมด Cloud (ฟรี — ใช้หลายเครื่องเรียลไทม์)
เก็บบน **Firebase (Google)** ซิงก์ทุกเครื่อง (PC + มือถือ) แบบเรียลไทม์
**ฟรี 100% ไม่ต้องผูกบัตรเครดิต** (Spark plan)

#### วิธีเปิดใช้ Cloud (ทำครั้งเดียว ~5 นาที)
1. ไปที่ https://console.firebase.google.com → **Add project** (ตั้งชื่อ เช่น `pizza-mania-stock`)
   - ปิด Google Analytics ได้ (ไม่จำเป็น) → Create project
2. เมนูซ้าย **Build → Authentication** → Get started → เปิด **Email/Password** → Save
3. เมนูซ้าย **Build → Firestore Database** → Create database → เลือก **production mode** →
   เลือก location `asia-southeast1` (สิงคโปร์ ใกล้ไทยสุด) → Enable
4. แท็บ **Rules** ของ Firestore → วางกฎด้านล่าง → Publish
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // อนุญาตเฉพาะผู้ที่ login แล้วเท่านั้น
       match /{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
5. ไอคอนเฟือง ⚙️ (Project settings) → เลื่อนลงหา **Your apps** → กดไอคอน `</>` (Web)
   → ตั้งชื่อ app → Register → จะได้โค้ด `firebaseConfig = { ... }`
6. **คัดลอกทั้งอ็อบเจกต์** `{ apiKey: ..., authDomain: ..., ... }`
7. เปิดแอป Pizza Mania → **ตั้งค่า → การเชื่อมต่อ Cloud** → วาง config → กด **เชื่อมต่อ Cloud**
   - แอปจะรีโหลดและเข้าสู่โหมด Cloud (มุมซ้ายบนขึ้น "Cloud" สีเขียว)
8. สร้างบัญชีผู้ดูแลคนแรกอีกครั้ง (บน Cloud) แล้วเพิ่มผู้ใช้/นำเข้าสินค้าได้เลย

> เปิดแอปเดียวกันบนมือถือ (ผ่าน URL ที่ deploy) แล้ว login — จะเห็นข้อมูลเดียวกันเรียลไทม์

---

## 🌐 การนำขึ้นใช้งานจริง (Deploy ฟรี)

หลัง `npm run build` โฟลเดอร์ `dist/` คือเว็บพร้อมใช้ — เอาขึ้น hosting ฟรีที่ไหนก็ได้:

**Firebase Hosting (แนะนำ ถ้าใช้ Cloud อยู่แล้ว):**
```bash
npm install -g firebase-tools
firebase login
firebase init hosting      # เลือก dist เป็น public dir, ตอบ Yes ให้ single-page app
npm run build
firebase deploy
```
จะได้ URL เช่น `https://pizza-mania-stock.web.app` เปิดได้ทุกเครื่อง/มือถือ

ทางเลือกอื่นที่ฟรี: **Netlify** หรือ **Vercel** (ลาก `dist/` ขึ้นไปได้เลย)

> เปิดบนมือถือแล้วกด "เพิ่มไปยังหน้าจอโฮม" จะติดตั้งเป็นแอป (PWA) ใช้เหมือนแอปจริง

---

## 🗂️ โครงสร้างโค้ด

```
src/
├─ backend/        ชั้นเชื่อมข้อมูล: firestore (cloud) + local (เครื่อง) — สลับอัตโนมัติ
├─ firebase/       ตั้งค่า Firebase
├─ auth/           ระบบ login + สิทธิ์ (Admin/พนักงาน)
├─ data/           DataContext — subscribe ข้อมูลเรียลไทม์
├─ services/       ตรรกะธุรกิจ: stock (รับ/เบิก/ปรับ), products, locations, notes, users, seed
├─ pages/          หน้าจอ: Dashboard, Products, Receive, Issue, Adjust, Movements, Reports, Notes, Settings
├─ components/     UI ที่ใช้ร่วม (ปุ่ม, การ์ด, Modal, Toast, ยืนยัน, LineBuilder ฯลฯ)
├─ lib/            format (วันที่ พ.ศ.), image (ย่อรูป), export (Excel/PDF), font ไทย
└─ seed/           รายการสินค้าเริ่มต้น ~150 รายการ
```

### ข้อมูลหลัก (Firestore collections)
`users`, `products`, `productImages`, `locations`, `stockLevels`,
`stockMovements` (ledger), `notes`, `counters`, `productMinOverrides`

---

## 🔒 ความปลอดภัย & ความเสถียร
- ทุกการเปลี่ยนสต๊อกทำใน **Transaction** — ยอดไม่เพี้ยนแม้หลายคนทำพร้อมกัน
- บันทึก **ใครทำ/เมื่อไหร่** ทุกธุรกรรม (audit trail)
- ยกเลิกรายการได้ (คืนสต๊อกอัตโนมัติ) โดยประวัติยังอยู่ครบ
- เครื่องมือ **"คำนวณยอดคงเหลือใหม่"** ในหน้าตั้งค่า (ซ่อมยอดจาก ledger หากสงสัยว่าไม่ตรง)
- ทำงาน offline ได้ (PWA) และซิงก์เมื่อกลับมาออนไลน์

---

## 💡 ทิป
- **รูปสินค้า:** หน้าแก้ไขสินค้า → "📷 เลือกรูป / ถ่ายรูป" — บนมือถือจะเปิดกล้องให้ถ่ายได้เลย
  รูปถูกย่ออัตโนมัติเพื่อประหยัดพื้นที่
- **เพิ่มสาขา:** ตั้งค่า → คลัง/สาขา → เพิ่มคลัง (ระบบรองรับหลายสาขาไม่จำกัด)
- **สำรองข้อมูล:** โหมด Cloud สำรองอัตโนมัติบน Google; โหมดในเครื่องข้อมูลอยู่ในเบราว์เซอร์นั้น

---

*สร้างด้วย React + Vite + TypeScript + Tailwind + Firebase (Spark/ฟรี)*

## หมายเหตุการพัฒนา (Font สำหรับ PDF ภาษาไทย)
ไฟล์ `src/lib/sarabunFont.ts` ถูกสร้างจากฟอนต์ Sarabun (SIL OFL 1.1) ด้วยสคริปต์
`scripts/gen-font.mjs` — หากต้องการเปลี่ยนฟอนต์ ให้วางไฟล์ `.ttf` ใน `scripts/` แล้วรัน
`node scripts/gen-font.mjs`
