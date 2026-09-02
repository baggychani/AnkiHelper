export type Field = { name: string; order: number }
export type Template = { name: string; front: string; back: string }
export type NoteType = { id: string; name: string; fields: Field[]; templates: Template[]; css: string; notes: string[][] }
export type MediaKind = 'audio' | 'image' | 'video' | 'font' | 'other'
export type MediaItem = { name: string; stored_name: string; size: number; type: MediaKind }
export type MediaReference = { filename: string; location: string; source: 'field' | 'template' | 'css' | 'script'; card: string | null; side: 'front' | 'back' | null }
export type MediaHealth = {
  missing: MediaReference[]
  references: Record<string, MediaReference[]>
  unused: MediaItem[]
  static_unreferenced: MediaItem[]
  mapped_missing: { name: string; stored_name: string }[]
  case_collisions: string[][]
  unindexed_entries: string[]
}
export type Workspace = {
  source: string
  source_name: string
  media_count: number
  note_types: NoteType[]
  selected_note_type_id: string | null
  requires_save_as: boolean
}

export type TablePreview = {
  source_name: string
  kind: 'xlsx' | 'csv' | 'tsv' | 'txt'
  sheet_names: string[]
  selected_sheet: string
  row_count: number
  column_count: number
  omitted_empty_columns: number
  sample_rows: string[][]
}

export type SourceNoteType = { id: string; name: string; fields: Field[]; template_count: number }
export type NoteTypeSource = { source_name: string; note_types: SourceNoteType[] }

const base = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8765'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: '요청을 처리하지 못했습니다.' }))
    throw new Error(detail.detail ?? '요청을 처리하지 못했습니다.')
  }
  return response.json() as Promise<T>
}

export const api = {
  status: () => request<Workspace | null>('/api/workspace'),
  selectNoteType: (noteTypeId: string) =>
    request<Workspace>('/api/workspace/selected-note-type', {
      method: 'PUT',
      body: JSON.stringify({ note_type_id: noteTypeId }),
    }),
  open: (path: string) => request<Workspace>('/api/packages/open', { method: 'POST', body: JSON.stringify({ path }) }),
  inspectTable: (path: string, sheetName?: string) =>
    request<TablePreview>('/api/tables/inspect', { method: 'POST', body: JSON.stringify({ path, sheet_name: sheetName ?? null }) }),
  inspectNoteTypeSource: (path: string) =>
    request<NoteTypeSource>('/api/note-types/source', { method: 'POST', body: JSON.stringify({ path }) }),
  createFromTable: (payload: {
    path: string
    sheetName?: string
    firstRowIsHeader: boolean
    fieldNames: string[]
    deckName: string
    noteTypeName: string
    frontField: number
    backField: number
    templateSourcePath?: string
    templateNoteTypeId?: string
    fieldMapping?: Record<number, number>
  }) => request<Workspace>('/api/tables/create', {
    method: 'POST',
    body: JSON.stringify({
      path: payload.path,
      sheet_name: payload.sheetName ?? null,
      first_row_is_header: payload.firstRowIsHeader,
      field_names: payload.fieldNames,
      deck_name: payload.deckName,
      note_type_name: payload.noteTypeName,
      front_field: payload.frontField,
      back_field: payload.backField,
      template_source_path: payload.templateSourcePath ?? null,
      template_note_type_id: payload.templateNoteTypeId ?? null,
      field_mapping: payload.fieldMapping ? Object.fromEntries(Object.entries(payload.fieldMapping).map(([source, destination]) => [String(source), destination])) : null,
    }),
  }),
  updateTemplate: (noteTypeId: string, index: number, patch: Partial<Template>) =>
    request<Workspace>(`/api/note-types/${noteTypeId}/templates/${index}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  updateCss: (noteTypeId: string, css: string) =>
    request<Workspace>(`/api/note-types/${noteTypeId}/css`, { method: 'PATCH', body: JSON.stringify({ css }) }),
  updateField: (noteTypeId: string, order: number, name: string) =>
    request<Workspace>(`/api/note-types/${noteTypeId}/fields/${order}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  addField: (noteTypeId: string, name: string) =>
    request<Workspace>(`/api/note-types/${noteTypeId}/fields`, { method: 'POST', body: JSON.stringify({ name }) }),
  deleteField: (noteTypeId: string, order: number) =>
    request<Workspace>(`/api/note-types/${noteTypeId}/fields/${order}`, { method: 'DELETE' }),
  reorderField: (noteTypeId: string, order: number, newOrder: number) =>
    request<Workspace>(`/api/note-types/${noteTypeId}/fields/${order}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ new_order: newOrder }),
    }),
  fieldContentSummary: (noteTypeId: string, order: number) =>
    request<{
      field_order: number
      filled: number
      text_only: number
      media_only: number
      mixed: number
      has_mixed: boolean
      destination_filled: Record<string, number>
      sample_text: string
      sample_media: string
    }>(`/api/note-types/${noteTypeId}/fields/${order}/content-summary`),
  moveFieldContents: (noteTypeId: string, order: number, destinationOrder: number, mode: 'text' | 'media' | 'all') =>
    request<{ workspace: Workspace; changed: number }>(`/api/note-types/${noteTypeId}/fields/${order}/move`, {
      method: 'POST',
      body: JSON.stringify({ destination_order: destinationOrder, mode }),
    }),
  updateNoteField: (noteTypeId: string, noteIndex: number, fieldOrder: number, value: string) =>
    request<Workspace>(`/api/note-types/${noteTypeId}/notes/${noteIndex}/fields/${fieldOrder}`, { method: 'PATCH', body: JSON.stringify({ value }) }),
  cloneNoteType: (noteTypeId: string, name: string, moveCards = true) =>
    request<Workspace>(`/api/note-types/${noteTypeId}/clone`, { method: 'POST', body: JSON.stringify({ name, move_cards: moveCards }) }),
  deleteNoteType: (noteTypeId: string) =>
    request<Workspace>(`/api/note-types/${noteTypeId}`, { method: 'DELETE' }),
  moveNotes: (noteTypeId: string, destinationId: string, mapping?: Record<number, number>) =>
    request<{ workspace: Workspace; moved: number }>(`/api/note-types/${noteTypeId}/move-notes`, {
      method: 'POST',
      body: JSON.stringify({
        destination_id: destinationId,
        mapping: mapping
          ? Object.fromEntries(Object.entries(mapping).map(([source, destination]) => [String(source), destination]))
          : null,
      }),
    }),
  savePackage: (path?: string) =>
    request<{ workspace: Workspace; saved_to: string; backup: string | null }>('/api/packages/save', { method: 'POST', body: JSON.stringify({ path: path ?? null }) }),
  media: () => request<MediaItem[]>('/api/media'),
  mediaHealth: () => request<MediaHealth>('/api/media/health'),
  importMedia: (paths: string[], templateAsset = false) => request<{ workspace: Workspace; items: MediaItem[] }>('/api/media/import', { method: 'POST', body: JSON.stringify({ paths, template_asset: templateAsset }) }),
  renameMedia: (storedName: string, name: string) => request<{ workspace: Workspace; item: MediaItem; old_name: string; new_name: string }>(`/api/media/${encodeURIComponent(storedName)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteMedia: (storedName: string, force = false) => request<{ workspace: Workspace }>(`/api/media/${encodeURIComponent(storedName)}?force=${force}`, { method: 'DELETE' }),
  mediaUrl: (storedName: string) => `${base}/api/media/${encodeURIComponent(storedName)}`,
  importProject: (path: string) => request<{ workspace: Workspace; note_type_id: string }>('/api/projects/import', { method: 'POST', body: JSON.stringify({ path }) }),
  preview: (noteTypeId: string, templateIndex: number, side: 'front' | 'back', noteIndex: number, signal?: AbortSignal) =>
    request<{ html: string }>(`/api/note-types/${noteTypeId}/preview?template_index=${templateIndex}&side=${side}&note_index=${noteIndex}`, { signal }),
  exportUrl: (kind: 'tsv' | 'design' | 'bundle' | 'media' | 'project', noteTypeId: string, mediaType?: MediaKind, storedNames?: string[]) => {
    const params = new URLSearchParams()
    if (kind === 'media' && mediaType) params.set('media_type', mediaType)
    if (kind === 'media' && storedNames?.length) storedNames.forEach((name) => params.append('names', name))
    const query = params.toString()
    return `${base}/api/note-types/${noteTypeId}/export/${kind}${query ? `?${query}` : ''}`
  },
}
