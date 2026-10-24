# R72 Independent Review: MAIN Gate & Receive Submission Fix

**Reviewer Model**: 9router/gemini-3.8-flash-high (variant: high)  
**T3 Provider**: opencode  
**Verdict**: **APPROVE**

---

## 1. Object Verification (Git History)

Verified exact commit chain leading to candidate:
- Base integration candidate: 441342
  - Merged 3161678 (Agent02 cards + shared 8d2582b + font fix)
  - Merged e974e68 (PR55 + navigation fixes)
  - Merged 6b02f65 (notification tests)
  - Merged 518a7fb (PR61 992f6de + Agent07 harness, MAIN edits d1c3b0c / 518a7fb)
- MAIN RED: 14a48b (test additions only in e2e/r72-logistics-ux.demo.ts and 	ests/transfer-receive-card.test.ts)
- MAIN GREEN: 59ec4e9 (src/pages/transfers/receiveHelpers.ts createSubmitGate + src/pages/transfers/TransferReceivePage.tsx submit handler + evidence screenshots)

---

## 2. Check Items Assessment

### (a) Navigation & Form Re-use Trace
- **Trace**: In TransferReceivePage.tsx lines 183-189, confirmReceive returns either 
ext.status = 'completed' or 
ext.status = 'discrepancy'.
- Both paths display a toast and execute 
avigate('/transfers/', { replace: true }).
- There is no early return or path that skips navigation upon success.
- If the user returns to /transfers/:id/receive, cur.status is no longer inTransit or eceiving, triggering !allowed (canReceive returns false) and permanently disabling receipt actions.
- The gate remaining locked on success is safe and prevents late double-tap submissions before SPA unmount.

### (b) Interplay: eceiveAllAsSent + submit + usy
- eceiveAllAsSent sets all rows to expected quantities and calls submit(all).
- submit synchronously checks submitGate.current.isLocked() || busy and calls submitGate.current.execute(...).
- The synchronous lock inside execute triggers on entry. Any concurrent click (e.g., rapid double-tap) immediately returns 
ull.
- setBusy(true) activates within ction, disabling the UI CTA.
- Upon completion, locked remains 	rue permanently for the mounted instance, while usy resets to alse in inally. Even after usy resets, submitGate.isLocked() remains 	rue.

### (c) Swallowed Catch & Toast Guarantees
- In TransferReceivePage.tsx, photoId = diff && c.photo ? await saveDiscrepancyPhoto(...) : undefined is inside ction's 	ry block.
- Any error during photo compression, upload, or confirmReceive is caught by ction's catch (e), which invokes 	oast.error(errText(e, t)) before rethrowing e.
- submitGate.execute catches the rethrown error, resets locked = false, and rethrows to caller.
- submitGate.current.execute(...).catch(() => {}) suppresses unhandled rejection since the error was already communicated to user via toast.
- Nothing is silently swallowed without user-visible error notification.

### (d) Non-Vacuous Test Assertions
- In e2e/r72-logistics-ux.demo.ts:
  - page.on('pageerror', (e) => pageErrors.push(e.message)) captures unhandled rejections in Chromium.
  - expect(pageErrors, 'no unhandled rejection from a late second tap').toEqual([]) directly verifies that the previous unhandled rejection defect does not recur.
  - expect(page.getByText('เอกสารไม่ได้อยู่ในสถานะพร้อมตรวจรับ')).toHaveCount(0) verifies no secondary error toast reached the DOM.
  - expect(received, 'exactly one receipt filed').toBe(1) verifies transactional integrity in storage.
- Without the gate lock fix and .catch(), both pageErrors and the toast count assertion would fail.

### (e) MAIN Harness Edits (d1c3b0c / 518a7fb)
- d1c3b0c: Dynamically derives identity width (owBox.width - checkboxBox.width - gap - 1) instead of hardcoding pixel widths, adapting accurately across devices.
- Mixed short/long SKU fixtures prevent false positives from text width stretching.
- docNo-only notifications assert fail-closed (notification remains unread in store, user remains on page) adhering strictly to PR55 contract (record identity is internal ID, never inferred from docNo TR-00001).
- Cross-brand navigation rejection also asserts unread status.
- Baseline 992f6de passed the controls-below-identity assertion across all six mobile widths because TransferReceivePage uses lex flex-col on mobile viewports (md:flex-row), naturally stacking stepper controls below identity.

---

## 3. Verdict & Summary

- **Verdict**: **APPROVE**
- **MUST Items**: None.
- **Gaps / Notes**: None blocking. Ready for merge.