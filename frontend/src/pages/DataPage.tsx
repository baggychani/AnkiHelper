import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Image, Music2 } from 'lucide-react'
import type { NoteType } from '../api'

function splitCellContent(value: string) {
  const mediaMatches = [...value.matchAll(/\[sound:([^\]]+)\]|<(img|audio|video)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/\2>)?/gi)]
  const media = mediaMatches.map((match) => {
    const filename = match[1] ?? match[3]?.split(/[\\/]/).pop() ?? ''
    return { filename, isSound: Boolean(match[1]) || match[2] !== 'img' }
  }).filter((item) => item.filename)
  const text = value
    .replace(/\[sound:[^\]]+\]/gi, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<(audio|video)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { text, media, filename: media[0]?.filename, isSound: media[0]?.isSound ?? false }
}

export function DataPage({ noteType, onUpdate }: { noteType?: NoteType; onUpdate: (row: number, fieldOrder: number, value: string) => Promise<void> }) {
  const columns = useMemo(() => {
    if (!noteType) return []
    return noteType.fields.map((field) => {
      const values = noteType.notes.slice(0, 300).map((row) => row[field.order] ?? '')
      const populated = values.filter((value) => value.trim())
      const mediaOnly = populated.filter((value) => {
        const parts = splitCellContent(value)
        return Boolean(parts.filename) && !parts.text
      }).length
      const mixed = populated.filter((value) => {
        const parts = splitCellContent(value)
        return Boolean(parts.filename) && Boolean(parts.text)
      }).length
      const mediaName = /^(sound|audio|voice|media|image|photo|음성|소리|미디어|이미지)$/i.test(field.name.trim())
      // Only treat as media-only column when cells are mostly media without accompanying text.
      const media = mediaName || (populated.length > 0 && mediaOnly / populated.length >= 0.7 && mixed / populated.length < 0.3)
      if (media) return { media: true, minWidth: 184, track: '184px' }

      const lengths = populated.map((value) => splitCellContent(value).text.replace(/<[^>]*>/g, '').trim().length || value.replace(/<[^>]*>/g, '').trim().length).sort((a, b) => a - b)
      const typical = lengths.length ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.85))] : field.name.length
      const density = values.length ? populated.length / values.length : 0
      const effectiveLength = typical * (0.25 + density * 0.75)
      const primaryText = density > 0.1 && /(meaning|definition|example|sentence|뜻|의미|예문|설명)/i.test(field.name)
      const secondaryText = density > 0.1 && /^(note|memo|비고|메모)$/i.test(field.name)
      const minWidth = Math.max(primaryText ? 160 : mixed > 0 ? 200 : 112, Math.min(260, 92 + effectiveLength * 4))
      const weight = Math.max(0.8, Math.min(2.7, 0.75 + effectiveLength / 13 + (primaryText ? 0.55 : secondaryText ? 0.1 : 0) + (mixed > 0 ? 0.35 : 0)))
      return { media: false, minWidth, track: `minmax(${minWidth}px, ${weight.toFixed(2)}fr)` }
    })
  }, [noteType])
  if (!noteType) return null
  const template = columns.map((column) => column.track).join(' ')
  const minimumWidth = columns.reduce((sum, column) => sum + column.minWidth, 0)
  return <section className="mx-auto max-w-[1420px] overflow-hidden rounded-[18px] border border-slate-200/70 bg-white shadow-card lg:rounded-[22px]">
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 lg:px-5 lg:py-4"><h2 className="text-lg font-semibold">카드 데이터</h2><span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600">{noteType.notes.length.toLocaleString()}개 카드</span></div>
    <div role="table" aria-label="카드 데이터" className="overflow-x-auto">
      <div role="rowgroup" style={{ minWidth: minimumWidth }}>
        <div role="row" className="sticky top-0 z-10 grid border-b border-slate-100 bg-slate-50" style={{ gridTemplateColumns: template }}>
          {noteType.fields.map((field) => <div role="columnheader" key={field.order} className="min-w-0 whitespace-nowrap px-4 py-3 text-xs font-bold text-slate-400">{field.name}</div>)}
        </div>
        {noteType.notes.map((values, row) => <div role="row" key={row} className="grid border-b border-slate-100 last:border-b-0 hover:bg-indigo-50/30" style={{ gridTemplateColumns: template }}>{noteType.fields.map((field) => <div role="cell" key={field.order} className="min-w-0 px-2 py-2 text-sm text-slate-600"><DataValue row={row} fieldOrder={field.order} value={values[field.order]} onUpdate={onUpdate} /></div>)}</div>)}
      </div>
    </div>
  </section>
}

function MediaChip({ filename, isSound }: { filename: string; isSound: boolean }) {
  const MediaIcon = isSound ? Music2 : Image
  return <button onClick={() => { sessionStorage.setItem('ankihelper:media-focus', filename); window.dispatchEvent(new CustomEvent('ankihelper:navigate', { detail: 'media' })) }} title="미디어 관리에서 확인" className="inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-lg bg-violet-50 px-2 text-left text-[11px] font-semibold text-violet-700 hover:bg-violet-100">
    <MediaIcon size={13} className="shrink-0" /><span className="min-w-0 truncate">{filename}</span><ArrowRight size={12} className="shrink-0 opacity-60" />
  </button>
}

function DataValue({ row, fieldOrder, value = '', onUpdate }: { row: number; fieldOrder: number; value?: string; onUpdate: (row: number, fieldOrder: number, value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const skipBlur = useRef(false)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  const { text, media } = splitCellContent(value)

  const commit = async () => {
    if (saving) return
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    try { await onUpdate(row, fieldOrder, draft); setEditing(false) }
    catch { /* 상위 화면의 공통 오류 창에서 안내하고 편집 상태는 유지합니다. */ }
    finally { setSaving(false) }
  }

  if (editing) return <textarea autoFocus rows={Math.min(4, Math.max(1, draft.split('\n').length))} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return } void commit() }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur() } else if (event.key === 'Escape') { event.preventDefault(); skipBlur.current = true; setDraft(value); setEditing(false) } }} disabled={saving} className="min-h-9 w-full resize-none rounded-lg border border-indigo-300 bg-white px-2.5 py-2 text-sm leading-5 text-slate-700 outline-none ring-2 ring-indigo-100" />

  if (media.length && !text) {
    return <div className="flex min-h-9 w-full flex-wrap gap-1.5">{media.map((item) => <MediaChip key={`${item.filename}-${item.isSound}`} filename={item.filename} isSound={item.isSound} />)}</div>
  }

  if (media.length && text) {
    return <div className="flex min-h-9 w-full flex-col gap-1.5 rounded-lg px-1.5 py-1.5 hover:bg-indigo-50">
      <button onDoubleClick={() => setEditing(true)} title="더블클릭하여 수정" className="w-full text-left leading-5">
        <span className="line-clamp-2 whitespace-pre-wrap text-slate-700">{text}</span>
      </button>
      <div className="flex flex-wrap gap-1.5">{media.map((item) => <MediaChip key={`${item.filename}-${item.isSound}`} filename={item.filename} isSound={item.isSound} />)}</div>
    </div>
  }

  return <button onDoubleClick={() => setEditing(true)} title="더블클릭하여 수정" className="block min-h-9 w-full rounded-lg px-2.5 py-2 text-left leading-5 hover:bg-indigo-50">{value ? <span className="line-clamp-2 whitespace-pre-wrap">{value}</span> : <span className="text-slate-300">—</span>}</button>
}

