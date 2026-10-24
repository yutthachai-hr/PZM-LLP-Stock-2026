# R70 — Hosted concurrency 7 ตัวจริง + R69-H recovery

วันที่ 24 ต.ค. 2026 · MAIN Pi Claude · ทุก child ใช้ `opencode / 9router/gemini-3.8-flash-high`

## 1. Effective concurrency ก่อน/หลัง

- ก่อน: MAIN จำกัดการ dispatch ไว้ 2 hosted ตามคำสั่ง Owner เดิม ไม่ใช่ค่า runtime ที่พบว่าเป็น 2
- หลัง R70: **7 hosted** ผ่าน explicit T3 delegation; แยก worktree ทุกตัว ไม่เปิด Auto Dispatch / Hybrid Failover
- **ไม่มี configuration ใดถูกเปลี่ยน**: ไม่พบความจำเป็นต้องเปลี่ยนเพื่อให้ถึง 7; ไม่เดาชื่อ config key
- Native T3 permissions เดิม; ไม่สร้าง/เปิด custom guard; ไม่เปลี่ยน MAIN/provider credentials และไม่ restart 9Router

## 2. หลักฐาน concurrency ที่วัดจริง

**สถานะ: `REQUEST_LIFECYCLE_7_VERIFIED`; `UPSTREAM_7_INFERENCE_UNVERIFIED`.** ไม่สวมว่าการมี7localrequestlifecyclesพิสูจน์ว่าGoogleเริ่มประมวลผล7งานพร้อมกัน ถ้าเกณฑ์R70หมายถึงupstreamexecutionจริงโดยเคร่งครัด ข้อนั้นยังไม่ปิด

Artifact: `concurrency-detailed.json` (read-only OpenCode SQLite + 9Router usageHistory)

| สิ่งที่วัด | ผล |
|---|---|
| Seven T3 child tasks | ทุกตัว accepted เป็น `running/working` โดย explicit target Gemini |
| Peak sessions มี model request ค้างพร้อมกัน (ตัดช่วงทำtoolsออก) | **7** ที่ **15:59:49.755Z** (22:59:49 น. กรุงเทพฯ) |
| Conservative token-emission overlap | **4** ที่ **16:04:09.612Z** — earliest content-part.created ถึง end-of-stream |
| Peak in-flight local model requests | **7** (`assistant.time.created`→`time.streamed`; streamedคือจบstream ไม่ใช่firsttoken) |
| งานซ้อนเวลากันครบ7 | 01รอบ2 + 02รอบ1 + 03รอบ2 + 04 + 05 + 06 + 07 |
| Queue | ไม่พบ T3 task ค้าง queued ใน snapshot ที่ตรวจ; ไม่มีตัวเลข queue ภายใน 9Router/Google ให้ยืนยันว่าเป็น 0 |
| Provider ceiling | พิสูจน์7in-flightlifecyclesฝั่งOpenCode; **ไม่ทราบเพดาน/queue/executionconcurrencyภายในGoogle** |

เวลาจบราย session, start/end ISO, worktree และ counters อยู่ใน JSON พร้อม `peakRequestEvidence` เจ็ดrequestที่คร่อมเวลาเดียวกัน ไม่ใช่นับจำนวน assignments แล้วอ้าง PASS. จุดpeakแรกมีcommoninterval **15:59:49.755–49.809Z (54ms)**; เป็นpeakของOpenCodemodel-requestlifecycle ไม่ใช่หลักฐานว่าmaintain7ตลอดเวลา หรือpackettraceของ7requestที่Googleเริ่มประมวลผลพร้อมกัน (ช่วงก่อนfirsttokenอาจมีqueue/setupอยู่)

**แก้ไขวิธีวัดอย่างเปิดเผย:** snapshotแรก `concurrency-snapshot-1601Z.json` ใช้created→completed ซึ่งรวมเวลาทำtools จึงถูก supersede โดย `concurrency-detailed.json` ที่ใช้created→streamed หลังตรวจtimeของcontent/toolจริงแล้ว ตัวเลข15:59:47Zเดิมเป็นsession/tool-inclusive overlap ไม่ใช่exactmodel-onlypeak ส่วนstreamed→completedเป็นช่วงหลังmodelstreamจบ ไม่ใช่ช่วงtokenstreaming จึงถอนข้อสรุป"7tokenstreamsพร้อมกัน"ที่เคยคำนวณระหว่างเตรียมรายงาน หลักฐานที่ถูกต้องคือ7in-flight modelrequests, 4conservativeemissionwindows; ไม่ได้พิสูจน์7GPUexecutionsภายในGoogleซึ่งมองไม่เห็น
การเพิ่ม concurrency ไม่อนุมัติ merge/deploy/Production writes ใด ๆ

## 3. Agent/worktree checkpoints

ทั้งหมดอยู่ใต้ `C:/Users/Yutthachai/.t3/worktrees/PZM-LLP-Stock-2026/`:

| Agent | Worktree | Source/checkpoint | ผลที่มี ณ snapshot |
|---|---|---|---|
| 01 r1 | `t3-4bfeb92a` | partial test เก็บเป็น `0d38dee` | 502, กู้ไฟล์ครบ |
| 01 r2 | `t3-81117abc` | `1651548` | สำเร็จ: route contract68, focused119, browser18; reviewแยกกำลังทำ |
| 02 r1 | `t3-2c317f12` | RED`a529814`, GREEN`8e9108e` | 502 แต่ checkpointครบ/worktreeสะอาด |
| 02 r2 | `t3-906a8bea` | `3b32f1b` บน `8e9108e` | สำเร็จ: e2e1/full1748, ภาพ1440/390; sourceไม่เปลี่ยนจากGREEN; reviewUIแยกกำลังทำ |
| 03 r1 | `t3-745cea1a` | RED`2a1e9a6`, GREEN`70db1b7`, doc`934cbfa` | resolver28/full1742ผ่าน |
| 03 r2 | `t3-6092b7bc` | `e1753fe` | consistency14; พบ legacy unit mismatch ต้องแก้ก่อนปล่อยราคา |
| 04 | `t3-59cdc83b` | `2574414` | LINE/A2 packages; browser54ผ่าน |
| 05 | `t3-5a9037de` | `eac2b73` | stock/security matrix; live baseline/transit invariantถูกเก็บ |
| 06 | `t3-8678a854` | `d57be60` (code`acf2949`) | PR24-on-39 รับ PDF3–20MB; focused50/full1764 |
| 07 | `t3-ddc21e9a` | extraction`f5f51ce`, doc`d8293a0` | barcode82; activity wording sliceรอreview |

รีวิว follow-up ไม่ใช่ agent specialization ใหม่: ทุก round มี taskId/clientRequestId แยก และ provider/model ถูกตรวจจากผล T3

## 4. 502/429: แยกหลักฐานจากข้อสันนิษฐาน

Artifact `compaction-failure-evidence.json`:

| Session | เริ่ม compaction | จบด้วย error | เวลาที่สังเกตได้ | ผล |
|---|---|---|---:|---|
| Agent01 r1 | 15:39:09.846Z | 15:40:36.369Z | 86,523 ms | `reason=auto`, `provider.internal`, 502 |
| Agent02 r1 | 16:03:00.118Z | 16:04:25.222Z | 85,104 ms | `reason=auto`, `provider.internal`, 502 |

- **CONFIRMED:** ทั้ง2ล้มระหว่าง automatic compaction; งาน Gemini อื่นสำเร็จพร้อมกัน จึงไม่ใช่หลักฐานว่า route ล่มทั้งหมด
- เวลาข้างบนเป็น interval ของ compaction ในเครื่อง **ไม่ใช่ exact upstream HTTP latency**
- **UNKNOWN:** exceptionต้นทางของสอง request นี้ และ HTTP status ที่ Google เคยส่งหรือไม่ — ไม่ได้เก็บไว้ใน error metadata
- R65 พบ code path ใน 9Router0.5.109 ที่สร้าง502เมื่อ executor throw; เป็นกลไกที่เป็นไปได้ **ไม่ใช่หลักฐานจับคู่ request ว่า throw ตัวไหนจริง**
- 9Router usageHistory บันทึกแต่ success: 1125 `ok` ณ16:28Z (ดูจำนวนล่าสุดในJSON); ห้ามอ้างว่าทุก requestสำเร็จ เพราะ2compactionล้มไม่ได้อยู่ในตารางนี้
- ไม่พบ surfaced429ใน R69 sessions ที่ตรวจ; hidden upstream retries/queue ไม่ทราบ
- ก่อนเพิ่มเป็น7ก็มี502แล้ว (Agent01); หลังเพิ่มมี Agent02ที่context168kล้ม ไม่ได้พิสูจน์ว่า concurrency7เป็นสาเหตุ
- จึง **ไม่ลดกลับเป็น2** จาก errorเฉพาะsession และไม่ restart/rotatecredentials

## 5. Worker-scoped compaction config — UNSUPPORTED ผ่านช่อง dispatch ที่ตรวจ

- Installed OpenCode **v2.1.4**
- Schemaที่ติดตั้ง: top-level `Config.Compaction { auto, keep, buffer }`; ค่า `auto:false` มีจริง
- แต่ `Config.Agent` ไม่มีcompaction; T3 delegate/model optionsที่ตรวจไม่เปิดช่อง session-specific config/env overlay
- Configที่เป็นproject/globalไม่เท่ากับGemini-worker-only; ยังไม่พิสูจน์วิธีให้ T3 ติดตั้ง per-worktree config **ก่อน**เริ่มเฉพาะchildได้อย่างปลอดภัย
- จึง **ไม่แก้ OpenCode global/project config** และไม่แก้ MAIN Pi settings ข้อความนี้ไม่ได้แปลว่า OpenCode ไม่รองรับproject config
- Permanent switch ยัง **NOT APPLIED**; ไม่อ้างว่าป้องกัน502ถาวรแล้ว
- ใช้ bounded fresh sessions, เลือกอ่านเฉพาะช่วงไฟล์, checkpoint RED/GREEN, แยกimplementation/review และกู้เฉพาะงานค้าง
- Circuit breaker: Agent01และAgent02กู้อย่างละหนึ่งครั้งและสำเร็จทั้งคู่ ไม่มีการdispatchrecoveryรอบ3แบบวน

## 6. ไฟล์/commits และสิ่งที่เหลือ

- Sourceของงานที่จบเก็บในlocal commitsตามตาราง; ไม่pushpartial GREENของราคาเป็นrelease-ready
- PR51อัปเดตฐานmainเป็น`876c6d0` (305Rules/1725unit, CI10/10) — ไม่deploy Rules
- Agent03 interface ส่งให้Agent02แล้ว; MAINพบlegacyPackที่ไม่มีbaseQtyอาจแสดงราคา20แทน120 เป็นblockerของราคา ไม่ใช่ปัญหาที่ปล่อยได้
- รับผลrecovery02แล้ว; PR55testcontractreviewAPPROVE`410429f`, MAINรวมและpush`1651548`, 119focusedผ่านซ้ำ, CIexactheadกำลังทำ
- ยังต้องแก้resolverตามCHANGES_REQUESTED`f1b8a0a` (invalidrate/legacyconversion), รับreviewUI/OCR จากนั้นรวมงาน/ตรวจCIตามexactHEAD
- GitตรวจcanonicalSHAของresolvercontractเป็น`934cbfaa05f1c8b97a12e70a8d2a1490b34cebf8` และGREEN`70db1b775c4baa12d11a26928d596aaaf03e0fcf` — fullSHAในcompactedhandoffเดิมไม่ตรงobject; ใช้gitobjectจริงเท่านั้น
- MAINไม่มีProductionwrite/merge/deployใหม่ในR69/R70; OwnerยืนยันReleaseA/Bผ่านแล้ว บันทึกเป็นmanual evidenceในR69 ไม่สวมว่าเป็นautomation

## Skill report (MAIN)

- `principle-prove-it-works`, path `C:/Users/Yutthachai/.agents/skills/principle-prove-it-works/SKILL.md`: loaded yes; ตรวจmetadataจริง, วัดrequestและstream intervals; ไม่ใช้จำนวนtaskแทนconcurrency
- TDD (`.../.agents/skills/tdd/SKILL.md`): loadedในsession; ไม่เพิ่มproductionlogicในงานconcurrency จึงไม่มีRED/GREENสำหรับconfig; scriptsอ่านmetadataอย่างเดียว
- ส่วนที่ยังไม่ได้ตรวจ: hiddenGooglequeue/GPUexecution/เพดานที่มากกว่า7 และ exactupstreamexception; ไม่มีการprobeโมเดลต้องห้าม
