# R39 PO send lifecycle and physical QA gate

Base candidate d7c0f1faaddaab1527f62a6e130a008a8abb2600. R38 fingerprinting, status-only overlays, Prepare/Share/Verify and delivery-vs-persistence separation remain in place. R39 extends the missing lifecycle cases; it does not recreate those fixes.

## New findings and bounded fixes

1. A rejected `shareOpened` write could go unhandled while the human still chose a LINE chat. The new deferred-picker test produced an actual Vitest unhandled rejection (exit 1, despite eight assertions passing). `settleShare` now observes that independent promise immediately, while preserving ordering of subsequent writes.
2. Reload/termination during an unresolved picker, combined with a failed opened-status write, lost all evidence of the hand-off. A new browser test failed because the confirmation question was absent. Before invoking the share provider, the wizard now synchronously journals the attempt in the existing brand/person/order/content-scoped progress store. No awaited work is added before the share call. If that journal cannot be saved, sharing is refused rather than creating an unrecorded ambiguous send.
3. A send of an old revision could stamp an amended PO `sent`. A new service test showed the promise resolving with sent metadata instead of rejecting. The wizard supplies its captured revision; `setShareStatus` checks it inside the same transaction as the patch. Status-only retry retains the original order snapshot, not the newer order currently on screen. Existing non-wizard callers retain their optional-argument API.

4. Switching brand while the LIFF picker was open could stamp a colliding PO id in the other brand `sent`. A browser contract stub reproduced that exact wrong-namespace write. Recording is now fenced by the wizard's original brand epoch, including a switch away and back. The confirmed original attempt stays recoverable in its own scoped journal; no outcome is written into the newly selected brand.

## Recovery semantics

- Unresolved attempt: ask the human about that exact page; never auto-share or infer sent.
- Confirmed final page with unsaved status: disable sharing and offer status-only retry.
- Confirmed earlier page: resume at the next page, not mark the whole PO sent.
- Human confirmation on an uncertain earlier page: advance one page only.
- Cancellation/error clears the attempt; next-page progress or persisted final status clears it normally.
- Unresolved attempts do not expire. A day passing is not proof LINE did not deliver. Ordinary completed-page progress retains R38's one-day expiry. Storage failure is fail-closed for a new external send.
- Revision change during a send cannot stamp the new revision sent. Close/reopen after the stale-revision error to prepare the amended content.

No software can prove exactly-once delivery across an OS kill between an external LINE side effect and its callback. The journal preserves uncertainty for human reconciliation; it does not manufacture delivery confirmation. This is not cross-device external-message deduplication.

## Executed software evidence

- Focused units 96 passed; full unit 1713 passed / 142 files.
- Final four-engine emulated browser matrix 62 passed / 2 CPU-only skips. Includes Chromium desktop/Pixel 7 and WebKit iPhone/iPad profiles, unresolved picker reload after failed status write, per-page confirmation and persisted-confirmed-receipt status-only recovery.
- Build (app/functions/worker/e2e types), i18n and oxlint passed.
- The earlier browser command exceeded the parent's 240-second wait, but its original process continued and its same log finished58/2 in4.6 minutes; no duplicate of that still-running job was started. After the newly reproduced brand-switch bug and guard changed the source, a deliberate final matrix ran to completion under a larger wait budget and passed62/2.
- The confirmed-receipt browser fixture is synthetic persisted state, not an actual LIFF delivery. LIFF outcome/activation behavior is separately unit-tested. Browser reload is not a physical OS-termination measurement.

## Physical-device checklist (NOT EXECUTED)

Owner must arrange an isolated staging/demo environment, its matching registered LIFF test app, non-Production image hosting, synthetic POs and a dedicated test chat such as `PZM-R39-SYNTHETIC-QA`. This document does not create that chat or authorize real supplier messages. Do not sign into a Production test account or use a live signed supplier confirmation URL. A Preview URL alone is not evidence its backend/LIFF/upload configuration is isolated.

On an actual iPhone/iPad and Android phone, record OS, LINE version, browser/PWA mode, candidate SHA and screen recording. Use one-page and 45-line synthetic orders labelled TEST ONLY, fake supplier ids and no real supplier contact data.

1. Open the correct LIFF test app in LINE, normal browser and home-screen/PWA mode. Check login hand-over returns to the same synthetic PO without a navigation loop.
2. Double-tap share. Confirm exactly one picker, then cancel; retry manually. Check one PO id, no false `sent`, and no extra bell/status writes.
3. Send page 1 to the dedicated chat. Amend the PO while the picker is open and between pages. Verify no old-content completion marks the new revision sent; the amended sheet starts at page 1.
4. Leave LINE open and reload the app; separately terminate it using the OS app switcher and reopen it. Reconcile the uncertain page before any new send. Inspect the actual dedicated chat, not only UI status.
5. In isolated staging, inject failure of opened/sent persistence independently from LINE delivery. Confirmed delivery must offer status-only retry, including after app restart; it must not reopen the picker.
6. Confirm each image/page exactly once in the dedicated chat, PO record count unchanged, revision/image version correct, and no false sent state for cancelled or uncertain outcomes.
7. Check storage-disabled behavior refuses the external hand-off with a readable recovery error.

Attach device/chat evidence only after the Owner-arranged test. No real send was performed during R39. Independent exact-final-head review and applicable CI/Preview/device gates remain required. Rollback for a future code-only merge is a revert to the prior main e34a847; no Rules deploy or feature activation is implied.
