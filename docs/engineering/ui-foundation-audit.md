# P2 Modern PZM UI foundation: audit of what exists, and the plan

Owner brief of 8 Oct 2026: audit first; no duplicate system; keep `Icon` as the compatibility
boundary; pilot on Receiving, the PO list and detail, and the Manager Decision Inbox; no
whole-app redesign in one commit.

## 1. What exists today (read from the code, 8 Oct)

| Area | Implementation | Usage | Status |
|---|---|---|---|
| Tokens / theme | Tailwind 4 `@theme` tokens (`ink`, `surface`, `line`, `sunken`, brand colours); `focusRing` shared class | Everywhere | Good. Brand theming per Pizza Mania / Le Lapin is token-based. |
| Icons | `src/components/Icon.tsx`: a Lucide-derived inline SVG set behind `name=` | Everywhere | **Keep as the boundary.** Adding `lucide-react` behind it is optional: it would let `Icon` map names to Lucide components without touching call sites. |
| Primitives | `src/components/ui.tsx` (875 lines): Button, Card, Field, Input, Textarea, Select (**native**), Badge, Spinner, **Modal**, SegTab, SectionHeader, EmptyState, StatTile, **StatusTabs**, AlertBanner, SearchInput, Pagination | 47 `<Modal>`, many of the rest | One system. **No second system may be added beside it.** |
| Dialog | Hand-written `Modal`: `role="dialog"`, `aria-modal`, `aria-labelledby`, a Tab trap, Escape, focus restore, overlay rules (press and release both on the backdrop; `keepOnOverlay`), compact/side/sheet variants | 47 call sites; `ConfirmProvider` opens **on top of** other dialogs | **Defects, see §2** |
| Confirm (AlertDialog) | `Confirm.tsx` via `useConfirm()`, built on `Modal compact` | App-wide | It is a `dialog`, not an `alertdialog`. Initial focus goes to the first button. |
| Toast | `Toast.tsx`: one context, one API | 54 files | **One system. Keep it.** Notifications popups are separate by design (NotificationHost) |
| Tabs | `StatusTabs` uses `role="tablist"` / `tab` / `aria-selected`; `SegTab` uses `aria-pressed` | Lists | **Partial ARIA**: no arrow-key movement or roving tabindex, and no `tabpanel` link |
| Menu | `frame/RowMenu.tsx` uses `role="menu"` / `menuitem` with Escape | Row actions | **Partial**: no arrow keys, no focus moved into the menu, and focus return is unverified |
| Combobox | `requests/ProductPicker.tsx` uses `listbox` / `option` with ArrowUp/Down on the search input | Requests | **Partial**: the input lacks `role="combobox"`, `aria-controls` and `aria-activedescendant`, so screen readers do not hear the moving cursor |
| Select | Native `<select>` | Forms | Good on mobile, and accessible by default. **Keep native** unless a searchable select is needed. |
| Popover / Sheet | Ad hoc (`aria-expanded` in TopBar ×9, SidePanel, Why, DeliveryRiskPanel); `Modal sheet` | Several | No shared popover primitive; each handles outside-click and Escape itself |
| Tests | Playwright 1.63, `@axe-core/playwright` (`e2e/a11y.spec.ts`) | — | There is no DOM unit-test library (no `@testing-library`, no jsdom); UI behaviour is tested in Playwright |

## 2. Defects found by the audit

1. **Stacked dialogs: Escape closes every open dialog, not only the top one.**
   - Each open `Modal` adds its own capture-phase `keydown` listener on `document`.
     `stopPropagation()` does not stop other listeners on the same node, so all of them run.
   - Example: a `useConfirm()` question raised from inside an edit dialog. Escape on the
     question also closes the edit dialog behind it, and the half-done form is lost.
   - The same applies to Tab: the **outer** dialog's trap (registered first) sees focus
     outside its own panel, and pulls it back into itself.
   - **Status:** found by reading the code. To be proven by a Playwright test, then fixed by a
     dialog stack in which only the top dialog handles keys.
2. **Background content is not inert.** `aria-modal` alone is not honoured by every screen
   reader. The page behind should get `inert` while a dialog is open.
3. **No scroll lock.** On iOS the page behind can scroll under a full-height dialog.
   `overscroll-contain` on the overlay helps, but the body still scrolls.
4. The ARIA gaps in tabs, menu and combobox listed in §1.

## 3. shadcn/ui, Radix, lucide-react: selective evaluation

| Candidate | Would give | Cost / risk | Recommendation |
|---|---|---|---|
| **Radix Dialog / AlertDialog** (`@radix-ui/react-dialog`) | Correct stacking, `inert`-style hiding of the rest of the page, scroll lock, portal, `alertdialog` role | About 10–15 KB gzip, measured before adoption. A portal moves dialogs to the end of `body`, so e2e selectors scoped to page regions must be checked. Overlay behaviour must be re-created (`onPointerDownOutside` and `onInteractOutside` for `keepOnOverlay` and the drag-out rule). | **Adopt behind the existing `Modal` API**, so there are 0 call-site changes. This is a separate, reviewable commit, done after the in-house stack fix proves the tests. |
| Radix Tabs / DropdownMenu / Popover | Arrow keys, roving focus, collision-aware positioning | Small per package | Adopt **per pilot screen**, behind `StatusTabs` / `RowMenu` / a new `Popover` in `ui.tsx` |
| Radix Select | Styled select | Loses native mobile pickers | **Do not adopt.** Keep native `<select>`. |
| cmdk / Radix Combobox pattern | A searchable product picker | — | Only for ProductPicker; fixing its ARIA is cheaper first |
| **shadcn/ui** as a whole | Copy-in components built on Radix + Tailwind | It is a second visual system with its own tokens (`--primary`, …) and would duplicate `ui.tsx` | **Do not install wholesale.** Borrow patterns file by file into `ui.tsx`, mapped to our tokens. |
| `lucide-react` | A maintained icon set | Tree-shaken per icon | Optional, **only inside `Icon.tsx`** |
| A second toast library (sonner etc.) | — | Duplicates `Toast.tsx` | **No** |

## 4. Pilot plan (one screen per commit, each with before/after evidence)

1. **Foundation commit:**
   - the dialog stack fix, with a Playwright test that fails before and passes after;
   - `inert` on the background;
   - body scroll lock;
   - `role="alertdialog"` for Confirm.
2. **Receiving:**
   - an obvious next action ("ยืนยันรับ" as the one primary button);
   - keyboard from line to line;
   - the duplicate-submit guard visible as a state on the button;
   - layout at 375 / 768 / 1440 px.
3. **PO list and detail:**
   - `StatusTabs` with arrow keys;
   - `RowMenu` with proper menu keyboard behaviour;
   - empty, loading and error states from `EmptyState` / `AlertBanner`.
4. **Manager Decision Inbox:** one list, one next action per row, with keyboard access.

**Evidence per pilot commit:**
- Playwright screenshots at 375, 768 and 1440 px, in Thai and English;
- axe WCAG A/AA scan of that screen: 0 serious and 0 critical;
- keyboard script: Tab order, focus trap and restore, Escape with stacked dialogs;
- the stale-state and duplicate-submit e2e for that flow;
- the `npm run build` bundle delta against the budget (`scripts/bundle-budget.mjs`).

**Unchanged in every commit:**
- Pizza Mania and Le Lapin branding;
- Thai/English typography (LINE Seed Sans TH);
- status colours and meanings;
- the notification architecture.
