# R40 P0: multi-PO LINE send — real-device QA

Browser automation (e2e/line-send.demo.ts on Desktop Chrome, Pixel 7, iPhone 13 and iPad emulation) uses stubbed LIFF and Web Share. It proves the app's own state machine. It does **not** prove what LINE, iOS or Android do with a real share. This runbook covers that gap and has to be done by a person on real devices.

## Rules
- Synthetic POs only, on an isolated staging/demo deployment with its own LIFF app (`demo.pzmstock.pages.dev` has its own LIFF id). No Production account, no real supplier, and no real supplier chat.
- Use one dedicated LINE test chat (or group) that the Owner sets up. Every share goes there.
- Do not edit data by hand. Use the app.

## Fixture
Three synthetic suppliers (QA-SUP-A/B/C), each with one placed PO. PO-B has 45 lines, so it is two pages. Optionally a fourth PO that is already sent, and a fifth PO cancelled during the run.

## Scenarios (each device)
1. Select A, B, C → "ส่ง LINE (3 ใบ)".
2. LIFF, signed out: "เชื่อมต่อ LINE" → LINE Login → back on the same batch at A (1 / 3). Nothing recorded yet.
3. LIFF, signed in: one tap per supplier opens the picker, then pick the test chat. Expected in chat for each PO: the message text with the link, the [ยืนยันวันจัดส่ง] card, then the picture. The wizard then moves to the next supplier.
4. Web Share (no LIFF): "แชร์รูป" → test chat. Then "คัดลอกลิงก์ยืนยันวันส่ง" → paste into the same chat → "ส่งแล้ว".
5. Close the app or switch apps while the share sheet is open, then reopen. Expected: "ส่งต่อ" resumes at the same PO and page. A page that was confirmed is not sent again.
6. Cancel the picker for A → A stays unsent and nothing is recorded. Skip B → C follows.
7. Reload in the middle of the batch, then log out and back in during the batch. With a second user on the same device, that user does not see the first user's batch.
8. Amend C on another device mid-batch → C's sheet shows the new content.
9. Home-screen app (iPhone/Android): "เชื่อมต่อ LINE" opens the batch inside the LINE app. Finish there.

## Record per run
| Field | Value |
|---|---|
| Device / OS version | |
| Browser or PWA or LINE in-app; LINE app version | |
| Provider shown (ส่ง LINE / แชร์รูป) | |
| Taps from "ส่ง LINE (n ใบ)" to all done | |
| Messages received in the test chat, in order | |
| Picture correct (PO no., lines, page n/m) | |
| Supplier link present, opens the right PO | |
| Resume outcome after reload / app switch / login | |
| Duplicates or missing messages | |
| Failures and how they were recovered | |

## Minimum matrix
| Device | Browser | Mode | Result |
|---|---|---|---|
| iPhone | Safari | LIFF via LINE Login | not run |
| iPhone | Home-screen PWA | hand-over into LINE app | not run |
| Android | Chrome | LIFF via LINE Login | not run |
| Android | Installed PWA | hand-over into LINE app | not run |
| iPad / Android tablet | Safari / Chrome | LIFF, and Web Share | not run |
| Any phone | LINE in-app browser (LIFF URL) | LIFF in client | not run |
| Windows | Chrome + LINE desktop | LIFF picker window | not run |

Combined image + text through Web Share stays off. Enable it only after this matrix shows that the target app keeps the link next to the picture on every device listed.
