import type { NoteType, Workspace } from './api'

export type EditorMode = 'front' | 'back' | 'css'

export function parseDesignDraftKey(key: string): { noteTypeId: string; index: number; mode: EditorMode } | null {
  const modeSep = key.lastIndexOf(':')
  if (modeSep <= 0) return null
  const mode = key.slice(modeSep + 1)
  if (mode !== 'front' && mode !== 'back' && mode !== 'css') return null
  const indexSep = key.lastIndexOf(':', modeSep - 1)
  if (indexSep < 0) return null
  const index = Number(key.slice(indexSep + 1, modeSep))
  if (!Number.isInteger(index) || index < 0) return null
  return { noteTypeId: key.slice(0, indexSep), index, mode }
}

export function designDraftSavedValue(noteType: NoteType, index: number, mode: EditorMode) {
  if (mode === 'css') return noteType.css
  return noteType.templates[index]?.[mode] ?? ''
}

export function designDraftsArePending(drafts: Record<string, string>, workspace: Workspace | null) {
  if (!workspace) return false
  return Object.entries(drafts).some(([key, draftValue]) => {
    const parsed = parseDesignDraftKey(key)
    if (!parsed) return false
    const noteType = workspace.note_types.find((item) => item.id === parsed.noteTypeId)
    if (!noteType) return Boolean(draftValue)
    return draftValue !== designDraftSavedValue(noteType, parsed.index, parsed.mode)
  })
}
