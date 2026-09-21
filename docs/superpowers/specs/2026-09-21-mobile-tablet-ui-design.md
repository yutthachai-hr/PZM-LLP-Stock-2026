# Mobile and tablet UI — design (21 Sep 2026)

Owner's ask: the app must work properly on phones and tablets ("ตอนนี้ใช้ยาก"). Both are used
equally; branch staff on phones (issue/count), the main warehouse on a 10" tablet
(receive/order). No Figma exists; the design below was chosen screen by screen with the owner
(mockups in `.superpowers/brainstorm/`, gitignored). Desktop (≥1280px) does not change.

## 1. Three sizes

| Size | Navigation | Lists | Forms |
|---|---|---|---|
| **Phone** < 768px | Bottom tab bar: หน้าแรก · สต๊อก · **+** · ประวัติ · เพิ่มเติม. The **+** opens an action sheet "ทำรายการ": รับเข้า / เบิก-โอน / ปรับสต๊อก / ขอสั่งซื้อ (+ สั่งของใหม่ for manager/admin). Slim top bar: page title, bell, search. | Cards | One column; save bar fixed above the tab bar |
| **Tablet** 768–1279px | Left rail, 72px, every nav item as icon + short label, the **+** in the rail. Portrait too — no drawer. | Tables (as desktop) | Two columns; the today panel beside the form at ≥1024px, folded under it below that |
| **Desktop** ≥ 1280px | Unchanged (256px sidebar, white sheet) | Unchanged | Unchanged |

"เพิ่มเติม" on the phone is a page listing the rest of the menu (ปฏิทิน, รายงาน, ขอสั่งซื้อ,
สั่งซื้อ, ผู้ขาย, นำเข้า Excel [admin], ตั้งค่า, สลับแบรนด์, ออกจากระบบ). A page opened from it
highlights "เพิ่มเติม" in the tab bar. The existing drawer goes away on phone and tablet.

## 2. Phone home (replaces ภาพรวม on phones only)

Top: three stat tiles — ของใกล้หมด · ใบสั่งรอรับ / เลยกำหนด · [manager] ใบขอสั่งซื้อรออนุมัติ —
each a link to that page with the filter set. Then "รายการที่ฉันทำวันนี้" (all types, editable
like the form-side panel), then today's/tomorrow's calendar items if any. Desktop keeps the
current dashboard.

## 3. Keying screens on the phone (รับเข้า / โอน / เบิกใช้ / ปรับสต๊อก)

- Top row: site ▾ and date as two small fields on one line. The actor is not shown (recorded
  automatically anyway).
- The product search sits at the top of the line section; results are a full-width list showing
  name · sku · on hand at that site.
- Tapping a product opens the **QtySheet** from the bottom: name + on hand, a large number field
  (numeric keyboard, focused at once), unit ▾ (same ask-once rate prompt), a conversion line
  ("= 16 EA"), and "เพิ่มรายการ" — which returns focus to the search for the next line. Issuing
  more than on hand warns inside the sheet.
- Added lines are cards; tapping one reopens the sheet to change qty/unit; × removes it.
- Delivery-note/notes field and the photo button (เบิกใช้) sit under the lines.
- **SaveBar** fixed above the tab bar: "บันทึกรับเข้า (2 รายการ)", one tap, disabled while busy.
- The "รายการที่ทำวันนี้" panel is folded under the form (count in its header), tap to expand;
  new rows appear at once (recentWrites) and drafts (useDraft) work as they do now.
- ปรับสต๊อก uses the same shape for one product: search → sheet with qty, direction in/out,
  reason.
- Tablet/desktop keep the current inline qty/unit rows, with the SaveBar.

## 4. Long lists on the phone (cards instead of tables)

| Page | Card shows | Card actions |
|---|---|---|
| สั่งซื้อ | supplier · PO no · status / late / Rev. · N lines · due date | ดูใบ · ส่ง LINE · ตรวจรับ |
| ขอสั่งซื้อ | PR no · status · requester · N items · date | open |
| สินค้าคงคลัง / stock report | name · sku · **large quantity** + larger-unit breakdown (66 Carton) · low badge | tap → detail/edit |
| ประวัติ / Stock Card | name · qty (as keyed = base) · type · site · doc no · by | แก้ไข · ยกเลิก |
| ผู้ขาย | name · type · lead time · N products | open |
| other reports / activity | same summary rows; Excel/PDF buttons stay | — |

Filters on the phone: a search field + horizontally scrolling chips instead of a row of
buttons; pagination becomes "โหลดเพิ่ม". Tablet/desktop keep the tables.

## 5. Modals on the phone → full screen

Every Modal (edit movement, receive, order sheet, product editor, send wizard, confirms) opens
full-screen below 768px: sticky header (title + ×), scrolling body, primary button fixed at the
bottom. Done once in the shared Modal. Short confirms (delete/cancel) are a small bottom sheet.

## 6. Components to build (shared)

`BottomTabBar` (phone) · `ActionSheet` "ทำรายการ" · `NavRail` (tablet) · `BottomSheet`
(generic; drag/swipe to close; keeps the focused field above the keyboard) · `QtySheet` (qty +
unit + on hand + conversion) · `SaveBar` · `FilterChips` · `useViewport()` → phone / tablet /
desktop · `Modal` full-screen mode on phones · `DataTable` card mode extended (a "large" column,
actions in the card). Every tap target ≥ 44px; number fields use `inputMode="decimal"`; no
horizontal page scroll anywhere.

## 7. Out of scope

Stock, purchasing, rules, data — appearance only. Desktop ≥1280px unchanged. Every new Thai
string gets an English entry (`npm run i18n:check`).

## 8. Rollout (each round deploys; verified in the demo at 375 / 768 / 1024 before going live)

1. **Shells**: tab bar + FAB + action sheet · tablet rail · full-screen Modal · SaveBar · BottomSheet
2. **Keying screens**: receive / transfer / consume / adjust + QtySheet + foldable today panel
3. **Lists**: orders · requests · products · movements · reports · suppliers (cards + chips + load more)
4. **Phone home** + finishing: calendar, settings, receive modal, send-to-LINE on phone, any remaining overflow
