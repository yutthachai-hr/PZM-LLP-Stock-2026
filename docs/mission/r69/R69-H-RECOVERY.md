# R69-H — 502 recurrence / preserve-first bounded recovery

24 ต.ค.2026 · Companion: `../r70/R70-CONCURRENCY-REPORT.md`

## Confirmed

1. Agent01 round1 ล้มระหว่างautomaticcompaction ctx165420, 15:39:09.846–15:40:36.369Z (86,523ms ตามmetadataในเครื่อง)
2. Agent02 round1 ล้มระหว่างautomaticcompaction ctx168453, 16:03:00.118–16:04:25.222Z (85,104ms)
3. ทั้งคู่error`provider.internal`, status502; ไม่พบ surfaced429 ในR69ที่ตรวจ
4. งานGeminiอื่นสำเร็จในช่วงเดียวกัน; 9Routerprocessยังอยู่ `/v1/models`ตอบได้ในdiagnosticก่อนหน้า — ไม่ใช่หลักฐานว่าทุกinferenceสำเร็จ
5. 9RouterusageHistoryเก็บsuccessอย่างเดียว; exactfailedrequestexceptionไม่อยู่ในนั้นหรือOpenCodemetadata

## Unknown / suspected

- ExactupstreamHTTPexception/timeout/socket/cancellationต้นเหตุ **UNKNOWN**. Compactionคือphaseที่เห็นล้ม ไม่ใช่คำอธิบายครบว่าทำไม502
- พบimplementationpathที่9Routerสร้าง502เมื่อexecutorเกิดnon-abortexceptionก่อนresponse แต่ไม่มีrequesttraceเชื่อมสองrequestนี้กับexceptionเฉพาะตัว จึงห้ามอ้างว่าGoogleส่ง502หรือว่าtimeoutถูกพิสูจน์แล้ว
- เวลาประมาณ85–87secเป็นlocalcompactioninterval ไม่ใช่HTTPwirelatency
- ไม่มีหลักฐานว่าเพดานconcurrency7ทำให้502; Agent01ล้มก่อนเปิด7อยู่แล้ว และmodelrequests7พร้อมกันพิสูจน์ได้ภายหลัง

## Agent01 — preserve/recoverครั้งเดียว

- ก่อนกู้: copyuntracked25KBcontracttest ไป`C:/Users/Yutthachai/r64-backup/r69-agent01-502/` (SHA256prefix`a54f08ae0e7b01f3`); commitWIP`0d38dee`
- Sessionใหม่ `r69-agent01-round2`, worktree`t3-81117abc`; ไม่ใช้ประวัติยาวเดิม
- แก้testvacuity (`?? '/requests'`และepochไม่เกิดcutoff/weekly), เพิ่มOwnerTR-00001legacyrepro; mutationสองตัวต้องFAIL
- ผล`1651548`: focused119/browser18ผ่าน; separate-agentreview`410429f`APPROVE
- MAINตรวจ`src/`ไม่เปลี่ยนจากPR55เดิม`94ff0bc`, rerun119ผ่าน และpushPR55แบบfastforward ไม่มีProductionmerge/deploy

## Agent02 — preserve/recoverครั้งเดียว

- ก่อนกู้: RED`a529814`, GREEN`8e9108e`commitไว้แล้ว; `git status`สะอาด patchbackupว่าง (SHA256empty`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`)
- ไม่มีunstagedsourceสูญหาย ไม่redoGREENcommit
- Sessionใหม่ `r69-agent02-round2`, worktree`t3-906a8bea`; เริ่มจาก8e9108eและทำเฉพาะverification/E2E/evidence/report
- `aac5879`เพิ่มE2Eและภาพ1440/390, doc`3b32f1b`; `git diff 8e9108e..3b32f1b -- src`ว่าง
- ผลfocused34/full1748/e2e1/tsc/lint/i18n/buildผ่าน; ยังไม่financialAPPROVEเพราะresolverreviewพบbugภายหลัง
- แก้resolverเป็นงานboundedbugfixใหม่ตามfindings ไม่ใช่retrycompaction/reimplementationของUI ไม่มีrecoveryรอบ3

## Circuit breaker / configuration

- Max1controlledrecoveryต่อfailedtaskตามOwner; รอบ2ของทั้งคู่สำเร็จ ไม่มีloopretry
- ไม่restart9Router/rotatecredentials ไม่เปิดAutoDispatch/HybridFailover ไม่ลด7กลับ2เพราะfailureเฉพาะsession
- OpenCode2.1.4มีtop-levelcompaction.auto แต่ยังไม่ยืนยันT3worker-onlyก่อนstart; **ไม่มีconfigurationchange**
- ไม่ตั้งglobal/project`auto:false`, ไม่แก้MAINPi/runtimepermissions
- ใช้shortbrief, selectivefilelines, localRED/GREENcheckpoint, แยกrolesและfreshreviews; วิธีนี้ลดความเสี่ยง ไม่อ้างแก้ถาวร

## Provenance correction

Compactedhandoffใส่fullSHAของresolvercontract/GREENไม่ตรงgitobjects. ตรวจจริงแล้วcontractคือ`934cbfaa05f1c8b97a12e70a8d2a1490b34cebf8`, GREENคือ`70db1b775c4baa12d11a26928d596aaaf03e0fcf`. Reviewerใช้source934cbfaจริงถูกต้อง; ไม่กล่าวหาว่าreviewsourceผิดจากhashที่คลาดเคลื่อนในhandoff. ใช้`checkpoints.json`เป็นcanonicalGitledger

## Evidence/skill

- `../r70/compaction-failure-evidence.json` และread-onlyscriptที่ไม่อ่านprompt/credentialtable
- `../r70/concurrency-detailed.json`: modelphaseตัดtoolsออก; snapshotเก่าที่รวมtoolsมีannotationว่าสuperseded
- MAINอ่านsystematic-debugging/tdd/show-me-your-workในsession; แยกconfirmed/suspected, เก็บWIPก่อนกู้, ตรวจdiffจริง
- ข้ามlivefaultinjection/forbiddenmodelhealthprobe/Productionwritesเพราะไม่จำเป็นและไม่ได้รับอนุมัติ
