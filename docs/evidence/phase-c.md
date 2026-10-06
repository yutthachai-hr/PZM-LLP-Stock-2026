# Phase C (Exceptions & observability) — หลักฐาน

แผน: ข้อ 16–21 (C1–C5, E3, E4)
Branch: `claude/phase-a-ledger-continue-uzbbb5`

**สถานะ:**
- **C1–C5 PASS** บน unit + emulator
- **E3** (deploy cron Worker) เป็นงานของเจ้าของ
- **E4** (error reporting) รอเจ้าของตัดสินใจ จึงยังไม่ทำ

## เกณฑ์ข้อ 21 ของ Phase C

| เกณฑ์ | ผล | หลักฐาน |
|---|---|---|
| listener ที่ถูก deny/ล้ม แสดงข้อความ + retry (E2E) | **PASS** | `e2e/live-error.spec.ts` |
| intel อ่านล้ม ≠ "ไม่มีความเสี่ยง" | **PASS** | `useSupplierIntel` มี `failed` แล้ว ทั้งแผงความเสี่ยงและปฏิทินบอกว่าอ่านไม่สำเร็จ และมีปุ่มลองใหม่ |
| critical ค้างจนกดรับทราบ (ตามที่เจ้าของตัดสิน) | **PASS** | `e2e/critical.spec.ts` |
| toast ไม่ทับ tab bar ที่ 375px (screenshot) | **PASS** | `e2e/critical.spec.ts` + `docs/evidence/img/c5-toast-375.png` |
| axe: 0 serious บน 5 หน้าหลัก | **PASS** | `e2e/a11y.spec.ts` |

**การตรวจ toast ที่ 375px:** วัดกล่องจริงของ toast เทียบกับ tab bar และปุ่ม "+" ที่ยื่นขึ้นมา

**หน้าที่ axe ตรวจ:** `/`, `/products`, `/receive`, `/orders`, `/inbox`

## Commits

| Commit | งาน |
|---|---|
| `1eb41ca` | C1 listener/หน้าเสีย/intel บอกเมื่ออ่านล้ม |
| `564fc01` | C2 แจ้งเตือนโอนค้างในทาง + PO รับบางส่วนค้าง |
| `9763337` | C3 Exception Inbox `/inbox` |
| `e611906` | C4 ตัวบอกออฟไลน์ + draft ของใบขอโอน |
| `1b0b58f` + แก้ toast | C5 แถบวิกฤตจนกดรับทราบ + toast |
| `0a83c0b` | axe + แก้ contrast |

## C1 Listener และหน้าที่ล้ม

- **`useLive`** รายงาน `error` แต่ยังเก็บแถวล่าสุดไว้ ไม่เปลี่ยนเป็นรายการว่าง
  - เน็ตหลุด: subscribe ใหม่เองแบบ backoff
  - ถูกปฏิเสธ หรือโควตาหมด: รอให้กด "ลองใหม่"
- **`DataContext.liveError`** ส่งต่อไปที่ `LiveErrorBanner` ซึ่งแสดงทุกหน้า
- **`ErrorBoundary`** ครอบหน้า (reset เมื่อเปลี่ยนหน้า) หน้าที่ throw จะแสดงข้อความพร้อมปุ่มลองใหม่/โหลดหน้าใหม่ ไม่เป็นจอขาว
- **e2e:** revoke ผู้ใช้กลาง session → เปิดหน้ารายงาน (subscribe movements ใหม่) → เห็นแบนเนอร์ → ยกเลิก revoke → กดลองใหม่ → แบนเนอร์หาย

## C2 แจ้งเตือนงานค้างครึ่งทาง

job ใหม่ชื่อ `stalled` แอปเป็นคนรัน แจ้งหัวหน้าและแอดมิน มี 2 แบบ:

| แบบ | เงื่อนไข | ความรุนแรง |
|---|---|---|
| `transferStuck` | ส่งออกไปแล้ว ≥ 2 วัน แต่ปลายทางยังไม่กดรับ | high (≥ 5 วันเพิ่ม critical อีกใบ) |
| `poPartial` | รับไปแล้วบางส่วน ยังค้างรับ และไม่มีของเข้า ≥ 7 วัน | medium |

- เป็น state: เมื่อของเข้าแล้วจะ resolve เอง
- เทส: `tests/inventory-rules/notifications.test.ts`

## C3 Exception Inbox

หน้า `/inbox` สำหรับหัวหน้าและแอดมิน รวมทุกเรื่องที่รอคนตัดสินใจ เรียงจากรุนแรงสุด แล้วจากรอนานสุด:
- ใบโอนที่มีผลต่าง
- ใบโอนค้างในทาง
- PO เลยกำหนด
- PO ที่ผู้ขายขอเลื่อนวันส่ง
- PR รออนุมัติ
- PO ร่างรออนุมัติ
- คำขอโอนรออนุมัติ
- PO รับบางส่วนค้าง
- ใบนับที่รอ post

**การอ่านข้อมูล:** อ่านเฉพาะเอกสารที่ยังเปิดอยู่ ด้วย query equality บน `status` และอ่านตอนเปิดหน้าเท่านั้น (`services/inbox.ts`)

**เทส:**
- `tests/exception-inbox.test.ts`
- `tests/nav-items.test.ts` (staff ไม่เห็นเมนูนี้)
- `e2e/inbox.spec.ts`

## C4 ออฟไลน์ + draft

- **`OfflineBanner`** (role=status) แสดงทุกหน้าขณะออฟไลน์
- **TransferEditor** เก็บ draft ในเครื่อง แยกต่อเอกสาร
- **RequestEditor** ไม่ต้องมี draft ในเครื่อง เพราะทุกบรรทัดเขียนลง PR ร่างอยู่แล้ว
- **e2e:** `e2e/offline.spec.ts`

## C5 Notification

- **`CriticalBar`:** แถบแดงใต้ top bar ค้างจนกด "รับทราบ" ซึ่ง mark read ให้ผู้ใช้คนนั้นเท่านั้น ส่วน popup ยังหายใน 4 วินาทีตามที่เจ้าของสั่ง
- **Toast:**
  - error ค้างจนกดปิด (เก็บสูงสุด 4 อัน)
  - ทุกอันเป็น live region (error = assertive)
  - บนมือถืออยู่เหนือ tab bar และปุ่ม "+"
- **popup:** มี deep action และ aria-live อยู่แล้ว

## ผลเทส (หลัง `0a83c0b`)

| ชุด | ผล |
|---|---|
| `npm test` | **1,233 ผ่าน** |
| `npm run test:rules` | 218 ผ่าน (rules ไม่เปลี่ยนในเฟสนี้) |
| e2e | **28 ผ่าน / 0 ล้ม / 0 flaky** |
| tsc / oxlint / i18n:check | ผ่าน / 0 errors / ครบ |

## ค้าง

- **E4 error reporting:** รอเจ้าของเลือกระหว่าง `meta/clientErrors` แบบ sampled (เป็น collection/เอกสารใหม่) หรือ Workers log
- **E3:** deploy cron Worker ต้องให้เจ้าของใส่ key
