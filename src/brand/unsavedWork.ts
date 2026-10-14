/**
 * Forms with something keyed in them, so a brand switch can say what it would set aside.
 *
 * Every screen that keeps a draft (lib/useDraft) reports here while its form is not empty,
 * with a way to save the draft at once. Drafts are kept per brand and per person on this
 * device, so a switch does not throw them away — they come back when that brand is opened
 * again — but only if the draft really was written: a switch whose drafts cannot all be saved
 * does not happen (owner, 12 Oct 2026). Photos are never part of a draft, which the warning says.
 */
export interface UnsavedEntry {
  /** The screen, as useDraft names it. */
  screen: string
  /** Save the draft now. True only once the stored copy has been read back and matches. */
  flush: () => boolean
}

const entries = new Map<string, UnsavedEntry>()

export function reportUnsaved(id: string, entry: UnsavedEntry | null): void {
  if (entry) entries.set(id, entry)
  else entries.delete(id)
}

export function unsavedWork(): UnsavedEntry[] {
  return [...entries.values()]
}

/** Save every open draft now. `failed` names the screens whose draft could not be kept. */
export function flushUnsaved(): { saved: string[]; failed: string[] } {
  const saved: string[] = []
  const failed: string[] = []
  for (const e of entries.values()) {
    let ok = false
    try {
      ok = e.flush() === true
    } catch {
      ok = false
    }
    ;(ok ? saved : failed).push(e.screen)
  }
  return { saved, failed }
}
