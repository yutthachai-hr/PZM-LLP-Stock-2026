// English copy, keyed by the Thai original. See I18nContext.tsx for why the Thai is the key.
//
// Placeholders are {name}, filled by t()'s second argument — so a phrase never has to be
// split around a number. Anything missing here renders as Thai rather than blowing up.
//
// Product names, SKUs and categories are DATA and are never translated.

export const EN: Record<string, string> = {
  // ---- generic actions / words -------------------------------------------------
  บันทึก: 'Save',
  ยกเลิก: 'Cancel',
  ยืนยัน: 'Confirm',
  ปิด: 'Close',
  ลบ: 'Delete',
  แก้ไข: 'Edit',
  ดู: 'View',
  เปลี่ยน: 'Change',
  นำเข้า: 'Import',
  เพิ่มสินค้า: 'Add product',
  'ตัวกรอง': 'Filters',
  'ตัวกรอง ({n})': 'Filters ({n})',
  'ที่เก็บข้อมูลของแอปนี้': 'Where this app keeps its data',
  'สถานที่ที่นับสต๊อกได้ — ทุกการรับเข้า/เบิกออกต้องระบุคลัง': 'Places stock can be counted — every receipt and issue names one',
  'ใครเข้าระบบได้บ้าง และมีสิทธิ์ระดับไหน': 'Who can sign in, and at what level',
  'เครื่องมือซ่อมข้อมูล ใช้เมื่อยอดคงเหลือไม่ตรงกับประวัติ': 'Repair tools, for when balances disagree with the ledger',
  ค้นหา: 'Search',
  ทั้งหมด: 'All',
  วันที่: 'Date',
  จำนวน: 'Quantity',
  หมายเหตุ: 'Note',
  สินค้า: 'Product',
  หมวดหมู่: 'Category',
  หน่วย: 'Unit',
  สถานะ: 'Status',
  คงเหลือ: 'On hand',
  ขั้นต่ำ: 'Minimum',
  เลขที่: 'Doc no.',
  โดย: 'By',
  ชื่อ: 'Name',
  รวม: 'Total',
  จาก: 'From',
  ไป: 'To',
  ประเภท: 'Type',
  เหตุผล: 'Reason',
  ทิศทาง: 'Direction',
  คลัง: 'Location',
  สาขา: 'Branch',
  มูลค่า: 'Value',
  ปกติ: 'OK',
  หมด: 'Out',
  ใกล้หมด: 'Low',
  'ล่าสุด': 'Last used',
  'เมนู': 'Menu',
  'ผู้ใช้': 'User',
  '— เลือก —': '— Select —',
  '(ยกเลิก)': '(voided)',
  '(คุณ)': '(you)',
  'กำลังโหลด...': 'Loading…',
  'กำลังบันทึก...': 'Saving…',
  'กำลังนำเข้า...': 'Importing…',
  'กำลังดำเนินการ...': 'Working…',
  'กำลังคำนวณ...': 'Calculating…',
  'กำลังสร้าง...': 'Creating…',
  'บันทึกแล้ว': 'Saved',
  'ลบแล้ว': 'Deleted',

  'พิมพ์ “{phrase}” เพื่อยืนยัน': 'Type “{phrase}” to confirm',

  // ---- backup / restore --------------------------------------------------------
  'กู้คืนแล้ว: เขียนใหม่ {written} รายการ, คงเดิม {kept} รายการ, สร้างยอดใหม่ {rebuilt} รายการ, ข้าม {skipped} รายการ':
    'Restored: {written} written, {kept} left as they were, {rebuilt} balances and counters rebuilt, {skipped} skipped',
  'กดกู้คืนไฟล์เดิมซ้ำได้ ระบบจะทำต่อจากเดิมโดยไม่สร้างข้อมูลซ้ำ':
    'you can restore the same file again; it picks up where it stopped and will not duplicate anything',
  'วิธีกู้คืน': 'How to restore',
  'เติมเฉพาะที่หาย — ปลอดภัยที่สุด ใช้เมื่อข้อมูลถูกลบไป':
    'Only fill in what is missing — safest, for when data was deleted',
  'เขียนทับข้อมูลหลักด้วย — ใช้เมื่อแก้สินค้า/คลังผิดแล้วอยากย้อนกลับ':
    'Also overwrite the master data — for undoing a bad edit to products or locations',
  'โหมดเติมที่หาย: เขียนเฉพาะรายการที่หายไป ของที่แก้ไขหลังสำรองจะไม่ถูกแตะ':
    'Fill-in mode: only missing records are written; anything edited since the backup is left alone.',
  'โหมดเขียนทับ: ข้อมูลหลัก (สินค้า คลัง รูป บันทึก) จะถูกเขียนกลับตามไฟล์ ทับการแก้ไขที่ทำหลังสำรอง':
    'Overwrite mode: master data (products, locations, images, notes) is written back as the file has it, replacing edits made since the backup.',
  'ประวัติการเคลื่อนไหวเป็นข้อมูลที่เพิ่มได้อย่างเดียว รายการที่บันทึกหลังสำรองจะยังอยู่ครบ และยอดคงเหลือกับเลขเอกสารจะถูกสร้างใหม่จากประวัติทั้งหมดหลังกู้คืน':
    'The movement history is append-only: anything recorded after the backup is kept, and balances and document numbers are rebuilt from the whole history once the restore finishes.',
  'เตือน: ตอนสำรอง มียอดคงเหลือ {n} รายการไม่ตรงกับประวัติ — กด “ตรวจความสอดคล้องของยอด” ในหน้าตั้งค่า':
    'Warning: {n} balance(s) disagreed with the history when this backup was taken — use “Check balances against history” in Settings',
  'กู้คืนข้อมูลแล้ว แต่สร้างยอดคงเหลือใหม่ไม่ได้: ประวัติทำให้ยอดติดลบ {count} รายการ (เช่น {example})':
    'The data was restored, but the balances could not be rebuilt: the history totals negative in {count} place(s) (for example {example})',
  'รายงานการเคลื่อนไหวสต๊อก — {company}': 'Stock movement report — {company}',
  'รายงานสต๊อกคงเหลือ — {company}': 'Stock on hand report — {company}',
  'ตั้งแต่ {date} (เท่าที่โหลดไว้)': 'From {date} (as far as loaded)',
  'กำลังโหลดข้อมูล...': 'Loading data...',
  'กำลังสร้างไฟล์...': 'Building the file...',
  'สร้างไฟล์ไม่สำเร็จ:': 'Could not build the file:',
  'ปักหมุดไม่สำเร็จ:': 'Could not pin that:',
  'ขั้นต่ำต้องเป็นตัวเลขไม่ติดลบ': 'The minimum must be a number that is not negative',
  'ต้นทุนต้องเป็นตัวเลขไม่ติดลบ': 'The cost must be a number that is not negative',
  'ไฟล์นี้เป็นข้อมูลของ {file} แต่ตอนนี้เปิด {current} อยู่ — สลับไปที่ {file} ก่อนแล้วค่อยกู้คืน':
    'This file holds {file} data but {current} is open — switch to {file} first, then restore',
  'ออกจากระบบอัตโนมัติเพราะไม่มีการใช้งาน {minutes} นาที — เครื่องนี้เป็นเครื่องใช้ร่วมกัน':
    'Signed out automatically after {minutes} minutes of inactivity — this is a shared device',
  'เปลี่ยนหน่วยไม่ได้เพราะสินค้านี้มีสต๊อกหรือมีประวัติแล้ว — ตัวเลขเก่าจะอ่านผิดความหมาย ถ้าหน่วยผิดให้สร้างสินค้าใหม่':
    'The unit cannot be changed because this product has stock or history — the existing numbers would change meaning. If the unit is wrong, create a new product.',
  'เปลี่ยนหน่วยไม่ได้: "{name}" ยังมีสต๊อกคงเหลือ {qty} {unit} — ปรับยอดเป็น 0 ก่อน หรือสร้างสินค้าใหม่ด้วยหน่วยที่ถูกต้อง':
    'Cannot change the unit: “{name}” still has {qty} {unit} on hand — bring it to 0 first, or create a new product with the right unit',
  'เปลี่ยนหน่วยไม่ได้: "{name}" มีประวัติการเคลื่อนไหวแล้ว การเปลี่ยนหน่วยจะทำให้ตัวเลขเก่าอ่านผิดความหมาย — ให้สร้างสินค้าใหม่ด้วยหน่วยที่ถูกต้องแทน':
    'Cannot change the unit: “{name}” already has movement history, and changing it would make those records mean something else — create a new product with the right unit instead',
  'มีเวอร์ชันใหม่ของระบบพร้อมใช้งานแล้ว': 'A new version of the system is ready',
  'อัปเดตตอนนี้': 'Update now',
  'ไว้ทีหลัง': 'Later',
  '{n} รายการ': '{n} items',
  'ลบ "{name}" ออกจากรายการ': 'Remove “{name}” from this document',
  'สำรอง / กู้คืนข้อมูล': 'Backup & restore',
  'ดาวน์โหลดข้อมูลทั้งหมดของ {brand} เป็นไฟล์เดียว แล้วเก็บไว้ใน Google Drive หรือ OneDrive':
    'Download everything in {brand} as a single file and keep it in Google Drive or OneDrive',
  'ดาวน์โหลดไฟล์สำรอง': 'Download backup',
  'กู้คืนจากไฟล์': 'Restore from file',
  'กำลังสำรอง...': 'Backing up…',
  'กำลังกู้คืน...': 'Restoring…',
  'สำรองข้อมูลแล้ว {n} รายการ': 'Backed up {n} records',
  'สำรองข้อมูลไม่สำเร็จ:': 'Backup failed:',
  กู้คืนข้อมูลจากไฟล์สำรอง: 'Restore from backup',
  กู้คืน: 'Restore',
  'กู้คืนไม่สำเร็จ:': 'Restore failed:',
  ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของระบบ: 'That file is not a backup from this system',
  'ไฟล์นี้สำรองจาก {brand} เมื่อ {when} — มี {n} รายการ':
    'This backup is from {brand}, taken {when} — {n} records',
  'แผนฟรีของ Firebase ไม่มีระบบกู้ข้อมูลย้อนหลัง ถ้าลบผิดจะกู้ไม่ได้เลย — ควรกดสำรองอย่างน้อยสัปดาห์ละครั้ง':
    'The free Firebase plan has no point-in-time recovery — a mistaken delete cannot be undone. Take a backup at least once a week.',
  'แสดงประวัติตั้งแต่ {date}': 'History loaded from {date}',
  โหลดประวัติทั้งหมด: 'Load full history',
  คงเหลือต้นทาง: 'Source on hand',
  คงเหลือปัจจุบัน: 'Current on hand',
  'คงเหลือหลังปรับ:': 'On hand after adjustment:',
  'แก้ไข:': 'Edited by:',
  คลังหลัก: 'Warehouse',
  'พบ {n} รายการ': '{n} found',
  'แสดงตัวอย่าง — ไฟล์ดาวน์โหลดจะมีครบทั้ง {n} รายการ':
    'Preview only — the download contains all {n} rows',
  '— ข้อมูลซิงก์ทุกเครื่องแบบเรียลไทม์': '— data syncs across devices in real time',
  'ตอนนี้ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น หากต้องการใช้หลายเครื่องแบบเรียลไทม์ (ฟรี) ให้สร้าง Firebase project แล้ววาง config ด้านล่าง — ดูวิธีใน README':
    'Data currently lives in this browser only. To use several devices in real time (free), create a Firebase project and paste its config below — see the README.',

  // ---- navigation / shell ------------------------------------------------------
  ภาพรวม: 'Dashboard',
  สินค้าคงคลัง: 'Inventory',
  รับสินค้าเข้า: 'Receive',
  'เบิก/โอนสาขา': 'Issue / Transfer',
  ปรับสต๊อก: 'Adjust',
  'ประวัติ/Stock Card': 'History / Stock card',
  รายงาน: 'Reports',
  บันทึกช่วยจำ: 'Notes',
  ตั้งค่า: 'Settings',
  ออกจากระบบ: 'Sign out',
  'สลับแบรนด์': 'Switch brand',
  ในเครื่อง: 'Local',
  โหมดในเครื่อง: 'Local mode',
  เดโม: 'Demo',
  'โหมดสาธิต — ไม่ใช่สต๊อกจริง': 'Demo mode — not real stock',
  ผู้ดูแลระบบ: 'Administrator',
  พนักงาน: 'Staff',

  // ---- brand picker ------------------------------------------------------------
  เลือกแบรนด์ที่จะจัดการ: 'Choose a brand to manage',
  'สวัสดี {name} — ข้อมูลสต๊อกของแต่ละแบรนด์แยกกันสมบูรณ์':
    'Hello {name} — each brand keeps its stock data completely separate',
  ระบบสต๊อกพิซซ่า: 'Pizza stock system',
  'ระบบสต๊อกแซนด์วิช (แบรนด์น้อง)': 'Sandwich stock system (sister brand)',

  // ---- login / auth ------------------------------------------------------------
  เข้าสู่ระบบ: 'Sign in',
  เข้าสู่ระบบบริหารสต๊อก: 'Sign in to stock management',
  อีเมล: 'Email',
  รหัสผ่าน: 'Password',
  ชื่อผู้ดูแล: 'Administrator name',
  'เช่น สมชาย': 'e.g. Somchai',
  'อย่างน้อย 6 ตัวอักษร': 'At least 6 characters',
  สร้างบัญชีผู้ดูแล: 'Create administrator account',
  ตั้งค่าผู้ดูแลระบบคนแรก: 'Set up the first administrator',
  'ขอสิทธิ์เข้าใช้งาน': 'Request access',
  'ชื่อของคุณ': 'Your name',
  'ส่งคำขอเข้าใช้งาน': 'Request access',
  'ยังไม่มีบัญชี? ขอสิทธิ์เข้าใช้งาน': 'No account yet? Request access',
  'บัญชีใหม่จะยังเข้าใช้ข้อมูลไม่ได้จนกว่าผู้ดูแลระบบจะอนุมัติ':
    'A new account cannot see any data until an administrator approves it',
  'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ': 'Already have an account? Sign in',
  รูปแบบอีเมลไม่ถูกต้อง: 'That email address is not valid',
  'รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัว)': 'Password is too short (at least 6 characters)',
  'แคตตาล็อกมีรหัสสินค้าซ้ำ: {sku} — แก้ไฟล์ต้นทางก่อนนำเข้า':
    'The catalogue lists the product code {sku} twice — fix the source workbook before importing',
  'รหัสสินค้าใช้เป็นคีย์ไม่ได้: {sku}': 'That product code cannot be used as a key: {sku}',
  'สร้างบัญชีไม่สำเร็จ และลบบัญชีที่ค้างไม่ได้ — อีเมล {email} ถูกใช้ไปแล้วใน Firebase Authentication กรุณาลบออกจาก Console ก่อนลองใหม่':
    'Could not create the account, and the half-made one could not be removed — {email} is now taken in Firebase Authentication. Delete it from the console before trying again.',
  อีเมลนี้ถูกใช้แล้ว: 'That email is already registered',
  อีเมลหรือรหัสผ่านไม่ถูกต้อง: 'Incorrect email or password',
  ไม่พบอีเมลนี้ในระบบ: 'No account found for that email',
  รหัสผ่านไม่ถูกต้อง: 'Incorrect password',
  ไม่พบบัญชีนี้: 'Account not found',
  บัญชีนี้ถูกปิดใช้งาน: 'This account has been disabled',
  'บัญชีนี้ยังไม่ถูกเปิดใช้งาน — กรุณาให้ผู้ดูแลระบบอนุมัติก่อนเข้าใช้':
    'This account is not active yet — an administrator must approve it before you can sign in',
  'สิทธิ์การเข้าใช้ของบัญชีนี้ถูกยกเลิกแล้ว': 'This account’s access has been revoked',
  'ระบบนี้ยังไม่ได้ตั้งค่า — เจ้าของต้องสร้างบัญชีผู้ดูแลคนแรกจาก Firebase Console ก่อน':
    'This system has not been set up yet — the owner must create the first administrator from the Firebase console',
  'มีผู้ใช้ในระบบแล้ว กรุณาเข้าสู่ระบบ': 'An account already exists — please sign in',
  'โหมดในเครื่องมีไว้ทดลองใช้ ไม่ใช่สำหรับข้อมูลจริง':
    'Local mode is for trying the app out, not for real data',
  'รหัสผ่านเก็บในเบราว์เซอร์แบบไม่เข้ารหัส ใครเปิดเครื่องนี้ได้ก็อ่านได้':
    'Passwords are stored in this browser unencrypted — anyone who can open this device can read them',
  'ไม่มีเซิร์ฟเวอร์ตรวจสิทธิ์ — สิทธิ์ผู้ดูแล/พนักงานเป็นแค่การซ่อนปุ่ม':
    'No server checks permissions — the admin and staff roles only hide buttons here',
  'ข้อมูลอยู่แค่เบราว์เซอร์นี้ ล้างข้อมูลเบราว์เซอร์แล้วหายถาวร':
    'The data lives only in this browser, and clearing site data deletes it for good',
  'สำหรับสต๊อกจริง ให้เชื่อมต่อ Cloud ด้านล่าง': 'For real stock, connect to the cloud below',
  'ข้อมูลในเครื่องของ "{collection}" เสียหาย อ่านไม่ได้ — ระบบหยุดไว้เพื่อไม่ให้เขียนทับ (สำเนาที่เสียถูกเก็บไว้ที่ {key})':
    'The local data for “{collection}” is damaged and cannot be read — the app stopped rather than write over it (the damaged copy is kept at {key})',
  'โหมดในเครื่อง — ข้อมูลเก็บในเบราว์เซอร์นี้':
    'Local mode — data is stored in this browser only',
  'โหมด Cloud — ข้อมูลซิงก์ทุกเครื่องแบบเรียลไทม์':
    'Cloud mode — data syncs across devices in real time',
  'เชื่อมต่อ Cloud (ใช้หลายเครื่อง real-time)': 'Connect to Cloud (multi-device, real time)',
  'เชื่อมต่อ Cloud': 'Connect to Cloud',
  'จาก Firebase Console:': 'From the Firebase Console:',
  วางค่า: 'Paste config',
  'อ่านค่า config ไม่ได้ — วางทั้งอ็อบเจกต์ { apiKey: ..., projectId: ..., appId: ... }':
    'Could not read that config — paste the whole object { apiKey: …, projectId: …, appId: … }',

  // ---- dashboard ---------------------------------------------------------------
  'ภาพรวมสต๊อก': 'Stock overview',
  'กำลังโหลดภาพรวม...': 'Loading dashboard…',
  จำนวนสินค้า: 'Products',
  มูลค่าสต๊อก: 'Stock value',
  'มูลค่าสต๊อกตามหมวดหมู่ (บาท)': 'Stock value by category (THB)',
  รวมทุกคลัง: 'All locations',
  อิงต้นทุนที่กรอก: 'Based on entered cost',
  'ใกล้/ต่ำกว่าขั้นต่ำ': 'At or below minimum',
  ไม่พบสินค้า: 'No products found',
  'ค้นหาสินค้าในคลังนี้…': 'Search products in this location…',
  '* มูลค่าจะแสดงเมื่อกรอกต้นทุนต่อหน่วยในหน้าสินค้า':
    '* Value appears once you enter a unit cost on the product page',

  // ---- products ----------------------------------------------------------------
  'กำลังโหลดสินค้า...': 'Loading products…',
  ยังไม่มีสินค้า: 'No products yet',
  ยังไม่มีข้อมูลสินค้า: 'No product data yet',
  'กด “นำเข้าแคตตาล็อกสินค้า” หรือ “เพิ่มสินค้า”':
    'Use “Import product catalogue” or “Add product”',
  ไม่พบสินค้าที่ตรงกับตัวกรอง: 'No products match these filters',
  ลองล้างตัวกรองแล้วค้นใหม่: 'Try clearing the filters and searching again',
  ค้นจาก: 'Search in',
  ชื่อสินค้า: 'Product name',
  รหัสสินค้า: 'Product code',
  'ชื่อ / รหัส / หมวดหมู่...': 'Name / code / category…',
  'เช่น MOZZARELLA': 'e.g. MOZZARELLA',
  'เช่น VGT-01': 'e.g. VGT-01',
  ทุกหมวดหมู่: 'All categories',
  ทุกสถานะ: 'All statuses',
  ทุกคลังรวมกัน: 'All locations combined',
  ดูคงเหลือของ: 'Balance for',
  เรียงตาม: 'Sort by',
  หมดสต๊อก: 'Out of stock',
  มีของ: 'In stock',
  'ชื่อ ก→ฮ / A→Z': 'Name A→Z',
  'ชื่อ ฮ→ก / Z→A': 'Name Z→A',
  'รหัสสินค้า น้อย→มาก': 'Code A→Z',
  'รหัสสินค้า มาก→น้อย': 'Code Z→A',
  'คงเหลือ มาก→น้อย': 'On hand high→low',
  'คงเหลือ น้อย→มาก': 'On hand low→high',
  คงเหลือรวม: 'Total on hand',
  'ล้างตัวกรอง ({n})': 'Clear filters ({n})',
  'แสดง {shown} จาก {total} รายการ': 'Showing {shown} of {total}',
  'SKU / รหัส': 'SKU / code',
  แก้ไขสินค้า: 'Edit product',
  ลบสินค้า: 'Delete product',
  'หน่วยนับ (แสดงผล)': 'Unit (display)',
  ตัวย่อหน่วย: 'Unit code',
  'เช่น Kilogram, ขวด, แพ็ค': 'e.g. Kilogram, Bottle, Pack',
  'เช่น KG, EA, Pack': 'e.g. KG, EA, Pack',
  'สต๊อกขั้นต่ำ (แจ้งเตือนเมื่อถึง)': 'Minimum stock (alert threshold)',
  'ต้นทุน/หน่วย (ไม่บังคับ)': 'Cost per unit (optional)',
  'เลือกรูป / ถ่ายรูป': 'Choose or take a photo',
  รูปจะถูกย่อให้เล็กอัตโนมัติ: 'Photos are compressed automatically',
  'ยอดคงเหลือปัจจุบัน (พิมพ์จำนวนที่มีจริง)': 'Current balance (enter the real count)',
  'แก้ตัวเลขให้ตรงกับของจริงในคลัง — ระบบจะบันทึกเป็นรายการ “ตั้งยอด/ยอดยกมา” ให้อัตโนมัติ (เก็บประวัติครบ)':
    'Set these to the real counts — each change is recorded as an “Opening balance” adjustment, so the history stays complete',
  กรุณาใส่ชื่อสินค้า: 'Please enter a product name',
  กรุณาใส่หมวดหมู่: 'Please enter a category',
  เพิ่มสินค้าแล้ว: 'Product added',
  บันทึกการแก้ไขแล้ว: 'Changes saved',
  'ลบ "{name}" ? ประวัติการเคลื่อนไหวจะยังคงอยู่ แต่สินค้าจะหายจากรายการ':
    'Delete “{name}”? Movement history is kept, but the product leaves the list.',
  'นำเข้าแคตตาล็อกสินค้า ({n} รายการ)': 'Import product catalogue ({n} items)',
  'ล้างและนำเข้าใหม่': 'Reset and re-import',
  ล้างและนำเข้าสินค้าใหม่: 'Reset and re-import products',
  'ลบสินค้าทั้ง {count} รายการของ {brand} ทิ้ง (รวมรูปและยอดคงเหลือของสินค้านั้น) แล้วนำเข้าแคตตาล็อกจริงจากไฟล์รหัสสินค้า {catalog} รายการแทน?':
    'Delete all {count} products in {brand} (including their photos and balances) and import the {catalog} items from the official item-code file instead?',
  'ประวัติการเคลื่อนไหวจะยังอยู่ครบ แต่ยอดคงเหลือที่นับไว้จะหายทั้งหมด — ย้อนกลับไม่ได้':
    'Movement history is kept in full, but every counted balance is lost — this cannot be undone.',
  'ลบ {removed} รายการ, นำเข้าใหม่ {imported} รายการ':
    'Deleted {removed} items, imported {imported}',
  'นำเข้าสินค้า {products} รายการ, คลัง {locations} แห่ง':
    'Imported {products} products and {locations} locations',
  'นำเข้าไม่สำเร็จ:': 'Import failed:',
  'บันทึกไม่สำเร็จ:': 'Save failed:',
  'ลบไม่สำเร็จ:': 'Delete failed:',
  อ่านรูปไม่สำเร็จ: 'Could not read that image',

  // ---- receive -----------------------------------------------------------------
  'คีย์รับสินค้าใหม่ → เพิ่มเข้าคลังอัตโนมัติ':
    'Record incoming stock — balances update automatically',
  วันที่รับ: 'Received on',
  คลังปลายทาง: 'Destination location',
  เลือกคลังปลายทาง: 'Select a destination',
  'ผู้รับเข้า (บันทึกอัตโนมัติ)': 'Received by (recorded automatically)',
  'หมายเหตุ / เลขบิลส่งของ (Supplier)': 'Note / supplier delivery number',
  'ระบุเลขเอกสารจริงจาก Supplier — เช่น เดล ตาซาโร (ประเทศไทย) จำกัด · Bocconcini 4.5 kg · เลขบิล IV2616876':
    'Use the supplier’s real document number — e.g. Del Casaro (Thailand) Ltd. · Bocconcini 4.5 kg · invoice IV2616876',
  'เช่น เดล ตาซาโร (ประเทศไทย) จำกัด / เลขบิล IV2616876':
    'e.g. Del Casaro (Thailand) Ltd. / invoice IV2616876',
  'กรุณากรอกเลขบิล/เอกสารส่งของจาก Supplier':
    'Please enter the supplier’s delivery document number',
  'บันทึกรับเข้า ({n} รายการ)': 'Save receipt ({n} items)',
  'รับสินค้าเข้าเรียบร้อย (เลขที่ {docNo})': 'Stock received (doc no. {docNo})',

  // ---- issue / transfer --------------------------------------------------------
  'เบิก / โอน / ตัดออก': 'Issue / Transfer / Write-off',
  'โอนของไปเก็บที่สาขา หรือเบิกของออกจากคลังไปใช้/ขายหน้าร้าน — ตัดสต๊อกอัตโนมัติ':
    'Move stock to a branch, or issue it for use and sale — balances update automatically',
  'โอนไปสาขา (เก็บสต๊อก)': 'Transfer to branch (keeps stock)',
  'เบิกใช้ / ตัดออก (หน้าร้าน)': 'Issue / write-off (shop floor)',
  'เบิกของออกจากคลังไปใช้/ขายหน้าร้าน (เช่น สาขาสุขุมวิทที่อยู่ที่เดียวกับคลัง) — ตัดสต๊อกออก ไม่เพิ่มเข้าสาขาอื่น':
    'Issue stock out for use or sale (e.g. the Sukhumvit shop sharing the warehouse site) — deducts stock without adding it to another location',
  'จากคลัง (ต้นทาง)': 'From (source)',
  'ไปยังสาขา (ปลายทาง)': 'To (destination)',
  เบิกจากคลัง: 'Issue from',
  เลือกคลังต้นทาง: 'Select a source location',
  เลือกต้นทางและปลายทาง: 'Select a source and destination',
  ต้นทางและปลายทางต้องต่างกัน: 'Source and destination must be different',
  'ผู้เบิก (บันทึกอัตโนมัติ)': 'Issued by (recorded automatically)',
  วันที่เบิก: 'Issued on',
  'เบิกไปใช้ที่ / หมายเหตุ': 'Issued for / note',
  'เช่น สุขุมวิท': 'e.g. Sukhumvit',
  รายการสินค้าที่เบิก: 'Items issued',
  รายการสินค้า: 'Items',
  เพิ่มรายการสินค้าก่อน: 'Add at least one item first',
  'บันทึกเบิกใช้ ({n} รายการ)': 'Save issue ({n} items)',
  'บันทึกโอนไปสาขา ({n} รายการ)': 'Save transfer ({n} items)',
  'บันทึกเบิกใช้เรียบร้อย (เลขที่ {docNo})': 'Issue saved (doc no. {docNo})',
  'เบิก/โอนเรียบร้อย (เลขที่ {docNo})': 'Issue / transfer saved (doc no. {docNo})',
  'สต๊อกไม่พอสำหรับ "{name}"': 'Not enough stock for “{name}”',
  'รูปหลักฐาน (แนบได้ทุกครั้ง)': 'Proof photo (optional every time)',
  'ถ่าย / เลือกรูป': 'Take or choose a photo',
  ลบรูป: 'Remove photo',
  หลักฐาน: 'Proof',
  สุขุมวิท: 'Sukhumvit',

  // ---- adjust ------------------------------------------------------------------
  'แก้ไขยอดกรณีของหาย เสียหาย หมดอายุ หรือปรับตามการนับจริง':
    'Correct balances for loss, damage, expiry, or a physical count',
  'คลัง/สาขา': 'Location',
  เลือกคลัง: 'Select a location',
  เลือกสินค้า: 'Select a product',
  'เพิ่มเข้า (+)': 'Increase (+)',
  'ลดออก (−)': 'Decrease (−)',
  'หมายเหตุ (ไม่บังคับ)': 'Note (optional)',
  บันทึกการปรับ: 'Save adjustment',
  'ปรับสต๊อกเรียบร้อย (เลขที่ {docNo})': 'Stock adjusted (doc no. {docNo})',
  'จำนวนมากเกินไป (สูงสุด {max})': 'That quantity is too large (maximum {max})',
  'จำนวนของ "{name}" น้อยกว่าที่ระบบเก็บได้ (ขั้นต่ำ {step})':
    'The quantity for “{name}” is smaller than the system can store (minimum {step})',
  'มีการบันทึกรายการใหม่ระหว่างคำนวณ — ยังไม่ได้แก้ไขข้อมูลใด ๆ กรุณาลองใหม่':
    'A movement was recorded while the totals were being worked out — nothing has been changed, please try again',
  'วันที่ไม่ถูกต้อง': 'That date is not valid',
  'ค่าไม่ถูกต้อง: {value}': 'Not a valid value: {value}',
  'ข้อมูลไม่ครบ: {what}': 'Missing information: {what}',
  'ไม่พบสินค้าในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่':
    'That product is no longer in the system (it may have been deleted) — please pick another',
  'สินค้า "{name}" ถูกปิดใช้งานแล้ว': 'The product “{name}” has been deactivated',
  'ไม่พบคลังในระบบแล้ว (อาจถูกลบไป) — โปรดเลือกใหม่':
    'That location is no longer in the system (it may have been deleted) — please pick another',
  'คลัง "{name}" ถูกปิดใช้งานแล้ว': 'The location “{name}” has been deactivated',
  'ยกเลิกไม่ได้: ของจากรายการนี้ถูกใช้ต่อไปแล้ว (คงเหลือ {qty} จาก {need}) — ให้บันทึกรายการปรับสต๊อกแทน':
    'Cannot void: the goods from this document have already been passed on ({qty} left of {need}) — record a stock adjustment instead',
  'จำนวนต้องมากกว่า 0': 'Quantity must be greater than 0',
  'ค้นหาสินค้า': 'Search products',

  // ---- adjust reasons (types.ts) ----------------------------------------------
  ของหาย: 'Lost',
  'แตก/ชำรุด': 'Broken / damaged',
  หมดอายุ: 'Expired',
  เสียหาย: 'Spoiled',
  'พบเพิ่ม (นับได้เกิน)': 'Found (count over)',
  ปรับตามการนับ: 'Count correction',
  'ตั้งยอด/ยอดยกมา': 'Opening balance',

  // ---- movements / stock card --------------------------------------------------
  'ประวัติ / Stock Card': 'History / Stock card',
  'ทุกการเคลื่อนไหวถูกบันทึกถาวร — เลือกสินค้า + คลัง เพื่อดูยอดคงเหลือแบบ Stock Card':
    'Every movement is recorded permanently — pick a product and location to see it as a stock card',
  'โหมด Stock Card: แสดงยอดคงเหลือสะสมของสินค้านี้ที่คลังที่เลือก':
    'Stock card mode: running balance for this product at the selected location',
  ทุกสินค้า: 'All products',
  ทุกคลัง: 'All locations',
  ตั้งแต่วันที่: 'From date',
  ถึงวันที่: 'To date',
  ไม่พบรายการ: 'No movements found',
  ลองปรับตัวกรอง: 'Try adjusting the filters',
  รับเข้า: 'Receipt',
  'เบิก/โอน': 'Issue / transfer',
  เบิกใช้: 'Issue',
  ปรับ: 'Adjustment',
  ยกเลิกรายการ: 'Void movement',
  'ยกเลิกรายการ {docNo} ({name})? ระบบจะคืนยอดสต๊อกกลับ':
    'Void {docNo} ({name})? The stock will be returned to its previous balance.',
  'ยกเลิกรายการแล้ว (คืนสต๊อก)': 'Movement voided (stock restored)',
  'แก้ไขรายการ {docNo}': 'Edit movement {docNo}',
  'แก้ไขรายการแล้ว (ปรับยอดสต๊อกให้อัตโนมัติ)': 'Movement updated (balances adjusted automatically)',
  'แก้ไขไม่สำเร็จ:': 'Edit failed:',
  'ทำรายการไม่สำเร็จ:': 'Operation failed:',
  ดูรูปหลักฐาน: 'View proof photo',
  'รูปหลักฐาน — {docNo}': 'Proof photo — {docNo}',
  ไม่พบรูป: 'No photo found',

  // ---- reports -----------------------------------------------------------------
  'ดึงรายงานตามสาขา/วันที่/สินค้า แล้วดาวน์โหลดเป็น Excel หรือ PDF':
    'Build a report by location, date or product, then download it as Excel or PDF',
  สต๊อกคงเหลือ: 'Stock on hand',
  การเคลื่อนไหว: 'Movements',
  เริ่มต้น: 'Opening',
  ปัจจุบัน: 'Current',
  เบิกออก: 'Issued',
  ผู้ทำ: 'By',
  'หมายเหตุ / เลขบิล': 'Note / invoice no.',
  ไม่มีข้อมูลตามเงื่อนไข: 'No data matches these filters',
  ปรับตัวกรองด้านบน: 'Adjust the filters above',
  'คลัง/สาขา: {name}': 'Location: {name}',
  'ช่วงวันที่: {range}': 'Date range: {range}',
  'สินค้า: {name}': 'Product: {name}',
  'ออกรายงานโดย: {user} เมื่อ {when}': 'Generated by {user} on {when}',
  'รายงานสต๊อกคงเหลือ_{ts}': 'stock_on_hand_{ts}',
  'รายงานการเคลื่อนไหว_{ts}': 'stock_movements_{ts}',

  // ---- notes -------------------------------------------------------------------
  'จดบันทึกเล็กๆ น้อยๆ หรือเรื่องสำคัญ เรียกดูได้ทุกเครื่อง':
    'Jot down reminders and important details — available on every device',
  '+ บันทึกใหม่': '+ New note',
  บันทึกใหม่: 'New note',
  แก้ไขบันทึก: 'Edit note',
  ลบบันทึก: 'Delete note',
  ยังไม่มีบันทึก: 'No notes yet',
  'กด “บันทึกใหม่” เพื่อเริ่ม': 'Use “New note” to start',
  หัวข้อ: 'Title',
  เนื้อหา: 'Body',
  'เช่น สั่งชีสเพิ่ม': 'e.g. order more cheese',
  กรุณาใส่เนื้อหา: 'Please enter some content',
  ปักหมุด: 'Pin',
  เลิกปักหมุด: 'Unpin',
  '(ไม่มีหัวข้อ)': '(untitled)',
  'ลบ "{title}" ?': 'Delete “{title}”?',
  'ค้นหาบันทึก…': 'Search notes…',

  // ---- settings ----------------------------------------------------------------
  'คลัง / สาขา': 'Locations',
  ผู้ใช้งาน: 'Users',
  ดูแลข้อมูล: 'Data maintenance',
  'การเชื่อมต่อ Cloud': 'Cloud connection',
  'การจัดการคลัง ผู้ใช้ และข้อมูล ต้องเป็นสิทธิ์ผู้ดูแลระบบ (Admin)':
    'Managing locations, users and data requires administrator access',
  เพิ่มคลัง: 'Add location',
  แก้ไขคลัง: 'Edit location',
  ลบคลัง: 'Delete location',
  'ชื่อคลัง/สาขา': 'Location name',
  ใส่ชื่อคลัง: 'Enter a location name',
  'คลังหลัก (Warehouse)': 'Warehouse',
  'สาขา (Branch)': 'Branch',
  'ลบ "{name}" ? ยอดคงเหลือของคลังนี้จะถูกลบด้วย (ประวัติยังอยู่)':
    'Delete “{name}”? Its balances are removed too (history is kept).',
  เพิ่มผู้ใช้: 'Add user',
  เพิ่มผู้ใช้แล้ว: 'User added',
  ลบผู้ใช้: 'Delete user',
  ลบผู้ใช้แล้ว: 'User deleted',
  สร้างผู้ใช้: 'Create user',
  'สร้างไม่สำเร็จ:': 'Could not create:',
  สิทธิ์: 'Role',
  ผู้ดูแล: 'Admin',
  'ผู้ดูแล (จัดการทั้งหมด)': 'Admin (full access)',
  'พนักงาน (รับ/เบิก/ดู)': 'Staff (receive / issue / view)',
  เปิดใช้: 'Enable',
  ปิดใช้: 'Disable',
  'บัญชีที่ถูกถอนสิทธิ์': 'Revoked accounts',
  'บัญชีเหล่านี้เข้าระบบไม่ได้และสมัครใหม่ด้วยอีเมลเดิมไม่ได้ จนกว่าจะคืนสิทธิ์':
    'These accounts cannot sign in, and cannot sign up again with the same email, until their access is restored',
  'คืนสิทธิ์': 'Restore access',
  'คืนสิทธิ์แล้ว — ผู้ใช้ต้องขอสิทธิ์เข้าใช้งานใหม่อีกครั้ง':
    'Access restored — the user needs to request access again',
  'คืนสิทธิ์ไม่สำเร็จ:': 'Could not restore access:',
  'กรอกชื่อ อีเมล และรหัสผ่าน (≥6 ตัว)': 'Enter a name, email and password (6+ characters)',
  'ลบผู้ใช้ "{name}" ? ผู้ใช้นี้จะเข้าระบบไม่ได้อีก แม้จะสมัครใหม่ด้วยอีเมลเดิม (ประวัติการทำรายการที่ผ่านมายังคงอยู่)':
    'Delete user “{name}”? They will no longer be able to sign in, even if they sign up again with the same email (their past activity is kept).',
  คำนวณยอดคงเหลือใหม่: 'Recalculate balances',
  'ตรวจความสอดคล้องของยอด': 'Check balances against history',
  'กำลังตรวจ...': 'Checking...',
  'ผลตรวจความสอดคล้องของยอด': 'Balance consistency check',
  'เทียบยอดคงเหลือที่เก็บไว้กับผลรวมจากประวัติ ประวัติคือข้อมูลจริงเสมอ — ระบบตรวจเจอและซ่อมได้ แต่ป้องกันการแก้ยอดตรง ๆ ไม่ได้บนแพ็กเกจฟรี':
    'Compares each stored balance with the total from the movement history. The history is always the truth. This finds and repairs disagreements — it cannot prevent someone editing a balance directly, which would need a paid plan.',
  'ยอดคงเหลือตรงกับประวัติทุกรายการ': 'Every balance matches the history',
  'พบ {count} รายการที่ไม่ตรง — กด “คำนวณยอดคงเหลือใหม่” เพื่อซ่อมจากประวัติ':
    '{count} balance(s) disagree with the history — use “Recalculate balances” to rebuild them',
  'ยอดที่เก็บไว้': 'Stored',
  'ยอดตามประวัติ': 'From history',
  'แก้ล่าสุดโดย': 'Last written by',
  '(สินค้าถูกลบไปแล้ว)': '(product was deleted)',
  '(ไม่ระบุ)': '(not recorded)',
  'แสดง 50 รายการแรกจาก {count}': 'Showing the first 50 of {count}',
  'คำนวณใหม่ไม่ได้: ประวัติทำให้ยอดติดลบ {count} รายการ (เช่น {example}) — ตรวจรายการที่ถูกยกเลิกก่อน':
    'Cannot recalculate: the history adds up to a negative balance in {count} place(s) (for example {example}) — check the voided movements first',
  คำนวณยอดคงเหลือใหม่จากประวัติเรียบร้อย: 'Balances recalculated from history',
  '“คำนวณยอดคงเหลือใหม่” จะสร้างยอดคงเหลือจากประวัติการเคลื่อนไหวทั้งหมด (ใช้เมื่อสงสัยว่ายอดไม่ตรง)':
    '“Recalculate balances” rebuilds every balance from the full movement history — use it if a number looks wrong.',
  นำเข้าแคตตาล็อกสินค้า: 'Import product catalogue',
  'นำเข้าแคตตาล็อกสินค้า + คลังเริ่มต้น? (ข้ามถ้ามีข้อมูลอยู่แล้ว)':
    'Import the product catalogue and default locations? (Existing data is skipped.)',
  'นำเข้าสินค้า {products}, คลัง {locations}':
    'Imported {products} products, {locations} locations',
  เชื่อมต่อแล้ว: 'Connected',
  'เชื่อมต่อ Firebase project:': 'Connected to Firebase project:',
  ตัดการเชื่อมต่อ: 'Disconnect',
  'ตัดการเชื่อมต่อ Cloud': 'Disconnect from Cloud',
  'กลับไปใช้โหมดในเครื่อง? ข้อมูลบน Cloud ยังอยู่ แต่เครื่องนี้จะไม่ซิงก์':
    'Switch back to local mode? Cloud data is kept, but this device will stop syncing.',
  'บันทึกแล้ว กำลังเชื่อมต่อ Cloud...': 'Saved — connecting to Cloud…',
  'อ่านค่า config ไม่ได้ — วางทั้งอ็อบเจกต์ firebaseConfig':
    'Could not read that config — paste the whole firebaseConfig object',

  // ---- line builder / qty input -----------------------------------------------
  'ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่มสินค้า': 'No items yet — search above to add one',
  'ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า)': 'Search a product to add (name / SKU)',
  เลือกหน่วยที่กรอก: 'Entry unit',
  'กรัม (g)': 'Grams (g)',
  'มล. (ml)': 'Millilitres (ml)',
  ลิตร: 'Litres',

  // ---- stock service errors ----------------------------------------------------
  ตั้งยอดคงเหลือ: 'Set balance',
  จำนวนต้องไม่ติดลบ: 'Quantity cannot be negative',
  รายการนี้ถูกยกเลิกแล้ว: 'This movement has already been voided',
  ไม่มีรายการสินค้า: 'No items',
  'สต๊อกไม่พอ (คงเหลือ {qty} {unit})': 'Not enough stock (on hand {qty} {unit})',
  'สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit})':
    'Not enough stock for “{name}” (on hand {qty} {unit})',
  'แก้ไขไม่ได้: สต๊อกต้นทางจะติดลบ': 'Cannot edit: the source balance would go negative',
  'แก้ไขไม่ได้: สต๊อกปลายทางจะติดลบ': 'Cannot edit: the destination balance would go negative',

  // ---- import from Excel -------------------------------------------------------
  'นำเข้า Excel': 'Import Excel',
  'นำเข้าสต๊อกจาก Excel': 'Import stock from Excel',
  'ลงยอดนับจากไฟล์สต๊อกคงเหลือรายเดือน': 'Post counts from the monthly closing-stock file',
  เริ่มใหม่: 'Start over',
  '1. เลือกไฟล์': '1. Choose a file',
  'ไฟล์ .xlsx ที่มีคอลัมน์ Quantity/Unit ต่อสาขาต่องวด':
    'An .xlsx with Quantity/Unit columns per location per count',
  'เลือกไฟล์ Excel': 'Choose an Excel file',
  เลือกไฟล์อื่น: 'Choose a different file',
  'ไฟล์นี้ไม่มีชีตที่อ่านเป็นใบสต๊อกคงเหลือได้': 'No sheet in this file reads as a stock sheet',
  '2. ตรวจการจับคู่': '2. Check the matching',
  'ระบบเดาให้จากหัวตารางแล้ว — ตรวจก่อนนำเข้า':
    'Guessed from the sheet headings — check before importing',
  'ไฟล์นี้มี {n} ชีต': 'This file has {n} sheets',
  ชีตที่จะนำเข้า: 'Sheet to import',
  'นำเข้าได้ทีละแบรนด์ — ชีตของอีกแบรนด์ต้องสลับแบรนด์ก่อนแล้วนำเข้าอีกครั้ง':
    'One brand at a time — for the other brand, switch brand and import again',
  คอลัมน์สาขา: 'Location columns',
  '— ไม่นำเข้า —': '— do not import —',
  งวดที่นับ: 'Counting dates',
  'วันที่นับของงวด {label}': 'Counting date for {label}',
  'งวดที่ไม่มีวันที่ในหัวตารางจะเดาไม่ได้ ต้องใส่เอง — ยอดนับจะบันทึกตามวันที่นี้':
    'A heading with no readable date has to be filled in — counts are recorded on this date',
  '3. สรุปก่อนนำเข้า': '3. Summary before importing',
  'ตัวเลขนี้คือสิ่งที่จะถูกบันทึกจริง': 'These are the numbers that will actually be written',
  จะบันทึก: 'To be written',
  ข้ามไว้: 'Skipped',
  'นำเข้า {n} รายการ': 'Import {n} counts',
  'กำลังนำเข้า {done}/{total}': 'Importing {done}/{total}',
  ดาวน์โหลดรายการที่ข้าม: 'Download skipped rows',
  'เริ่มนำเข้า?': 'Start the import?',
  'จะบันทึกยอดนับ {n} รายการ ที่ {locations} คลัง ลงในสต๊อก — ระบบจะบันทึกเป็นการปรับยอด (ยอดยกมา) ตามวันที่ของแต่ละงวด':
    'Writes {n} counts across {locations} locations. Each is recorded as an opening-balance adjustment, dated to its own count.',
  'นำเข้าจากไฟล์ {file}': 'Imported from {file}',
  'นำเข้าสำเร็จ {n} รายการ': 'Imported {n} counts',
  'นำเข้าเสร็จแต่มี {n} รายการที่ล้มเหลว': 'Import finished with {n} failures',
  ผลการนำเข้า: 'Import result',
  สำเร็จ: 'Done',
  มีรายการล้มเหลว: 'Some failed',
  ลงบัญชีแล้ว: 'Written',
  ยอดตรงอยู่แล้ว: 'Already matched',
  ล้มเหลว: 'Failed',
  ยังไม่ได้เลือกไฟล์: 'No file chosen yet',
  'ไฟล์สต๊อกคงเหลือรายเดือนใช้ได้เลย ไม่ต้องแก้รูปแบบ — ระบบอ่านหัวตารางเองว่าคอลัมน์ไหนเป็นสาขาไหน งวดไหน':
    'The monthly closing-stock file works as it is. The headings tell the system which column is which location and which count.',
  เฉพาะผู้ดูแลระบบ: 'Administrators only',
  'การนำเข้าเขียนทับยอดคงเหลือทุกคลังในไฟล์ จึงจำกัดไว้ที่ผู้ดูแลระบบ':
    'An import rewrites balances at every location in the file, so it is limited to administrators',
  แถว: 'Row',
  'แถวใน Excel': 'Excel row',
  รหัส: 'Code',
  ขนาดบรรจุ: 'Pack size',
  สาเหตุ: 'Reason',
  'จำนวนช่องที่ข้าม': 'Cells skipped',
  ตำแหน่ง: 'Where',
  รายละเอียด: 'Detail',
  รหัสสินค้าไม่มีในระบบ: 'Code not in the system',
  ไม่มีรหัสสินค้า: 'No product code',
  'มีรหัสซ้ำในงวดและคลังเดียวกัน': 'Counted twice at one place on one date',
  สินค้าถูกปิดใช้งาน: 'Product is disabled',
  จำนวนติดลบ: 'Negative quantity',
  'อ่านจำนวนไม่ได้': 'Quantity is not a number',
  'รหัสต้องมาจากไฟล์รหัสสินค้าของบริษัท ระบบจะไม่สร้างรหัสใหม่เอง':
    'Codes come from the company item-code file. Nothing here invents one.',
  'แถวพวกนี้เป็นของระหว่างผลิต (WIP) ที่ยังไม่มีรหัสในไฟล์รหัสสินค้า':
    'These are work-in-progress rows with no code in the item-code file yet.',
  'ไฟล์ไม่ได้บอกว่าเป็นของกองเดียวกันหรือคนละกอง — รวมกันก็เกิน เอาอันเดียวก็ขาด':
    'The file does not say whether this is one pile listed twice or two. Adding them overstates; keeping one loses the other.',
  'สินค้าถูกปิดใช้งานไว้ ระบบจะไม่เปิดกลับมาเองจากการนำเข้า':
    'The product is disabled. An import will not quietly bring it back.',
  'ยอดคงเหลือติดลบไม่ได้': 'A balance cannot be negative.',
  'ช่องนั้นไม่ใช่ตัวเลข': 'That cell is not a number.',
  'หน่วยในไฟล์ไม่ตรงกับแคตตาล็อก': 'Unit on the sheet differs from the catalog',
  'ยอดจะถูกบันทึกด้วยหน่วยของแคตตาล็อก ถ้าหน่วยต่างกันจริง จำนวนจะผิด':
    'Counts are recorded in the catalog unit. Where the units really differ, the number is wrong.',
  ไฟล์: 'Sheet',
  ระบบ: 'System',
  'มีความเคลื่อนไหวหลังวันที่นับแล้ว': 'Stock has moved since that count',
  'ยอดนับจะตั้งยอดคงเหลือเป็นตัวเลขนั้น "ทันที" ไม่ว่าลงวันที่อะไร — ถ้าของขยับไปหลังวันนับ การลงย้อนหลังจะลบความเคลื่อนไหวที่เกิดทีหลังออกจากยอด':
    'A count sets the balance to its figure immediately, whatever date it carries. If stock moved after the count was taken, posting it would erase everything that happened since from the balance.',
  '— มีรายการเคลื่อนไหว {date}': '— movement on {date}',
  '— นับไว้แล้ว {date}': '— counted {date}',
  'ชีต "{sheet}" ไม่มีหัวตาราง Quantity/Unit — ไม่ใช่ใบสต๊อกคงเหลือ':
    'Sheet “{sheet}” has no Quantity/Unit heading — it is not a stock sheet',
  'ชีต "{sheet}" ไม่มีแถวชื่อสาขาและงวดอยู่เหนือหัวตาราง':
    'Sheet “{sheet}” has no location and count rows above its heading',
  'ชีต "{sheet}" มีหัวตารางแต่ไม่มีชื่อสาขาหรือชื่องวด':
    'Sheet “{sheet}” has a heading but no location or count names',

  // ---- install on the home screen ----------------------------------------------
  ติดตั้งลงหน้าจอโฮม: 'Add to home screen',
  'กดปุ่มแชร์ในแถบล่าง แล้วเลือก "เพิ่มไปยังหน้าจอโฮม"':
    'Tap Share in the bottom bar, then “Add to Home Screen”',
  'เปิดเร็วกว่า เต็มจอ และไม่ต้องหาแท็บ': 'Opens faster, full screen, no hunting for a tab',
  ติดตั้ง: 'Install',

  // ---- demo build --------------------------------------------------------------
  โหมดสาธิต: 'Demo mode',
  'ลบข้อมูลในเครื่องนี้ทั้งหมด แล้วตั้งค่าใหม่: ผู้ดูแล 1 คน, คลังทั้งสองแบรนด์, และแคตตาล็อกสินค้า':
    'Wipes everything on this device and sets it up again: one admin, both brands’ locations, and the product catalogs',
  รีเซ็ตข้อมูลเดโม: 'Reset demo data',
  'กำลังเตรียม...': 'Setting up…',
  'เข้าสู่ระบบอัตโนมัติ — บัญชี {email} รหัส {password}':
    'Signs in automatically — account {email}, password {password}',
  'รีเซ็ตข้อมูลเดโมได้เฉพาะในโหมดสาธิตเท่านั้น': 'Demo data can only be reset in a demo build',

  // ---- shell: top bar, shared table ---------------------------------------------
  'ค้นหาสินค้า หรือรหัสสินค้า…': 'Search a product or code…',
  'สินค้าใกล้หมด ({n} รายการ)': 'Low stock ({n} items)',
  'ตาราง {n} แถว': 'Table, {n} rows',

  // ---- dashboard (rebuilt) ------------------------------------------------------
  '{n} รายการมีของ': '{n} in stock',
  'ความเคลื่อนไหว 7 วัน': 'Movements, 7 days',
  'ล่าสุด {date}': 'Last {date}',
  ยังไม่มีรายการ: 'Nothing yet',
  คลังสินค้า: 'Locations',
  ที่เลือก: 'Selected',
  รายการที่มีของ: 'Items in stock',
  ยังไม่มีมูลค่า: 'No value yet',
  สินค้าใกล้หมด: 'Running low',
  'ไม่มีรายการที่ต่ำกว่าขั้นต่ำ': 'Nothing below its minimum',

  // ---- language switch -----------------------------------------------------------
  'เปลี่ยนเป็นภาษาอังกฤษ': 'Switch to English',
  'เปลี่ยนเป็นภาษาไทย': 'Switch to Thai',
  'เซิร์ฟเวอร์ทดสอบนี้ต่อกับข้อมูลจริง — ใช้ npm run demo':
    'This dev server is connected to live data — use npm run demo',
}
