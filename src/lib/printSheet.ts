/**
 * Print one element on its own — the order sheet (A5, see index.css).
 *
 * It used to be printed where it sat: inside the order's dialog, with everything else on
 * the page hidden by `visibility`. Two things made that eight pages (owner, 27 Sep 2026):
 * hidden content still takes its room, so the orders list behind the dialog set the page
 * count; and the dialog is `position: fixed`, which Chrome repeats on every printed page —
 * so every page carried the same sheet.
 *
 * Now a copy goes into a container straight under <body> and print CSS shows only that
 * container, with nothing else in the flow: one sheet, one page (more only if the sheet
 * itself is longer than A5). The copy is removed when printing ends.
 */
export const PRINT_ROOT_ID = 'print-root'

export function printElement(el: HTMLElement): void {
  document.getElementById(PRINT_ROOT_ID)?.remove()
  const root = document.createElement('div')
  root.id = PRINT_ROOT_ID
  const copy = el.cloneNode(true) as HTMLElement
  // The original keeps its id; two elements with one id would confuse anything that looks it up.
  copy.removeAttribute('id')
  root.appendChild(copy)
  document.body.appendChild(root)

  // Desktop browsers block in print() until the dialog closes and then fire afterprint;
  // phones may return at once and print later, so the copy is only removed on afterprint
  // (or replaced by the next print).
  const done = () => {
    window.removeEventListener('afterprint', done)
    root.remove()
  }
  window.addEventListener('afterprint', done)
  window.print()
}
