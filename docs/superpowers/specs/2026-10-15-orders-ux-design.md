# Orders UX simplification

The owner's 2026-10-15 brief is the approved requirement and authorizes immediate execution. Preserve business logic, Firestore rules, schema, action eligibility, existing OrderSheet, LINE resume and brand remount behavior. No dashboard changes.

## Presentation

Reuse the current brand tokens, Anuphan/Jakarta typography, white surfaces and restrained borders. The signature is a quiet supplier-first list with one state badge and one next action. Supplier is the row heading; PO/revision, location and item count sit below it. Due date is a short separate column. Do not hide supplier confirmation to reduce density.

A pure `presentOrderStatus(order, late)` returns primary `{label,color}`, secondary signals, urgency and a recommended action. These are presentation values, not persisted states or permission decisions. Prioritize terminal state, draft, resend, pending date approval, overdue, partial, supplier response, then ordered. Closed-short orders must not be called fully received. Never infer supplier confirmation from shareStatus. Use the real confirmed/changed/pending/waiting fields; missing confirmation is not waiting.

One filled action follows the recommendation. Receiving stays visible either as the main action or an adjacent secondary action when sending or reviewing a proposed date is primary. All remaining eligible commands go to the existing RowMenu. Preserve the exact existing conditions for edit/cancel/close-short/send/receive. Cancellation and close-short still use ReasonModal. A pending-date shortcut opens the existing sheet and its permission-controlled panel, not a new approval flow.

## Interaction

Rows and mobile cards open via setViewing. Native controls, links, menu portals, labels and editable content must not activate the row. Enter/Space on the row itself opens the correct order, with visible focus. Preserve table semantics. No nested button wrapper. Text selection must not open a document. Existing DataTable callers receive additive keyboard and safe bubbling support; test this shared blast radius.

Keep tabs first, then search and supplier/status filters. Group date window and export tools compactly without removing capabilities or changing export scope. Mobile cards show supplier response without tapping, with actions below content. Test 1440, 1024, 390 widths in TH and EN.

## Acceptance and release

Test pure status permutations, rows/cards, nested actions, keyboard, multi-select, deep links, LINE resume, supplier updates and three-brand isolation. Capture comparable synthetic Before/After screenshots. Full tests, typecheck/lint/i18n/build, relevant emulator/E2E, final-head GitHub CI, isolated Preview QA, independent approved OpenCode exact-SHA review, rollback plan, then sequential auto-merge and read-only production smoke. A blocked gate is not a pass.
