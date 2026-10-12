# In-app brand switcher — evidence (12 Oct 2026)

Branch `feat/brand-switcher`, stacked on `feat/release-foundation` @ `473f4ba` (PR #2), so its
previews run with preview isolation (demo data, guarded functions, preview-only KV).

## What changed

| Where | Before | After |
|---|---|---|
| Desktop sidebar header | Logo (linked to the website), name, badge | **Brand switcher**: logo + name + "The Inventory OS" + Cloud/demo badge + chevron → list of the 3 brands (logo, ring in the brand's colour, ✓ on the open one), website as a separate named link |
| Sidebar footer | "สลับแบรนด์" + "ออกจากระบบ" | "ออกจากระบบ" only (profile box kept) |
| Top-bar account menu | "แก้ไขโปรไฟล์ / สลับแบรนด์ / ออกจากระบบ" | "แก้ไขโปรไฟล์ / ออกจากระบบ" |
| Tablet rail | Logo (website link) | Logo → brand sheet (from the right) |
| Phone | "เพิ่มเติม" → "สลับแบรนด์" → full-screen picker | Logo in the top bar → bottom sheet; "เพิ่มเติม" → "สลับแบรนด์" opens the same sheet |
| After sign-in | Full-screen picker every new tab | The device's last brand opens directly; the picker only on a device that has never chosen (or after a LINE resume link names a brand) |

Login page: unchanged (approved artwork untouched).

## How a switch runs (`src/brand/useBrandSwitch.ts`)
1. A form holding something (every screen using `useDraft`: receive, issue ×2, adjust, counts ×2,
   orders) is named in a confirm dialog. Its draft is kept on this device for the brand it belongs
   to and comes back when that brand reopens (photos are not part of drafts — the dialog says so).
2. Writes already sent are waited for (counted at the backend, `src/backend/pendingWrites.ts`);
   if they have not finished in 15 s the switch is **refused**.
3. Drafts are written out at once; the Dashboard opens; the brand changes. `DataProvider` is keyed
   by brand, so every subscription and in-memory list is rebuilt from nothing; brand-scoped module
   caches drop their copy via `onBrandChange`. Nothing of the previous brand stays on screen.

## Authorization findings (reported, not changed)
- `firestore.rules` grant access by **active profile + role** only. There is **no per-user brand
  list** (`AppUser` has none) and no brand condition in the rules: every active employee can read
  and write all three brands (within their role).
- So the switcher (and the device's remembered brand) is navigation, not permission. `savedBrand()`
  accepts only `pizza | lelapin | rnd`; anything else in storage is ignored (tested). If per-brand
  access is wanted, it must be a rules change + a user field — an owner decision, not done here.

## Unsafe existing behaviour found (not changed in this UI PR)
- `src/services/automation.ts` pins its database to the brand at the start (`forBrand`) but later
  writes its bookkeeping keys with `getBrand()` after awaits (lines ~126, 183, 296, 312): a switch
  mid-run files "ran today / notified" markers under the **new** brand. Data is not misrouted (the
  database writes are pinned); the in-flight-write wait makes the window small. Fix = capture the
  brand once at the start — a separate small PR if approved.
- Stock writes (`ledgerTx` / commands) already take the brand once (`forBrand`); not touched.

## Tests
- Unit `tests/brand-switch-guards.test.ts` (6): writes counted/released on success and failure,
  wait + timeout, every write method counted (reads not, `forBrand` copies too), unsaved registry
  and flush, remembered brand validation (tampered / blocked storage).
- E2E `e2e/brand-switcher.spec.ts` (8, emulator):
  1. first sign-in asks once; sign out + another account on the same device → last brand, no picker
  2. Pizza → Le Lapin → R&D → Pizza: each lands on `/` with only its own products; **opening the
     list = 0 reads**; live listeners identical after every switch
  3. rapid switching settles on the last choice with that brand's data only
  4. unsaved receiving form → warning; cancel keeps everything; switching keeps the draft for Pizza
  5. tampered `localStorage`/`sessionStorage` brand ids are ignored
  6. keyboard: Enter opens on the current brand, ArrowDown / End move, Enter switches, Escape returns focus
  7–8. tablet 1024×768 and phone 390×844: logo ≥ 44 px, sheet options ≥ 44 px and not covered
     (the phone's tab bar once was — fixed by rendering the sheet into `document.body`)
- Shared e2e helper `e2e/app.ts`: the picker button is matched exactly (the switcher's label also
  contains "Pizza Mania").

## Read cost
Emulator stage (tiny data): switch → 39 / 39 / 17 reads; listeners 8 → 8.

Real data (local backups 9 Oct, `e2e/brand-switch-reads.spec.ts`, manager):

| Step | Reads | Live listeners |
|---|---|---|
| sign in → Pizza Mania (cold) | 1,657 | 7 |
| → Le Lapin (first time) | 500 | 7 |
| → Pizza Mania (again) | 73 | 7 |
| → Le Lapin (again) | 71 | 7 |

Opening the switcher: **0 reads**. A switch costs what opening that brand costs (the same
DataProvider rebuild the old picker caused); returning to a brand reuses its persisted cache.

## Screenshots
`after-1440-sidebar-closed.png`, `after-1440-dropdown-open.png`, `after-1440-unsaved-warning.png`,
`after-1024x768-sheet.png`, `after-390x844-sheet.png`.

## Rollback
Revert the PR. No data, rules or schema change; drafts and the remembered brand stay in the
browser exactly as before.
