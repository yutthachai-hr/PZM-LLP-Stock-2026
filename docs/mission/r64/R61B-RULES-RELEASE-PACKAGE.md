# R61-B — Production Rules-only Release Package

24 ต.ค. 2026 · **เตรียมเท่านั้น ไม่ได้รับอนุมัติ deploy/merge**.

## Verified identity / backup

- Firebase CLI selected account: `yutthachai@pizzamania.com`; existing reauth ใช้งานได้ ไม่ login ซ้ำ.
- Official Firebase API ยืนยัน `projectId=pzm-stock-x5`, projectNumber `789071579161`, state ACTIVE.
- Production static artifact `https://pzmstock.pages.dev/assets/app-CoF6YBUt.js` มี
  `projectId:"pzm-stock-x5"`; SHA256 `f6d3d8d8d05cae09498b6289503f30b3928470e7150424ab4a34e48445b144e6`.
  ไม่เปิด app JavaScript/Firestore subscription; ไม่ตรวจ localStorage override ของเครื่อง Owner.
- Live release: `projects/pzm-stock-x5/releases/cloud.firestore`.
- Ruleset: `projects/pzm-stock-x5/rulesets/80b1cd17-4388-4d49-8b91-31b58ed459a7`.
- Release create `2026-07-16T02:31:58.995356Z`; update `2026-10-08T07:00:45.266800Z`.
- Ruleset create `2026-10-08T07:00:41.351791Z`; fetched `2026-10-24T09:18:14.826Z`.
- Raw live source: `live-rules/0-firestore.rules`, 93,662 bytes (CRLF), SHA256
  `eee07cf82bc0b187cd1c9bd43afa2bf8090fd3b5006dd5415d25fa53aaec22b2`.
- Raw official response และ metadata อยู่ใน `live-rules/release.json`, `ruleset.json`, `metadata.json`.
- สำรอง package แยกอีกชุดที่ `C:/Users/Yutthachai/r64-backup/r61b-rules-package-20261024.tgz`,
  SHA256 `d41dc84033bc0436a8c6ef8dd056911a30d92bcc4e6550e86a7e197d072de660`.
  Raw artifacts อยู่ local ไม่ใส่ใน Git เพื่อไม่ให้ line-ending conversion เปลี่ยน bytes.
- Rollback copy `rollback/firestore.rules` hash ตรง raw live source; มี Rules-only `firebase.json`.

## Live comparison / proven defect

Normalize เฉพาะ CRLF/LF: live ตรง origin/main `312f8a7dc60556eb506f59ff5a58d9b4c1d5ce55`
ทุกบรรทัด จึง **ไม่พบ Console-only semantic changes** ที่ต้อง merge เพิ่ม.
Normalized live hash `bdc5bfad4b76b60d73f9a7a46fbb4150350cbf6063a3b926b3adb6280113dba8`.
Live `validLocation()` ยังรับแค่ warehouse/branch; deployed validator mismatch **ยืนยันแล้ว**.
การ replay raw live Rules ใน Emulator ปฏิเสธ active Admin transit-create ของทั้งสามแบรนด์:
RED9/14 (รวมการทดสอบ canonical invariant ใหม่); log `live-rules-transit-red.log`.
ไม่ได้ replay denied write ใน Production หรืออ่าน actual Owner app-role/profile จึงไม่อ้างว่าได้
ตรวจ production request trace/active Admin runtime ครบทุกปัจจัยของ incident.

## Exact candidate / tests / review

- PR54 reviewed HEAD: **`01bb12cdf56334406d256bbf5462f9a5aeae26f0`**.
- Rules-only source เหมือน Rules commit `feb3c9c`; candidate เป็น exact Git blob จาก HEAD ข้างต้น.
- `candidate/firestore.rules` SHA256:
  **`ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270`**.
- Diff ต่อ live มีเพียง comment2บรรทัดและ validator:

```diff
- && d.type in ['warehouse', 'branch']
+ && (d.type == 'transit' || (d.type in ['warehouse', 'branch'] && d.id != 'transit'))
```

- Admin-only create/update, active-user check, schema keys, name/date validation ไม่เปลี่ยน.
- Imported transit id อื่นยังรองรับ; canonical transit ผิด type ถูกบล็อกจน Adminซ่อม type.
- ไม่มี stock movement/balance change และไม่มี PR51 void fields/validators รวมใน candidate.
- Full Rules suite รันใหม่บน exact HEAD: **251/251**, budget + transfer workflow ผ่าน.
- Transit regression **14/14**: Pizza/LeLapin/R&D, repeated enable, manager/staff/inactive/unauth,
  invalid schema, canonical wrong type/repair, imported location, warehouse/branch parity.
- Exact-head CI **10/10 SUCCESS**.
- Prior Gemini independent review ของ exact code: APPROVE_WITH_NITS (P3 ไม่ block release).
- R64 Agent01 security review **APPROVE** บน exact candidate + backed-up live source.
  แยก port8082 rerun transit14/14, Rules/workflow240/240 และ status5/5; agent ไม่รวม PagesFunction
  REST emulator11casesที่มี lock-timeout. MAIN full exact-head suite251/251ข้างต้นผ่านครบ ไม่ตัดtest.
  Review report local commit `433804d` ใน worktree `t3-1322da1e`; source candidateไม่เปลี่ยน.

PR51 `634edd7` มี transit fix แล้ว แต่มี void security changes เพิ่ม ต้อง approval แยก **ห้ามใช้เป็น
candidate รอบนี้**. PR1/G25 transition Rules ยังต้อง port transit invariant ก่อน extraction deploy.

## Read-only preflight

จาก repository root:

```sh
node docs/mission/r64/verify-rules-package.cjs
```

ผล PASS: exact Git candidate / raw rollback / project / Rules-only config hashes ตรง.
Script ไม่มี network write หรือคำสั่ง deploy. ไฟล์ release artifacts เป็น local evidence ต้องเก็บ
raw bytes ไว้ (อย่าให้ Git line-ending conversion เปลี่ยน rollback source).

## Rules-first release — หลัง Owner อนุมัติเท่านั้น

1. Re-read live release ID ก่อนปล่อย: ถ้าขยับจาก `80b1cd17...` หรือ hashเปลี่ยน ให้ HOLD, backup และ
   compare ใหม่ ห้ามทับ Console/security changes ที่เกิดระหว่างรอ approval.
2. ตรวจ candidate hash ข้างต้น, exact reviewed SHA/CI และ rollback พร้อมอีกครั้ง.
3. คำสั่งที่เตรียมไว้ **ยังไม่ได้รัน** (run จาก repository root):

```sh
npx --no-install firebase deploy --only firestore:rules --project pzm-stock-x5 --config docs/mission/r64/candidate/firebase.json
```

4. Read Rules API release ใหม่/เก็บ ID/time/hash และ compare active source กับ candidate.
5. ยืนยัน Admin transit permission โดย Rules test/synthetic authorization ที่ไม่แก้ stock ก่อน;
   การ enable จริงเขียนเฉพาะ canonical location ต้องอยู่ใน approval scope. ห้าม approve/receive
   transfer จริงเพื่อ smoke และห้ามใช้ Admin SDK bypass Rules เป็นหลักฐาน client authorization.
6. Rules gate ผ่านแล้วจึงเตรียม **app merge PR54 ที่อนุมัติแยก**; merge main จะ auto-deploy Pages.
7. Verify Production app SHA/assets และ Settings/Logistics smoke; roles อื่นยังปฏิเสธ.

## Rollback — prepared, not executed

ถ้า candidate fail ให้หยุด app merge และกลับไป raw live backup ตาม approval/rollback window:

```sh
npx --no-install firebase deploy --only firestore:rules --project pzm-stock-x5 --config docs/mission/r64/rollback/firebase.json
```

หลัง rollback ต้องอ่าน API ยืนยัน source hashเดิม; metadata ruleset ID ใหม่อาจต่างแม้ sourceเดิม.
ไม่ลบ transit documents/ไม่ย้อน stock เพราะรอบเตรียมนี้ไม่มี production document writes.

**RULES RELEASE: READY_FOR_OWNER_APPROVAL.** Auth/project/backup/diff/tests/securityreview/rollback gatesผ่าน.
**OWNER APPROVAL REQUIRED:** Production Firestore Rules-only deploy ของ PR54 SHA/candidate hashข้างต้น.
ข้อความ R61-B/R64 ไม่ใช่ approval. ไม่รวม PR51 Rules หรือ app merges อื่น.
