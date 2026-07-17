import { backend } from '../backend'
import { COL, type Note } from '../types'

export async function createNote(
  title: string,
  body: string,
  byUserName: string,
): Promise<string> {
  const now = Date.now()
  return backend.add(COL.notes, {
    title: title.trim() || '(ไม่มีหัวข้อ)',
    body,
    byUserName,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<Note, 'title' | 'body' | 'pinned'>>,
): Promise<void> {
  await backend.update(COL.notes, id, { ...patch, updatedAt: Date.now() })
}

export async function deleteNote(id: string): Promise<void> {
  await backend.remove(COL.notes, id)
}
