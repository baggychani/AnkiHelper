import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Check, Copy, RotateCcw, Save } from 'lucide-react'
import { api, type NoteType, type Workspace } from '../api'
import type { EditorMode } from '../designDrafts'

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function highlightCode(value: string, mode: EditorMode, mediaNames: string[] = []) {
  const names = [...new Set(mediaNames)].sort((left, right) => right.length - left.length)
  const mediaPattern = names.length ? `(?<![\\w.-])(?:${names.map(escapeRegExp).join('|')})(?![\\w.-])` : ''
  const syntaxPattern = mode === 'css'
    ? String.raw`\/\*[\s\S]*?\*\/|#[0-9a-fA-F]{3,8}|[.#]?[A-Za-z][\w-]*(?=\s*\{)|[A-Za-z-]+(?=\s*:)|[{}:;]`
    : String.raw`<!--[\s\S]*?-->|<\/?[^>\s]+|\/?>|{{[^}]+}}`
  const pattern = new RegExp(`(${[mediaPattern, syntaxPattern].filter(Boolean).join('|')})`, 'g')
  const mediaSet = new Set(names)
  return value.split(pattern).map((part, index) => {
    const isMedia = mediaSet.has(part)
    const className = isMedia
      ? 'mx-0.5 inline-block rounded border border-fuchsia-300/80 bg-fuchsia-400/15 px-1 text-fuchsia-100 shadow-[0_0_0_1px_rgba(232,121,249,0.18)]'
      : part.startsWith('<') ? 'text-cyan-300' : part.startsWith('{{') ? 'text-amber-300' : /^[{}:;]$/.test(part) ? 'text-violet-300' : 'text-slate-300'
    return <span key={index} className={className}>{part}</span>
  })
}

export function DesignPage({ noteType, index, setIndex, drafts, setDrafts, onSave, notify }: {
  noteType?: NoteType
  index: number
  setIndex: (index: number) => void
  drafts: Record<string, string>
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>
  onSave: (mode: EditorMode, value: string) => Promise<void>
  notify: (message: string) => void
}) {
  const [mode, setMode] = useState<EditorMode>('front')
  const [mediaNames, setMediaNames] = useState<string[]>([])
  const codeLayer = useRef<HTMLPreElement | null>(null)
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
    await onSave(mode, draft)
    discardDraft()
  }, [changed, discardDraft, draft, mode, onSave])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void apply() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [apply])
  useEffect(() => {
    const onMediaChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ workspace?: Workspace; rename?: { old: string; new: string } } | Workspace>).detail
      const rename = detail && typeof detail === 'object' && 'rename' in detail ? detail.rename : undefined
      if (rename && rename.old !== rename.new) {
        const pattern = new RegExp(`(?<![\\w.-])${escapeRegExp(rename.old)}(?![\\w.-])`, 'g')
        setDrafts((current) => {
          const next: Record<string, string> = {}
          let touched = false
          for (const [key, draftValue] of Object.entries(current)) {
            const rewritten = draftValue.replace(pattern, rename.new)
            next[key] = rewritten
            touched = touched || rewritten !== draftValue
          }
          return touched ? next : current
        })
      }
      void loadMediaNames().catch(() => setMediaNames([]))
    }
    void loadMediaNames().catch(() => setMediaNames([]))
    window.addEventListener('ankihelper:media-changed', onMediaChanged)
    return () => window.removeEventListener('ankihelper:media-changed', onMediaChanged)
  }, [loadMediaNames, setDrafts])
  if (!noteType) return null
  return <div className="mx-auto grid h-full max-w-[1420px] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
    <aside className="max-h-[142px] overflow-y-auto rounded-[18px] border border-slate-200/70 bg-white p-3 shadow-card lg:max-h-none lg:rounded-[22px]"><h2 className="px-2 pb-3 pt-2 text-base font-semibold">카드 레이아웃</h2>{noteType.templates.map((item, itemIndex) => <button key={itemIndex} onClick={() => setIndex(itemIndex)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${itemIndex === index ? 'bg-[#151d31] text-white' : 'hover:bg-slate-50'}`}><span className="text-xs font-bold">{String(itemIndex + 1).padStart(2, '0')}</span>{item.name}</button>)}</aside>
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-200/70 bg-white shadow-card">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div className="flex shrink-0 gap-1 rounded-xl bg-slate-100 p-1">{([['front', '앞면 HTML'], ['back', '뒷면 HTML'], ['css', '공통 CSS']] as const).map(([id, label]) => <button key={id} onClick={() => setMode(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{label}</button>)}</div><div className="ml-auto flex items-center gap-2"><button onClick={async () => { await navigator.clipboard.writeText(draft); notify('코드를 복사했습니다.') }} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"><Copy size={14} />복사</button>{changed ? <><button onClick={discardDraft} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"><RotateCcw size={14} />되돌리기</button><button onClick={apply} className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-700"><Save size={14} />작업본에 저장</button></> : <span role="status" className="inline-flex h-9 items-center gap-1.5 px-2 text-xs font-medium text-slate-400"><Check size={14} className="text-emerald-500" />작업본에 저장됨</span>}</div></div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0d1425]"><pre ref={codeLayer} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-5 pb-16 pt-5 font-mono text-[13px] leading-6"><code>{highlightCode(draft, mode, mediaNames)}</code></pre><textarea aria-label="카드 템플릿 코드" spellCheck={false} value={draft} onScroll={(event) => { if (codeLayer.current) { codeLayer.current.scrollTop = event.currentTarget.scrollTop; codeLayer.current.scrollLeft = event.currentTarget.scrollLeft } }} onChange={(event) => updateDraft(event.target.value)} className="code-editor-scrollbar absolute inset-0 h-full min-h-0 w-full resize-none overflow-auto bg-transparent px-5 pb-16 pt-5 font-mono text-[13px] leading-6 text-transparent caret-white outline-none selection:bg-indigo-400/30" /></div>
    </section>
  </div>
}
