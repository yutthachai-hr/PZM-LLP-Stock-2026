# R67 WAVE A — PR29 Barcode Scanner Physical Test Sheet

Test barcode reference sheet and physical hardware verification checklist for **PR #29** (`fix/20261017-barcode-scan-safety` @ `b850d3a417e5152f8191a9b0dd739b5fa550566a`).

---

## 1. Printable Synthetic Test Barcodes

Print this page at 100% scale (no fit-to-page downscaling) on standard A4 paper. Use a standard 1D/2D laser or CCD handheld barcode scanner configured in USB HID / Keyboard Wedge mode.

| Case | Scenario | Synthetic Barcode Token | Target Product SKU / Name | Expected Scanner Reaction |
|---|---|---|---|---|
| **Case 1** | Normal Barcode Selection | `8851000777001` | `NORM-01-001` / QA NORMAL ITEM 1 | Resolves exact product, prompts confirmation modal, adds line on confirm |
| **Case 2A** | Leading Zeros Preserved | `0012345678901` | `ZERO-01-001` / QA ZERO PREFIX ITEM | Resolves exact 13-character token with leading zeros, never matches `12345678901` |
| **Case 2B** | No Leading Zeros Distinct | `12345678901` | `NOZERO-01-002` / QA NO ZERO ITEM | Resolves exact 11-character token, never matches `0012345678901` |
| **Case 3** | Suffix: Enter (`\r` / `\n`) | `8851000777003` | `ENT-01-001` / QA ENTER SUFFIX ITEM | Enter terminator submits code, clears search input, opens legacy confirm |
| **Case 4A** | Suffix: Tab (`\t`) | `8851000777004` | `TAB-01-001` / QA TAB SUFFIX ITEM | Tab terminator submits code in receiving/issue, clears input, opens legacy confirm |
| **Case 4B** | Shift+Tab Guard | `8851000777004` + Shift+Tab | (None) | Must **NOT** scan. Focus leaves search box backwards; no line added |
| **Case 4C** | Partial Text + Tab | `QA TAB` + Tab | (Suggestions list) | Must **NOT** scan. Tab performs normal keyboard navigation; keeps query |
| **Case 5** | Unknown Barcode Rejection | `9998887776665` | (Unregistered code) | Fail-closed: Error toast *"ไม่พบบาร์โค้ด 9998887776665 ในระบบ"*, box cleared, 0 lines |
| **Case 6A** | Duplicate Barcode Claim | `8851999000111` | `DUP-01-001` & `DUP-01-002` | Fail-closed: Error toast *"บาร์โค้ด 8851999000111 ซ้ำกับสินค้า 2 รายการ"*, 0 lines |
| **Case 6B** | Inactive/Retired Product | `8851999000222` | `RET-01-001` / QA RETIRED PRODUCT (`active: false`) | Fail-closed: Error toast *"สินค้าบาร์โค้ดนี้ถูกปิดใช้งานแล้ว"*, 0 lines |
| **Case 7A** | Double-Trigger / Burst (<400ms) | `8851000777007` | `BURST-01-001` / QA BURST SAME ITEM | Two rapid triggers produce no concatenated string (`88510007770078851000777007`), exactly 1 prompt, qty 1 |
| **Case 7B** | Rapid Consecutive Different Codes | `8851000777008` then `8851000777009` | `BURST-02-001` & `BURST-03-001` | First code prompts dialog; second code rejected as pending confirmation; no token corruption |
| **Case 8** | Cross-Brand Isolation | `8851000777001` | PZM: `PZM-01-001`<br>LLP: `LLP-01-001` | Resolves only the currently active brand's product; modal close cleans up listener |

---

### Code 128 / Text Representation for Scanning

If generating Code 128 barcodes online or via barcode label printer (e.g. Zebra ZD421 / Brother QL), encode the following raw string values:

1. `8851000777001`
2. `0012345678901`
3. `12345678901`
4. `8851000777003`
5. `8851000777004`
6. `9998887776665`
7. `8851999000111`
8. `8851999000222`
9. `8851000777007`
10. `8851000777008`
11. `8851000777009`

---

## 2. Five-Minute Physical Hardware Checklist

Complete this checklist on-site with actual hardware before deploying PR #29 to production.

### Step 0: Hardware Setup & Configuration
- [ ] **Scanner Hardware Model**: __________________________________ (e.g., Zebra DS2208 / Honeywell 1400g / Datalogic QuickScan)
- [ ] **Connection Interface**: [ ] USB Cable (HID POS / Wedge) [ ] Bluetooth HID [ ] 2.4GHz Wireless Dongle
- [ ] **Current Suffix Configuration**:
  - [ ] Suffix = **Enter** (CR / LF / CRLF)
  - [ ] Suffix = **Tab** (HT)
  - [ ] None (Not recommended; requires manual Enter key)
- [ ] **Host OS & Browser**:
  - OS: [ ] Windows 11 / 10 [ ] iPadOS / iOS [ ] macOS [ ] Android
  - Browser: [ ] Google Chrome [ ] Safari [ ] Edge
- [ ] **Keyboard Layout on Host**: [ ] US QWERTY [ ] Thai Kedmanee (Verify digit mapping normalization)

---

### Step 1: Physical Verification Execution (5 Minutes)

| # | Test Step | Action on Physical Scanner | Observed Outcome | Pass/Fail |
|---|---|---|---|---|
| **P-1** | Normal Scan (Enter suffix) | Scan `8851000777001` into Issue search box | Prompt shows "QA NORMAL ITEM 1". Search box clears. Confirm button adds row with qty 1. | [ ] Pass [ ] Fail |
| **P-2** | Leading Zeros | Scan `0012345678901`, confirm. Then scan `12345678901`, confirm. | Two separate rows created. Neither matched the other. | [ ] Pass [ ] Fail |
| **P-3** | Tab Suffix Configuration | Set scanner suffix to **Tab**. Scan `8851000777004`. | Input is accepted, resolves product prompt, confirms and adds line. | [ ] Pass [ ] Fail |
| **P-4** | Navigation Safety (Shift+Tab) | Type `8851000777004` manually, press `Shift+Tab`. | Cursor moves to previous element. No scan action triggered. | [ ] Pass [ ] Fail |
| **P-5** | Partial Match + Tab | Type `QA TAB` manually, press `Tab`. | Suggestions drop down. Tab moves focus down. Does **not** trigger scanner error or clear text. | [ ] Pass [ ] Fail |
| **P-6** | Unknown Code | Scan `9998887776665`. | Toast: *"ไม่พบบาร์โค้ด 9998887776665 ในระบบ"*. Input emptied. 0 lines. | [ ] Pass [ ] Fail |
| **P-7** | Duplicate & Inactive | Scan `8851999000111`. Then scan `8851999000222`. | 1st: *"บาร์โค้ด ... ซ้ำกับสินค้า 2 รายการ"*. 2nd: *"สินค้าบาร์โค้ดนี้ถูกปิดใช้งานแล้ว"*. 0 lines added. | [ ] Pass [ ] Fail |
| **P-8** | Rapid Double-Trigger (<400ms) | Double-press trigger on `8851000777007` as fast as possible. | Exactly 1 prompt. Search box is NOT `88510007770078851000777007`. Confirm -> exactly 1 line (qty 1). | [ ] Pass [ ] Fail |
| **P-9** | Confirmation Enter Guard | Scan `8851000777007`. When modal opens, scan `8851000777008` while modal is visible. | Second scan does not blindly press Confirm or Cancel. Error toast indicates pending confirmation. | [ ] Pass [ ] Fail |
| **P-10**| Brand Switch Latch | Open camera modal in Pizza Mania. Switch brand to Le Lapin. | Modal closes cleanly. No cross-brand leakage. | [ ] Pass [ ] Fail |

---

### Verification Sign-off
- **Tester Name / Role**: ______________________________________
- **Date & Time Tested**: ______________________________________
- **Physical Verification Status**: `PHYSICAL_HARDWARE_PENDING` (Pending on-site run with physical unit)
