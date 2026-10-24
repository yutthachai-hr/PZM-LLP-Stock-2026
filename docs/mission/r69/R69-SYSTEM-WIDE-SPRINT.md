# R69 — System-wide sprint / integration checkpoint

24 ต.ค. 2026 · Release HOLD ไม่เท่ากับงานหาย · R70 อนุญาต hosted7ตัวแล้ว

## 1. สิ่งที่ Owner ยืนยันแล้ว (manual evidence)

- **Release A PASS:** Adminเปิดใช้งานLogistics/transitได้จริง OwnerยืนยันในR69 ไม่ใช่แค่ผลemulator
- **Release B / PR53 PASS:** เปิดLINEบนมือถือได้จริง OwnerยืนยันในR69 ไม่ขอให้ทดสอบซ้ำ
- Production appที่releaseแล้ว `6045b502171b1639d1e55c0f09e9a910e14ad064`, deployment`b82fd719-972e-44fe-be63-a9b5987f2bda`
- Rulesที่releaseแล้วจากPR54: ruleset`cf5176f9-7cba-4225-80f3-f19fb70824b0`, SHA256`ae39c231c8c1dde879d1bba723275504ef8fb21c05894dd1e6e4335f9ac37270`
- ไม่deployซ้ำ ไม่โยนgateของPR52/57มาปะปนกับOwnerPASSของPR53; ไม่มีmerge/deployหรือProductionbusinesswriteใหม่ในR69/R70

## 2. เจ็ดงาน — ผลจริงและสิ่งที่ยังไม่พร้อม

| Agent / งาน | ผลและsource | Gateถัดไป |
|---|---|---|
| 01 notification/link integrity | failedpartial`0d38dee`เก็บครบ; recovery`1651548`เพิ่มcontract68และTR-00001legacyrepro; 119focused/18browserผ่าน; review`410429f`APPROVE | MAINรวมแบบffและpushPR55แล้ว (`src/`ไม่เปลี่ยน), exactheadCI/Previewต้องตรวจเสร็จก่อนขอrelease |
| 02 Receive pricing UI | RED`a529814`→GREEN`8e9108e`; recovery`3b32f1b`เพิ่มE2E1/ภาพ1440+390; focused34/full1748, tsc/lint/i18n/buildผ่าน | UIreview`a88f102` **CHANGES_REQUESTED**: totalของรายการไม่ทราบราคายังแสดง0; กำลังแก้minimalTDD; ยังไม่สร้างPRราคา |
| 03 price resolver/consistency | contract`934cbfa`, consistency14`e1753fe` (42focused/full1756) | review`f1b8a0a` **CHANGES_REQUESTED**→แก้`ee0be5d` (37tests/full1751); MAINพบown-unitfactorregressionเพิ่ม กำลังintegrate/แก้พร้อม14consistencytests |
| 04 LINE/A2 | `2574414`บนPR57`1d51234`; 239focused/54browserผ่าน | PR52ก่อนPR57; mobile/stagingtestLINEgroupยังPENDING ไม่ส่งผู้ขายจริง |
| 05 stock/security | `eac2b73`; PR54UI+mainmergeclean/logistics5; PR51transitinvariantไม่เปลี่ยน | ขอดูreleasepackageและapprovalแยกแต่ละPR; Rules51OWNER_HOLD |
| 06 OCR/import | PR39`75bf9f4`+main`6045b50`→`1f91409`; port`2d96cd8`; RED`f3d133d`→GREEN`acf2949`, report`d57be60`; 3–20MBPDF, focused50/full1764ผ่าน | separate-agentreview **APPROVE**, เปิดstacked [PR60](https://github.com/yutthachai-hr/PZM-LLP-Stock-2026/pull/60)บนPR39`1f91409`; exactCIกำลังทำ; cloudOCRยังPENDING |
| 07 barcode/backlog | barcode82ผ่านที่PR29`a33de94`; board`d8293a0`; activitywordingextraction`f5f51ce`(9focused) | scannerhardwarePENDING; wordingextractionREVIEW_PENDING; PR46OWNER_HOLDไม่เปลี่ยน |

จำนวนfullsuiteแต่ละแถวเป็นคนละbranch ไม่บวกตัวเลขแล้วอ้างว่าintegrationผ่าน
GitcanonicalfullSHAsตรวจจากobjectsก่อนpublish ไม่ใช้fullSHAที่คลาดเคลื่อนในcompactedhandoff; ดู`checkpoints.json`
ทุกchildexplicit`opencode / 9router/gemini-3.8-flash-high`, optionsว่าง; ไม่มีClaude/GPT/Codexchildหรือprobe

## 3. P0 / PR55: TR-00001และlinkcontract

- เดิมgeneratorสร้าง`/logistics/:id`แต่routerจริงคือ`/transfers/:id`; wildcardพาไปDashboard
- runtimefixเดิมPR55`94ff0bc`ได้Ownerยอมรับseparate-agentreviewแล้ว ไม่reimplement
- เพิ่มtestที่อ่านrouteจริงจาก`src/App.tsx`และassertเทียบmappingสองทาง; generatorfixtureMonday09:30BKKทำให้cutoff/weeklyไม่vacuous
- สองmutations (`/logistics/...`และcutoffboguspath) ต้องFAIL ทั้งauthorและreviewerทดสอบแล้ว ไม่ใช่testที่เงียบเพราะไม่เกิดevent
- Reviewครอบคลุมnotification drafts/evaluation, activityLog, sidebarLive, globalSearch, quick/navactions; รายละเอียดfile:lineอยู่ในreport
- UIreproคลิกlegacyTR-00001แล้วต้องอยู่`/transfers/tr-fixture`, ไม่ใช่`/`, ต้องเห็นTR-00001ในmain และreadหลังnavigationสำเร็จ
- MAINตรวจdiff`94ff0bc..1651548 -- src`ว่างและรัน119focusedซ้ำผ่าน (`pr55-contract-integration.log`)
- PR55ใหม่`1651548aef5337d7caf786a081aefd7ee9a19a9a`; sourcefixยังไม่ได้merge/deployProduction จึงไม่อ้างว่าOwnerProductionbugหายแล้ว

## 4. ราคา — พบbugจริงจึงHOLDก่อนสร้างPR

Pricingเป็น**ประมาณการ** ไม่ใช่ราคาPOที่ตกลง เพราะschemaไม่มีsnapshotนั้น

- UIและReviewคำนวณตามจำนวนรับจริง; supplier/cost/source label; ช่องqty/variance/reasonเดิมไม่ถูกเอาออก; missingไม่แทน0; zeroที่มีราคาจริงต้องแสดง0ได้
- UIrecoveryไม่เปลี่ยน`src/`จากGREEN`8e9108e` เพิ่มเฉพาะE2E/evidence/report
- รีวิวพบsavedrate0/ลบทำให้ของมีราคากลายเป็นฟรี/ติดลบ และentryUnitว่างทำให้หน่วยหาย
- consistencytestพบlegacyPO`Pack`ไม่มีbaseQty: resolverfactor1แต่stockfilingใช้currentproductfactor6; ตัวอย่าง20บาท/EAควร120บาท/Pack ไม่ใช่20บาท/Pack
- MAINตัดสินใจfailclosedเป็นmissingเมื่อหน่วยอื่นไม่มีpreservedrateที่เชื่อถือได้ **ไม่เดาfactor1และไม่สร้างhistoricalconversionจากcurrentcatalog**; ไม่แก้stockfilingหรือเพิ่มราคาลงschema
- `ee0be5d`แก้sourceidentity/duplicates/ties/invalidqty/overflowแล้ว; MAINพบอีกcase: มีbaseQtyแต่ไม่มีentryUnitต้องfactor1ตามfiling ไม่ใช้savedratio — codingintegrationทำRED/GREENและรวมconsistencytests
- UIreview`a88f102`พบMUST: summaryแสดง฿0.00เมื่อpricedLines0 (allmissing) ทั้งReceiveและReview; ต้องแสดง— แต่truezeropriceยังแสดง฿0.00. แยกboundedfixบนUIbase ไม่ชนresolver
- ต้องreviewfinalcombineddiffใหม่และรันexactHEADgatesก่อนสร้างPRราคา ไม่ใช้APPROVEของบางส่วนแทนทั้งหมด
- ภาพ1440/390ของ`3b32f1b`เป็นUIcheckpointก่อนแก้resolver ไม่ใช่financialacceptanceของfinalsource

## 5. Stock/securityและลำดับreleaseที่เสนอ (ไม่ใช่อนุมัติ)

1. **PR33 app** `e4db9a645ab126e457a73d725f3d65bc91037aa5`: lockedbaseline, ไม่refreshทับcountที่กรอก, explicitrebase/conflictrefusal, expectedleveltransaction และmonthretryidempotency; CI10/10/approvedตามR68
2. **PR54 app/UI** `01bb12cdf56334406d256bbf5462f9a5aeae26f0`: RulesของPRนี้deployแล้ว แต่UIยังมีประโยชน์จาก6statuses/error/retry/corruptionwarning/verifiedtoast; ไม่ใช่สิ่งที่ต้องdeployเพื่อทำOwnerAdminPASSซ้ำ
3. **PR51 Rules-first THEN app** `876c6d0315df3c63002ca5243903be0f26029b14`: voidreason/cancelเท่านั้น, admin/audit/schema/atomicrestore; ไม่เปลี่ยนtransit/location/order/PRauthorization
   - CandidateRulesSHA256`f06a4bff8ea0ce502ccb4e60f58b158cfef5c18fea3a077c83a9477dfb143e9a`
   - MAINก่อนหน้านี้รันRules305/unit1725 และCI10/10; **ต้องOwnerอนุมัติRulesrelease**
   - ห้ามapp51ก่อนRules51 มิฉะนั้นvoidReasonถูกpermission-denied

Rollback: ใช้Cloudflaredeploymentก่อนreleaseเพื่อapprollback; Gitrevertต้องดูmergeรูปแบบจริง (`-m1`ใช้เฉพาะmergecommit ไม่ใช่squash/ffทุกกรณี). ถ้าrollbackRules51กลับlivebaselineAE39 ต้องrollbackapp51ที่พึ่งRulesนั้นก่อน/พร้อมกัน ไม่ทิ้งappใหม่กับRulesเก่า. ไม่hardreset/forcepush/ลบงานOwner

PR52→PR57เป็นอีกreleasechainแยกจากstock33/54/51; phoneQAใช้TESTLINEGROUP/syntheticPOเท่านั้น ไม่ให้agentส่งผู้ขายจริง

## 6. Backlog — MAINแก้ข้อสรุปที่คลาดเคลื่อนจากchildboard

- **PR58:** มีindependentGeminiAPPROVE`412dee9`แล้ว และCI10/10ที่`11ba845`; childboardที่เขียนNeedsreviewนั้นเก่า ไม่ให้วนรีวิวเดิมโดยไม่เปลี่ยนcode
- **PR24:** จะปิดหลังPR39อย่างเดียวไม่ได้ ต้องตรวจtyped/paste/columnmappingscopeที่ยังไม่extractด้วย; drag/dropsliceเพียงส่วนเดียว
- **PR56:** secretsFAILจริงจากhistoricalpublicclient-prefixในreviewreport ไม่ใช่credentialรั่ว; currentcopyต้องredactและถ้าคงhistoryให้exactimmutablefingerprintเท่านั้น ไม่มีbroadignore/forcepush; รอCIหัวใหม่ก่อนอ้างPASS
- **PR45:** docs/policyretiredguard+strictnoforbiddenchild; ไม่เปิดcustomguardกลับ; ตรวจdiffก่อนintegration
- **PR19:** activitywording`f5f51ce`แยกจากLINEartworkและASTPR58แล้ว แต่ยังรอreview; ไม่mergegiantconflictingPR19
- **PR1:** childเสนอ4slicesเป็นbackloginventory ไม่ใช่อนุญาตextractทันที; หลายส่วนอาจมีแล้วในmain ต้องauditprovenanceก่อนเพิ่ม
- **PR46:** OWNER_HOLDเดิม ไม่มีscopeให้เปิดRESTreceiving
- **PR29:** automated82และ18browserเดิมไม่ใช่physicalscanner; checklistprint100% ยังPENDING
- **PR59:** code`891da59`review/CIพร้อม แต่cloudresource/secrets/provisioningยังไม่อนุมัติ ไม่ขอFirebaseloginซ้ำ

## 7. Concurrency/502และOwner actionsที่จำเป็นจริง

ดู `../r70/R70-CONCURRENCY-REPORT.md` และ `R69-H-RECOVERY.md`. วัด7in-flightmodelrequestsจริงโดยตัดtoolsออก ไม่ใช่7assignments; ไม่อ้าง7GoogleGPUexecutionหรือ7tokenstreams

ยังต้องOwner:
- อนุมัติreleaseเป็นชุดเฉพาะPRหลังfinalgates ไม่เหมารวมจากReleaseA/Bที่ผ่านแล้ว
- QAมือถือPR52/57ในtestgroup และscannerphysicalPR29เมื่อมีเครื่อง
- อนุมัติdedicatedcloudstagingก่อนสร้างresource/ทดสอบOCRจริง

ไม่มีOwneractionสำหรับทำReleaseA/Bmanualtestซ้ำ, loginFirebaseใหม่, เปลี่ยนcredentialหรือปิดguardที่native

## MAIN skill/evidence

- `show-me-your-work`, `C:/Users/Yutthachai/.agents/skills/show-me-your-work/SKILL.md`: loadedในsession, decisions.tsvเก็บcheckpoint/502/review/ownerPASSตามจริง
- `using-git-worktrees`, `C:/Users/Yutthachai/.pi/agent/git/github.com/obra/superpowers/skills/using-git-worktrees/SKILL.md`: loadedyes; commanderเป็นlinkedworktreeตรวจ.gitdir/commonแล้ว, ไม่สร้างmanualphantomworktree; codingintegrationใช้T3isolationworktree. ข้ามdependencyinstall/baselineappbuildสำหรับdocscommander เพราะไม่แก้runtimecode (CIsecretsเดิมFAILเปิดเผยไว้)
- `tdd`, `C:/Users/Yutthachai/.agents/skills/tdd/SKILL.md`: loadedyes; ชี้narrowrepro/failingcheckให้codingchild, ไม่สวมว่าMAINเป็นผู้รันRED/GREENของchild; ผลfinalยังPENDING
- `principle-prove-it-works`, `C:/Users/Yutthachai/.agents/skills/principle-prove-it-works/SKILL.md`: loadedyes; ตรวจgitobjects/diffจริง, rerun119, metadatarequestintervals; ไม่แทนphysicalQAด้วยsimulation
- TDD/receivingreview skills loadedในsession; sourceราคาตอนนี้ให้codingchildทำRED/GREENตามfindingsและแยกreview ไม่สวมว่าMAINimplementหรือfinalfinancialPASSแล้ว
- สิ่งที่ยังไม่ตรวจ: finalcombinedReceivefullsuite/preview, physicalscanner, mobilePR52/57, cloudOCR และProductionของงานที่ยังHOLD
