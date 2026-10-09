# Smart "Other" Item: R&D brand (8 Oct 2026)

**Status:** implemented on `integration/ops-os-rc1`, tested; **not deployed**.

R&D only, with a build switch (`VITE_OTHER_ITEM=off` turns it off). Pizza Mania and Le Lapin
are unchanged.

## Phase 0: what the audit found

| Area | Before |
|---|---|
| "Other" | A real **placeholder product** per category in the R&D catalogue (`main 476fa35`): `VEGETABLE-(OTHER)` `VGT-02-20-001`, `MES-CHICKEN (OTHER)`, `MEAT-SEAFOOD-(OTHER)`. All have an **empty unit**. Everything bought "as Other" piled onto one SKU and one balance. |
| Product creation | **Admin only** (`adminWritable` in the rules). Staff could not create an item. |
| SKU | R&D uses `CAT-02-GG-NNN`. The only automatic code (WIP) is computed on the client, with no transaction. |
| PR / PO lines | Already **snapshot** name, SKU, unit and supplier at the time of the request or order, so history stays right after a rename or a supplier change (Phase 4's snapshot rule was already met). |
| Supplier on the product | `supplierId` / `alternateSupplierIds` are attributes, **not identity**. A request line carries its own supplier and flags a non-usual one. |
| Matching | `lib/productMatch.ts` already does SKU → alias → unique normalised name → ambiguous → similar (used by OCR and Excel import). |
| Non-stock lines | **No such concept**: receiving always posts to the ledger. |
| Supabase | Products are replicated by the shadow; new fields are kept in `doc jsonb`, so no migration is needed. |

## What was built

| Phase | Implementation |
|---|---|
| 1. UI | `pages/requests/OtherItemPanel.tsx`. Picking a category's "(OTHER)" product in an R&D request opens it **in place**: no modal, no extra screen. The person types a name (required), a spec and a unit (optional), and sees one of three states as they type: **"สินค้าเดิม — ใช้รหัสเดิม"** (existing item), **"มีรายการที่อาจตรงกัน — โปรดเลือก"** (pick one, or create anyway), or **"ไม่พบสินค้านี้ในระบบ"** (create a new code). The chosen product then continues through the **normal** supplier / quantity / unit step. The badge **"สินค้าใหม่ รอตรวจสอบ"** (new item, pending review) shows in the picker, the requester's cart and the manager's review. |
| 2. Matching | `lib/otherItem.ts` `decideOther` (on top of `productMatch`), in this order: verified SKU / barcode / id → confirmed alias → **one** same-named product **with compatible unit and spec** → otherwise *choose* (same name with another spec, several of that name, a pending item, similar names) → *create*. It **never auto-links** an ambiguous match, a different spec, or a pending item. Placeholders and hidden products are never matched. |
| 3. SKU | Server command `proposeItem` (`commands/proposeItem.ts`, R&D only, any active role). In **one transaction** it writes: a claim on the item key (normalised name \| spec \| unit), so the same item proposed twice is one product; the next number from `counters/otherSku` → **`RND-000001`**, never reused (the counter only goes up, which the rules enforce); and the product with **`review: 'pending'`**, its own id and its own stock. In the cloud it always runs on the server (staff cannot write products). |
| Admin review | The product editor shows a "pending" banner with **"ยืนยันว่าตรวจแล้ว"** (confirm as checked, admin only) → `review: 'verified'`, versioned and audited like any product edit. |
| 4. Supplier independence | Supplier is not part of identity, the key or the match. A different supplier on the line keeps the same product (tested: the request line has supplier `sup2`, while the product stays `RND-000001`). Snapshots on PR / PO lines already existed. |
| 5. Downstream | No change was needed. The new item is an ordinary product id, so PR → approval → PO → supplier confirmation → receiving → ledger → balance → reports → PDF / Excel all carry its id and its real name. |
| 6. Security | Rules: product docs accept `review` (pending \| verified), `spec`, `nameKey`, `proposedBy`, `proposedByName`. Staff still cannot create products or set `review`. `productKeys` is server-only. The server refuses the command for other brands (403) and refuses caller-supplied codes or proposer fields (400). |

**Also fixed (found by the e2e):** the R&D brand could not read its cache epoch.
- **Cause:** the rule allowed `cacheEpoch_(pizza|lelapin)` only. This was a gap in this
  branch's R&D merge; main has no such rule.
- **Fix:** the rule now allows `rnd` too, and a rules test covers it.

## Not done: owner decision needed

**One-off non-stock lines** (a trial purchase that never enters stock):
- receiving would have to skip the ledger for some lines;
- that changes the stock engine (client and server, both covered by parity tests) during an
  RC freeze window.

**Proposed design:**
- a line flag `nonStock: true` on a pending product;
- `receivePO` records the receipt on the order but files no movement;
- reports list it as an expense.

**Until then:** a one-off item is a pending product with its own code and its own (separate)
stock. It never mixes with another SKU, and an admin can hide it after use.

**Other limits:**
- Legacy "(OTHER)" lines and balances are **untouched**. Old documents read as before. Moving
  their history onto real items is a manual, per-item decision, not a migration.
- Not added: a bulk "pending items" review list in the catalogue (admins find them by the
  banner, or by searching `RND-`), and AI matching. The matching is deterministic, and fuzzy
  scores only order suggestions.

## Tests (all pass)

| Suite | What |
|---|---|
| `tests/other-item.test.ts` (12) | Matching priority 1–5; same name with another spec → choose (acceptance 4); several same-named → choose (5); pending offered, never taken; placeholders and hidden items never matched; supplier is not identity (3); R&D only, switch off |
| `tests/functions/propose-item.test.ts` (6) | Created pending with `RND-000001` under the caller; the same item again → the same product, no new code (2); another spec → `RND-000002`; **4 concurrent proposals of one item → 1 product; 4 different items at once → 4 distinct codes** (6); Pizza and Le Lapin → 403 (13); revoked / no token / missing placeholder / empty name or unit / a caller-chosen code or proposer → refused, nothing written (11) |
| `tests/functions/stock-commands.test.ts` | The allow-list pin: `proposeItem` writes products, productKeys, counters, **never stock** |
| `tests/firestore-rules.test.ts` (+3), `tests/cache-epoch-rules.test.ts` (+1) | Proposed shape valid; review is pending or verified only; staff and managers cannot create or verify; key claims are server-only; the counter never goes back; R&D cache epoch readable |
| `e2e/other-item.spec.ts` | R&D → Other → "Sumac powder" → create (1) → request line with real name, `RND-000001`, chosen supplier; the same item typed again → offered, used, **no second code** (2); a catalogue item typed → "existing", its own code; phone 375 px, no sideways overflow (10); manager sees the badge, approves, orders → the PO line is the new product by id with its name; **received → stock only on that product, nothing in another brand** (7, 8) |
| `verify --full` | 15/15: unit **1,747**, rules **246** |

**Read impact (measured):**
- **Typing: 0 Firestore reads.** The app's meter was reset after the panel opened, then the
  whole item was typed (`OTHER-ITEM typing reads: 0`).
- **Opening the panel:** one read of the brand's aliases per session (a handful of
  documents).
- **Creating an item:** 3 reads and 3 writes on the server, plus 1 delta read per open device
  when the new product arrives.

## Screenshots (`docs/evidence/img/other-item/`)

- `1-new-item-1440.png`: not found → "สร้างรหัสใหม่และใช้" (create a new code and use it), desktop.
- `2-suggestions-375.png`: the panel on a 375 px phone.
- `3-manager-review-1440.png`: the manager's review with "สินค้าใหม่ รอตรวจสอบ" on the line.

## Deployment readiness

Ready for **preview** testing once pushed: the branch's preview is isolated (demo data).

**Production needs, in order:**
1. **Rules first** (they accept the new product fields and the R&D cache epoch). Additive, so
   old apps are unaffected.
2. **Then** the app, whose Pages Functions contain `proposeItem`.

No data migration is needed. **Rollback:** build with `VITE_OTHER_ITEM=off`, or revert the
commit. Products already proposed stay valid ordinary products.
