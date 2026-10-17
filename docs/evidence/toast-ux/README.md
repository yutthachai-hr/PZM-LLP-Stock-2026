# Toast notification redesign: evidence

Base `af0136b0f6886989bc32d651a384ac05b39cdad6`. Branch `feat/toast-notification-ux`. Presentation and transient-queue behaviour only. No business logic, Firestore rules, schema or data paths change. The one copy change is the price-save toast, which now uses a title and a description.

## What changed

- **Card style.** A white card replaces the solid coloured block. It has a tinted icon chip per variant (success, error, warning, info), a semibold title, an optional description, an optional action and a 44 px close button.
- **Placement.** On desktop the card is top-right below the header, 360 px wide. On mobile it is full width, inset from the edges, above the tab bar and bottom controls, and above the on-screen keyboard (`visualViewport`). Safe-area insets apply on every edge.
- **One shared lane with operational notifications.** `NotificationHost` previously used the same top-right corner independently, so the two could overlap. Both now render in one viewport and share three visible slots. Operational notices take precedence; transient toasts wait their turn and do not expire unseen. The operational queue, severities, sounds, timers, navigation and mark-read logic are unchanged.
- **Behaviour.** Success clears after 3 s, info after 4 s, warning after 6.5 s and error after 8 s. Hover, keyboard focus and a hidden tab pause the timer. An identical active message is suppressed. The queue holds at most 20 entries. Escape closes the focused toast only. Arrival never steals focus. Motion is a short fade and slide, and is disabled under reduced motion.
- **API.** Existing `toast.success|error|info(string)` calls work unchanged, all 291 of them. New: `toast.warning`, an optional second `description` argument, and `{ title, description, action }`. The API object identity stays stable; the Orders LINE wizard depends on that.

## Touched files

- `src/components/Toast.tsx` (provider and API)
- `src/components/ToastCard.tsx` (new)
- `src/lib/toastQueue.ts` (new; pure queue rules)
- `src/components/notifications/NoticeViewport.tsx` and `notices.css` (new; shared lane)
- `src/components/notifications/NotificationHost.tsx` (renders into the shared lane, restyled)
- `src/pages/products/ProductEditor.tsx` (price toast copy only)
- `src/i18n/en.ts`
- Tests and QA: `tests/toast-queue.test.ts`, `e2e/toast-ux.demo.ts`, `e2e/toast-harness.{html,tsx}`, `playwright.toast.config.ts`, and a CI step in `.github/workflows/ci.yml`

## Verification

| Check | Result |
|---|---|
| `tests/toast-queue.test.ts` | First run failed with the module missing, then 9/9 passed |
| Browser dedupe test on the old toast | Failed (8 identical toasts), then passed |
| `npx playwright test -c playwright.toast.config.ts` | 13/13 passed, zero retries |
| Real price save in the product editor (demo mode) | Title and `฿350.2203 ต่อ KG` shown, card ≤360 px |
| `npm test` | 1335 passed, 110 files |
| `npm run test:rules` | Passed |
| `npm run test:e2e` (emulator) | 68 passed; 2 pre-existing real-data benchmark skips |
| `npm run build`, lint, i18n | Passed; lint 0 errors |
| Main CI bundle budget 2950/3450 KB | Passed with 129 bytes of initial-JS headroom (+4,323 bytes) |

The full emulator suite exercises receive-PO, supplier, brand-switch, dialog and hostile-client flows through the new host. Price save is covered by the demo-mode real-UI test above. Order save, supplier and order edit, and transfer success toasts use the unchanged string API. Their rendering is covered by the harness variants, but there is no dedicated end-to-end UI test for each of those flows; that is a stated gap, not a claimed pass.

## Screenshots

`before/` holds the old solid toast at 1440, 1024 and 390 px. `after/` holds the new card at the same widths, `1440-en.png`, and `1440-real-price-save.png` from the real product editor. All data is synthetic.

## Risk and rollback

- The initial-JS headroom left by this PR is 129 bytes. Rebasing onto other PRs that add eager code can exceed the main CI budget. Fix that by lazy loading or by landing the code-splitting PR, never by raising the limit.
- Rollback is a revert of this UI-only PR. No data is involved.
- Independent final-SHA review, final-head CI and remote Preview QA are pending at the first push.

## Skills

The Superpowers `writing-plans`, `test-driven-development`, `systematic-debugging` and `verification-before-completion` SKILL.md files were read in this session, at `C:/Users/Yutthachai/pzm-mission-runtime-20261014/superpowers/skills/<name>/SKILL.md`. Steps followed: the plan in `docs/superpowers/plans/2026-10-15-toast-ux.md`; tests written and observed failing first; an obsolete i18n key traced to its cause and removed; every gate run with output read. The `brainstorming` question loop was skipped because the Owner's brief fixed the design. The independent review is not yet done.
