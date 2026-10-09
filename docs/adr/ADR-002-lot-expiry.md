# ADR-002 — Lot and expiry tracking (deferred; schema reserved)

**Status:** accepted for later — the owner approved this on 6 Oct 2026 ("YES but DEFER").
This release only reserves the schema. It must not block the release.

## What this release does

- **Product flags:** `Product.trackLot?: boolean` and `Product.trackExpiry?: boolean`.
  Absent or `false` means the product is tracked exactly as today.
- **Rules:** both are optional booleans on `products` and `lelapin__products`. Only an admin
  may write a product, so only an admin may set them. Test: `tests/firestore-rules.test.ts`
  "lot / expiry flags".
- **Helpers:** `src/lib/lotExpiry.ts` (`tracksLot`, `tracksExpiry`) is the single place that
  answers the question, and it defaults to false.
- **No behaviour change:** no screen, command, rule, Worker job or intelligence engine reads
  the flags yet. `tests/lot-expiry.test.ts` fails if anything outside the schema starts
  reading them.
- **No data is migrated.**

## The design the flags reserve room for

1. **The ledger stays the source of truth.**
   - A movement line for a tracked product gains `lot?: string` and `expiryDate?: number`.
   - These are written by the trusted stock commands (ADR-001), never by the client.
   - Untracked products never carry them.
2. **Balances:**
   - `stockLevels` stays one row per product × location, so every existing screen and
     report keeps working.
   - Tracked products add a derived `stockLots` row per product × location × lot. It is
     rebuilt from the ledger like `stockLevels`.
   - The sum of a product's lot rows always equals its level row. The integrity auditor
     checks this.
3. **Receiving:**
   - Lot and/or expiry are required on the line only when the product's flag is on.
   - Partial receipts and rejections keep the lot they were received under.
4. **Issuing, transfers and counts:**
   - FEFO (first expiry, first out) is **suggested**: the issuing screen proposes the lot
     with the earliest expiry, and a person may choose another.
   - Transfers carry the lot.
   - Counts are per lot for tracked products.
5. **Intelligence (later phase, suggest-only):**
   - an expiry-risk engine (stock that will expire before it is used, at the forecast rate);
   - expired stock as an Inbox exception.
   - Like Phase G, it never acts on its own.
6. **Turning a flag on for a product with stock:**
   - An admin action posts an opening lot ("UNKNOWN", no expiry) for the current balance at
     each location.
   - The action is audited (B2) and the cache epoch is bumped.
   - Turning a flag off is refused while any lot row is non-zero.

## Why deferred

- **Phase A–G:** the ledger, commands, read budget and intelligence must first prove stable
  in production (the 14-day integrity gate).
- **Risk:** lots multiply the balance rows, and therefore the reads, for tracked products.
  That has to be priced against the read budget (`docs/evidence/read-budget.md`) before it
  is built.
