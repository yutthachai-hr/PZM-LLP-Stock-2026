# Sending a PO to LINE: prepare → share → verify (owner P0, 22 Oct 2026)

"บนมือถือ/แท็บเล็ต บางครั้งกดแล้วไม่ไป" — investigated in R36 on `e34a847`.

## Findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | One tap did render JPEG (+ preview + upload for LINE), an awaited status write and the supplier-link call **before** `navigator.share` / `liff.shareTargetPicker` | **Confirmed (code + measured)** | 30-line sheet, phone viewport, tap→share: 0.7 s at 1×, 3.6 s at 4× CPU, 10.3 s at 8×, 43 s at 16× |
| 2 | Both share APIs need the tap to still be a "transient user activation" (LIFF's picker opens a window outside the LINE app); a long tap→share gap makes the share fail with NotAllowedError → toast + `failed` | **Hypothesis — not reproducible in emulation** | Under Playwright both Chromium and WebKit keep `userActivation.isActive` true past 5.5 s, so automation cannot show expiry. Needs physical iOS/Android confirmation |
| 3 | A failed share showed only a toast: no retry / download / copy / later | **Confirmed (RED)** | `e2e/line-send.demo.ts` "a failed share offers…" failed on `e34a847` |
| 4 | Page dropped while LINE was in front (common for an iOS home-screen app) → wizard restarted the send instead of asking whether it went | **Confirmed (RED)** | "back from LINE after the page was reloaded…" failed on `e34a847` |
| 5 | Multi-page order restarted at page 1 after a reload (pages resent) | **Confirmed (RED)** | "a two-page order resumes…" failed on `e34a847` |
| 6 | Pages overwrite each other's hosted picture (same `poId-version` tag) | **Refuted** | `functions/_poImage.ts` stores each upload under a fresh random token |
| 7 | Web Share treated as delivery | **Already correct** | only LIFF `{status:'success'}` records `sent`; share sheet asks the person (now also after a reload) |

Not investigated with a live LINE account (forbidden for QA): LIFF login/SSO failures on specific devices,
network errors against the real image host and supplier-link API. Their errors now surface through the
same recovery panel instead of a toast.

## Design

- **Prepare** (background, per order content + page + sheet language + provider): render, host (LINE only),
  supplier link. The share button reads "กำลังเตรียมรูป…" until ready. A prepare error shows "ลองเตรียมใหม่".
  The payload key excludes status fields, so the wizard's own status writes don't re-render or re-upload;
  a revision/lines/date change does, so a stale sheet is never shared.
- **Share** (the tap): `provider.share(...)` is the first call in the handler; the `shareOpened` write follows
  in parallel and is awaited before any outcome is written. A second tap is ignored (ref guard).
- **Verify**: LIFF success → `sent`. Share sheet → "ส่งใน LINE เรียบร้อยหรือไม่?" (also on reopening an order
  left `shareOpened`). Failure → `failed` + recovery group: ลองอีกครั้ง (same payload, fresh tap),
  ดาวน์โหลดรูป, คัดลอกข้อความ (caption + confirmation link), ไว้ส่งทีหลัง. No path creates an order.
- Multi-page progress persists per brand+order in local storage for a day (`sendProgress.ts`).

## Evidence

- `e2e/line-send.demo.ts` (`playwright.line-send.config.ts`, port 5205): 8 scenarios × desktop Chromium,
  Pixel 7 Chromium, iPhone 13 WebKit, iPad WebKit — 30 passed, 2 skipped (CPU throttle is Chromium-only).
  Tap→share under 8× CPU now < 1 s (was 10.3 s). CI runs the Chromium projects.
- `tests/send-progress.test.ts`; existing `e2e/orders-line-status.demo.ts` 29/29; unit 1696; build.

## Not verified

Physical iPhone/iPad (Safari, home-screen app, LINE in-app browser) and Android (Chrome, LINE) with a
real LINE account and a test chat. Record each separately; until then gesture expiry (#2) is unconfirmed.
Code-only: no Rules, schema or server change. Rollback: revert the merge.
