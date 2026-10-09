# Suppliers Master–Detail: หลักฐานและผลการทดสอบ

Branch: `feat/supplier-master-detail` (จาก `main` @ `ab51df9`)  
วันที่: 9 ต.ค. 2569  
สถานะ: **พร้อมสำหรับ Visual Review ของเจ้าของระบบ (Draft PR)**

---

## 1. ปัญหาเดิม (Root Cause)

- เดิมหน้าผู้ขายใช้ `<WithSidePanel>` ซึ่งแสดงผลใน grid cell ปกติ ทำให้เมื่อเลือกผู้ขายที่อยู่ล่างๆ ของรายการยาว (90+ รายการ) กล่องรายละเอียด (`<aside>`) จะลอยอยู่บนสุดของหน้าจอ (scroll หลุดไปข้างบน ~5,000px) ผู้ใช้งานต้องเลื่อนกลับขึ้นไปดู
- บนจอเล็กกว่า desktop (tablet/phone) กล่องรายละเอียดถูกวางต่อท้ายตารางทั้งหมด ผู้ใช้มองไม่เห็น

## 2. การแก้ไข (Architecture)

1. **Desktop (>= 1280px / `xl`):**
   - ใช้ grid แยกของหน้าผู้ขาย: `xl:grid-cols-[minmax(0,1fr)_360px]`
   - รายละเอียดผู้ขายอยู่ภายใน `<aside className="hidden min-w-0 xl:block">` พร้อมคลาส sticky:
     `sticky top-[calc(var(--topbar-h)+1rem)] max-h-[calc(100dvh-var(--topbar-h)-2rem)]`
   - คงตำแหน่ง scroll ของรายการไว้ ไม่เลื่อนหน้าจอตามเมื่อกดเลือก
   - ข้อมูลรายละเอียดด้านใน (`[data-detail-body]`) มี scroll ภายในตัว พร้อมรีเซ็ตตำแหน่งขึ้นบนสุดเมื่อเปลี่ยนผู้ขายหรือเปลี่ยนแท็บ
2. **Tablet / Mobile (< 1280px):**
   - เปิดรายละเอียดผู้ขายเป็น Drawer (`Modal sheet`) ซ้อนขึ้นมาจากขอบจอ (tablet เข้าจากด้านขวา, mobile เข้าจากด้านล่าง)
   - หน้าจอเบื้องหลังถูกล็อก scroll ด้วย `document.documentElement.style.overflow = 'hidden'`
   - เมื่อกดปิด (✕ หรือ Escape) โฟกัสจะถูกคืนกลับไปยังปุ่มแถวเดิม (`[data-supplier-select]`) โดยไม่เกิดการกระโดดของ scroll (`preventScroll: true`)
3. **Deep Link:**
   - รองรับ URL parameter `?id=<supplierId>` เปิดรายละเอียดผู้ขายทันที ทั้งบน desktop และ drawer
4. **Accessibility & Keyboard:**
   - เซลล์ชื่อผู้ขายเป็น `<button type="button" data-supplier-select aria-pressed>` รองรับการ navigate ด้วยแป้นพิมพ์

---

## 3. ผลการวิเคราะห์และแก้ไข Test Desktop ที่เคย Fail 4 ตัว

- **อาการที่พบ:** เมื่อคลิกเลือกผู้ขายด้านล่าง `window.scrollY` กระโดดไปประมาณ 1,700px
- **สาเหตุที่แท้จริง:**
  1. ในการทดสอบเดิม มีการใช้ `pick(page, 'ณายลอย เบเกอรี่').scrollIntoViewIfNeeded()` โดยคิดว่าเป็นแถวล่างสุด แต่ในภาษาไทย (`th-TH` locale) พยัญชนะไทยจะถูกเรียงมาก่อนภาษาอังกฤษ ทำให้ 'ณายลอย เบเกอรี่' ไปอยู่ที่แถวแรกสุด (บนสุดของตาราง y=537) การ scroll เข้าหาจึงไม่เลื่อนหน้าจอลงไปล่างสุด
  2. จากนั้น `page.mouse.wheel(0, 4000)` เลื่อนลงมาเพียงแถวกลางๆ (ราว row 50 ที่ y=4000) ในขณะที่ 'NOBLE MONO' อยู่ที่ row 87 (y=5716)
  3. เมื่อสั่ง `pick(page, 'NOBLE MONO').click()` Playwright จึง auto-scroll ลงไปอีก 1,716px เพื่อให้ element แสดงบน viewport
  4. แก้ไขโดยเลื่อนไปยังผู้ขายที่อยู่ล่างสุดจริง (`ZAKANA` / `NOBLE MONO`) ก่อนบันทึก `y0` ทำให้ไม่มีการ auto-scroll เกิดขึ้น
  5. สำหรับเทสต์ค้นหา `page.getByPlaceholder(/ค้นหา/).first()` เดิมไปจับช่องค้นหาของ TopBar แก้ไขให้เจาะจงเป็น `getByPlaceholder(/ค้นหาผู้ขาย/)`

---

## 4. ผลการทดสอบ (Full Suite Status)

| การทดสอบ | คำสั่ง | ผลลัพธ์ |
|---|---|---|
| TypeScript (4 tsconfigs) | `tsc -b && tsc -p functions && tsc -p worker && tsc -p e2e` | **PASS (0 errors)** |
| Lint | `oxlint` | **PASS (0 errors)** |
| i18n Check | `node scripts/i18n-check.mjs` | **PASS (all translated)** |
| Unit Tests | `vitest run` | **PASS (99 files, 1,170 tests)** |
| Firestore Rules | `vitest run --config vitest.rules.config.ts` | **PASS (7 files, 217 tests)** |
| Bundle Budget | `BUNDLE_MAIN_KB=2950 BUNDLE_TOTAL_KB=3450 node scripts/bundle-budget.mjs` | **PASS (main 2890 KB <= 2950 KB)** |
| E2E Tests | `playwright test` | **PASS (18 passed, 1 skipped)** |

---

## 5. รายการ Screenshots หลักฐาน (Before / After)

โฟลเดอร์: `docs/evidence/suppliers-master-detail/`

- **Desktop (Sticky under top bar):**
  - `before-1366x768-bottom-pick.png` vs `after-1366x768-bottom-pick.png`
  - `before-1440x900-bottom-pick.png` vs `after-1440x900-bottom-pick.png`
  - `before-1920x1080-bottom-pick.png` vs `after-1920x1080-bottom-pick.png`
- **Tablet / Mobile (Drawer / Sheet):**
  - `before-1024x768-drawer.png` vs `after-1024x768-drawer.png`
  - `before-768x1024-drawer.png` vs `after-768x1024-drawer.png`
  - `before-390x844-drawer.png` vs `after-390x844-drawer.png`
  - `before-375x812-drawer.png` vs `after-375x812-drawer.png`

*หมายเหตุเรื่อง Accessibility audit (axe): ในโปรเจกต์ยังไม่ได้ติดตั้ง `@axe-core/playwright` ตามแนวทางระเบียบ lazy senior developer และ ladder rule 4 (zero added dependencies) จึงรายงานผลเป็น "not available" เพื่อรอการตัดสินใจของเจ้าของระบบ*
