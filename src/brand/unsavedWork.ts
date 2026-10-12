/**
 * Forms with something keyed in them, so a brand switch can say what it would set aside.
 *
 * Every screen that keeps a draft (lib/useDraft) reports here while its form is not empty,
 * with a way to save the draft at once. Drafts are kept per brand on this device, so a switch
 * does not throw them away — they come back when that brand is opened again — but the person
 * is told first, and the draft is written out before the screen closes (it is otherwise saved
 * 300 ms after the last keystroke, which a quick switch could cut short). Photos are never
 * part of a draft, which the warning says.
 */
export interface UnsavedEntry {
  /** The screen, as useDraft names it. */
  screen: string
  /** Save the draft now. */
  flush: () => void
}

const entries = new Map<string, UnsavedEntry>()

export function reportUnsaved(id: string, entry: UnsavedEntry | null): void {
  if (entry) entries.set(id, entry)
  else entries.delete(id)
}

export function unsavedWork(): UnsavedEntry[] {
  return [...entries.values()]
}

export function flushUnsaved(): void {
  for (const e of entries.values()) {
    try {
      e.flush()
    } catch {
      /* a draft that cannot be written is no reason to block the switch */
    }
  }
}
