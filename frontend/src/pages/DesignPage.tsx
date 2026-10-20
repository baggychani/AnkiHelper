import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Check, Copy, FolderInput, RotateCcw, Save } from 'lucide-react'
import { api, type NoteType } from '../api'
import type { EditorMode } from '../designDrafts'
const CodeEditor = lazy(() => import('../components/CodeEditor').then((module) => ({ default: module.CodeEditor })))

export function DesignPage({ noteType, index, setIndex, drafts, setDrafts, onSave, onImportDesign, notify }: {
  noteType?: NoteType
  index: number
  setIndex: (index: number) => void
  drafts: Record<string, string>
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>
  onSave: (mode: EditorMode, value: string) => Promise<boolean>
  onImportDesign?: () => void
  notify: (message: string) => void
}) {
  const [mode, setMode] = useState<EditorMode>('front')
  const [mediaNames, setMediaNames] = useState<string[]>([])
  const fieldNames = useMemo(() => noteType?.fields.map((field) => field.name) ?? [], [noteType?.fields])
  const template = noteType?.templates[index]
  const value = mode === 'css' ? noteType?.css ?? '' : template?.[mode] ?? ''
  const draftKey = `${noteType?.id ?? ''}:${index}:${mode}`
  const draft = drafts[draftKey] ?? value
  const changed = draft !== value
  const updateDraft = (nextValue: string) => setDrafts((current) => ({ ...current, [draftKey]: nextValue }))
  const discardDraft = useCallback(() => setDrafts(({ [draftKey]: _discarded, ...remaining }) => remaining), [draftKey, setDrafts])
  const loadMediaNames = useCallback(async () => {
    setMediaNames((await api.media()).map((item) => item.name))
  }, [])
  const apply = useCallback(async () => {
    if (!changed) return
    if (!await onSave(mode, draft)) return
    // Keep edits made while the request was in flight.
    setDrafts((current) => {
      if (current[draftKey] !== draft) return current
      const { [draftKey]: _saved, ...remaining } = current
      return remaining
    })
  }, [changed, draft, draftKey, mode, onSave, setDrafts])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void apply() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [apply])
  useEffect(() => {
    const onMediaChanged = () => {
      void loadMediaNames().catch(() => setMediaNames([]))
    }
    void loadMediaNames().catch(() => setMediaNames([]))
    window.addEventListener('ankihelper:media-changed', onMediaChanged)
    return () => window.removeEventListener('ankihelper:media-changed', onMediaChanged)
  }, [loadMediaNames])
  if (!noteType) return null
  return <div className="mx-auto grid h-full max-w-[1420px] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
    <aside className="max-h-[142px] overflow-y-auto rounded-[18px] border border-slate-200/70 bg-white p-3 shadow-card lg:max-h-none lg:rounded-[22px]"><h2 className="px-2 pb-3 pt-2 text-base font-semibold">카드 레이아웃</h2>{noteType.templates.map((item, itemIndex) => <button key={itemIndex} onClick={() => setIndex(itemIndex)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${itemIndex === index ? 'bg-[#151d31] text-white' : 'hover:bg-slate-50'}`}><span className="text-xs font-bold">{String(itemIndex + 1).padStart(2, '0')}</span>{item.name}</button>)}</aside>
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-200/70 bg-white shadow-card">
      <div className="flex shrink-0 flex-nowrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div className="flex shrink-0 gap-1 rounded-xl bg-slate-100 p-1">{([['front', '앞면 HTML'], ['back', '뒷면 HTML'], ['css', '공통 CSS']] as const).map(([id, label]) => <button key={id} onClick={() => setMode(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{label}</button>)}</div><div className="ml-auto flex shrink-0 items-center gap-2"><button onClick={onImportDesign} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"><FolderInput size={14} />디자인 가져오기</button><button onClick={async () => { await navigator.clipboard.writeText(draft); notify('코드를 복사했습니다.') }} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"><Copy size={14} />복사</button>{changed ? <><button onClick={discardDraft} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"><RotateCcw size={14} />되돌리기</button><button onClick={apply} className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-700"><Save size={14} />작업본에 저장</button></> : <span role="status" className="inline-flex h-9 items-center gap-1.5 px-2 text-xs font-medium text-slate-400"><Check size={14} className="text-emerald-500" />작업본에 저장됨</span>}</div></div>
      <Suspense fallback={<div role="status" className="grid flex-1 place-items-center bg-[#0d1425] text-sm text-slate-400">코드 편집기를 준비하는 중…</div>}>
        <CodeEditor key={draftKey} value={draft} mode={mode} mediaNames={mediaNames} fieldNames={fieldNames} onChange={updateDraft} />
      </Suspense>
    </section>
  </div>
}
