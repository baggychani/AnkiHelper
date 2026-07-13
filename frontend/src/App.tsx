import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import {
  ArrowLeft, ArrowRight, BookOpen, Braces, Check, ChevronRight, Code2, Copy,
  Database, Download, FileArchive, FolderOpen, Grid2X2, HardDrive,
  Image, Layers3, ListChecks, LoaderCircle, Music2, Palette, PanelLeft,
  Play, Plus, Save, Sparkles, Table2, Trash2, X,
} from 'lucide-react'
import { api, type Field, type MediaItem, type NoteType, type Workspace } from './api'

type Page = 'overview' | 'data' | 'fields' | 'media' | 'design' | 'preview'
type EditorMode = 'front' | 'back' | 'css'
type ExportKind = 'tsv' | 'design' | 'bundle' | 'media' | 'project'

const navItems = [
  ['overview', '개요', Grid2X2], ['data', '카드 데이터', Table2],
  ['fields', '필드 관리', ListChecks], ['media', '미디어 관리', Music2],
  ['design', '카드 디자인', Braces], ['preview', '실시간 미리보기', Play],
] as const

function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [selectedId, setSelectedId] = useState('')
  const [templateIndex, setTemplateIndex] = useState(0)
  const [side, setSide] = useState<'front' | 'back'>('front')
  const [noteIndex, setNoteIndex] = useState(0)
  const [previewHtml, setPreviewHtml] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1080)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  const selected = useMemo(() => workspace?.note_types.find((item) => item.id === selectedId) ?? workspace?.note_types[0], [workspace, selectedId])
  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600) }, [])
  const hydrate = useCallback((next: Workspace) => {
    setWorkspace(next); setSelectedId(next.selected_note_type_id ?? next.note_types[0]?.id ?? '')
    setTemplateIndex(0); setNoteIndex(0)
  }, [])

  useEffect(() => { api.status().then((saved) => saved && hydrate(saved)).catch(() => undefined) }, [hydrate])
  useEffect(() => {
    const fitSidebar = () => { if (window.innerWidth < 900) setSidebarOpen(false) }
    window.addEventListener('resize', fitSidebar)
    return () => window.removeEventListener('resize', fitSidebar)
  }, [])
  useEffect(() => { const navigate = (event: Event) => setPage((event as CustomEvent<Page>).detail); window.addEventListener('ankihelper:navigate', navigate); return () => window.removeEventListener('ankihelper:navigate', navigate) }, [])
  useEffect(() => {
    const saved = (event: Event) => { const detail = (event as CustomEvent<{ workspace: Workspace; backup: string | null }>).detail; hydrate(detail.workspace); setDirty(false); notify(`저장했습니다 · 백업: ${detail.backup ?? '생성 안 됨'}`) }
    window.addEventListener('ankihelper:saved', saved)
    return () => window.removeEventListener('ankihelper:saved', saved)
  }, [hydrate, notify])
  useEffect(() => {
    if (!selected?.templates.length) return
    const timer = window.setTimeout(() => api.preview(selected.id, templateIndex, side, noteIndex).then(({ html }) => setPreviewHtml(html)).catch(() => undefined), 100)
    return () => window.clearTimeout(timer)
  }, [selected, templateIndex, side, noteIndex, workspace])

  const choosePackage = async () => {
    const path = await open({ multiple: false, filters: [{ name: 'APKG 또는 편집 프로젝트', extensions: ['apkg', 'zip'] }] })
    if (typeof path !== 'string') return
    setBusy(true); setError('')
    try { hydrate(await api.open(path)); setDirty(false); setPage('overview') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'APKG를 열지 못했습니다.') }
    finally { setBusy(false) }
  }

  const persist = async () => {
    if (!workspace) return
    setBusy(true); setError('')
    try {
      let destination: string | undefined
      if (workspace.requires_save_as) {
        const chosen = await save({ defaultPath: `${selected?.name ?? 'Anki'}_수정본.apkg`, filters: [{ name: 'Anki 패키지', extensions: ['apkg'] }] })
        if (!chosen) return
        destination = chosen
      }
      const result = await api.savePackage(destination)
      hydrate(result.workspace); setDirty(false)
      notify(`저장했습니다 · 백업: ${result.backup ?? '생성 안 됨'}`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '저장하지 못했습니다.') }
    finally { setBusy(false) }
  }

  useEffect(() => { const requestSave = () => { void persist() }; window.addEventListener('ankihelper:request-save', requestSave); return () => window.removeEventListener('ankihelper:request-save', requestSave) }, [workspace, selected])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && workspace && page !== 'design') { event.preventDefault(); void persist() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [workspace, page])

  const exportFile = async (kind: ExportKind) => {
    if (!selected) return
    const details = {
      tsv: ['tsv', '입력', '입력 TSV'], design: ['json', '디자인', '디자인 JSON'],
      bundle: ['apkg', '수정본', '수정본 APKG'], media: ['zip', '미디어', '미디어 ZIP'],
      project: ['zip', '편집프로젝트', '편집 프로젝트'],
    }[kind]
    const destination = await save({ defaultPath: `${selected.name.replace(/[\\/:*?"<>|]/g, '_')}_${details[1]}.${details[0]}`, filters: [{ name: details[2], extensions: [details[0]] }] })
    if (!destination) return
    try {
      const response = await fetch(api.exportUrl(kind, selected.id))
      if (!response.ok) throw new Error('내보낼 파일을 만들지 못했습니다.')
      await writeFile(destination, new Uint8Array(await response.arrayBuffer()))
      notify(`${details[2]} 파일을 저장했습니다.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '파일을 저장하지 못했습니다.') }
  }

  const mutate = async (operation: () => Promise<Workspace>, success?: string) => {
    try { setWorkspace(await operation()); setDirty(true); if (success) notify(success) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '변경사항을 처리하지 못했습니다.') }
  }

  const updateCell = async (row: number, fieldOrder: number, value: string) => {
    if (!selected) return
    try {
      setWorkspace(await api.updateNoteField(selected.id, row, fieldOrder, value))
      setDirty(true)
      notify('셀 내용을 수정했습니다.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '셀 내용을 수정하지 못했습니다.')
      throw caught
    }
  }

  return <main className="h-screen overflow-hidden bg-[#eef1f7] p-2 text-slate-900 lg:p-3">
    <div className="flex h-full min-w-0">
      <aside className={`${sidebarOpen ? 'w-[224px] xl:w-[272px]' : 'w-[64px] lg:w-[72px]'} flex h-full shrink-0 flex-col overflow-hidden rounded-[22px] bg-[#0b1426] text-white transition-[width] duration-300 lg:rounded-[26px]`}>
        <div className="flex h-[68px] shrink-0 items-center gap-3 px-3 lg:h-[76px] lg:px-4"><button onClick={() => { if (!sidebarOpen) setSidebarOpen(true) }} title={sidebarOpen ? 'Anki Helper' : '사이드바 열기'} className="group relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-400 to-cyan-300 text-slate-950"><Layers3 size={21} />{!sidebarOpen && <span className="absolute inset-0 grid place-items-center rounded-xl bg-slate-950/70 text-white opacity-0 transition group-hover:opacity-100"><ChevronRight size={18} /></span>}</button>{sidebarOpen && <div className="min-w-0"><p className="truncate text-sm font-extrabold tracking-[.13em]">ANKI HELPER</p><p className="mt-0.5 text-[10px] text-slate-500">Anki 덱 도우미</p></div>}{sidebarOpen && <button title="사이드바 접기" className="ml-auto shrink-0 text-slate-500 hover:text-white" onClick={() => setSidebarOpen(false)}><PanelLeft size={17} /></button>}</div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto px-2 pt-2 lg:px-3 lg:pt-4">{navItems.map(([id, label, Icon]) => <button key={id} disabled={!workspace && id !== 'overview'} onClick={() => setPage(id)} title={label} className={`flex h-11 w-full items-center rounded-xl px-3 text-left text-[13px] font-medium transition ${page === id ? 'bg-white/[.11] text-white shadow-[inset_3px_0_0_#818cf8]' : 'text-slate-500 hover:bg-white/[.055] hover:text-slate-200'} disabled:opacity-30`}><Icon size={18} /><span className={`${sidebarOpen ? 'ml-3 opacity-100' : 'w-0 opacity-0'} whitespace-nowrap transition-all`}>{label}</span></button>)}</nav>
        <div className="shrink-0 px-2 pb-3 lg:px-3 lg:pb-4"><p className={`${sidebarOpen ? 'block' : 'hidden'} mb-2 px-3 text-[10px] font-semibold tracking-[.14em] text-slate-600`}>가져오기·내보내기</p>
          <SideAction label="편집 프로젝트 내보내기" icon={FileArchive} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('project')} />
          <SideAction label="미디어 파일 추출" icon={Music2} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('media')} />
          <SideAction label="입력 TSV" icon={Download} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('tsv')} />
          <SideAction label="디자인 JSON" icon={Code2} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('design')} />
          <SideAction label="다른 이름으로 APKG 저장" icon={HardDrive} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('bundle')} />
          {sidebarOpen && <div className="sidebar-version mx-2 mt-4 border-t border-white/[.07] pt-3 text-[10px] leading-5 text-slate-600"><p>v1.0.2</p><p>© 2026 Bae Gichan</p></div>}
        </div>
      </aside>
      <section className="ml-2 flex h-full min-w-0 flex-1 flex-col overflow-hidden lg:ml-4">
        <header className="flex h-[64px] shrink-0 items-center justify-between gap-3 px-2 lg:h-[72px] lg:px-3"><div className="min-w-0"><p className="text-[10px] font-bold tracking-[.06em] text-indigo-500">{workspace ? '현재 노트 유형' : 'ANKI 파일 도구'}</p><h1 className="mt-1 truncate text-lg font-semibold tracking-tight lg:text-xl">{selected?.name ?? '안녕하세요! 반갑습니다.'}</h1></div><div className="flex shrink-0 items-center gap-2">{workspace && <button onClick={persist} disabled={busy || !dirty} className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition lg:h-10 lg:px-4 ${dirty ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'border border-slate-200 bg-white text-slate-400'}`}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{dirty ? '저장' : '저장됨'}<span className="hidden text-[10px] opacity-65 lg:inline">Ctrl+S</span></button>}<button onClick={choosePackage} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#11182a] px-3 text-xs font-semibold text-white lg:h-10 lg:px-4"><FolderOpen size={16} /><span className="hidden sm:inline">파일 열기</span></button></div></header>
        <div className={`min-h-0 flex-1 px-3 pb-4 ${page === 'design' || page === 'media' ? 'overflow-hidden' : 'overflow-y-auto'}`}>{!workspace ? <Welcome onOpen={choosePackage} busy={busy} /> : page === 'overview' ? <Overview workspace={workspace} selected={selected} onPage={setPage} onSelect={setSelectedId} /> : page === 'data' ? <DataPage noteType={selected} onUpdate={updateCell} /> : page === 'fields' ? <FieldsPage noteType={selected} onRename={(order, name) => mutate(() => api.updateField(selected!.id, order, name))} onAdd={(name) => mutate(() => api.addField(selected!.id, name))} onDelete={(order) => mutate(() => api.deleteField(selected!.id, order))} onClone={(name) => mutate(() => api.cloneNoteType(selected!.id, name), '새 노트 유형을 만들었습니다.')} /> : page === 'media' ? <MediaPage onExport={() => exportFile('media')} /> : page === 'design' ? <DesignPage noteType={selected} index={templateIndex} setIndex={setTemplateIndex} onSave={(mode, value) => mutate(() => mode === 'css' ? api.updateCss(selected!.id, value) : api.updateTemplate(selected!.id, templateIndex, { [mode]: value }), '카드 디자인을 적용했습니다.')} notify={notify} /> : <PreviewPage noteType={selected} side={side} setSide={setSide} noteIndex={noteIndex} setNoteIndex={setNoteIndex} previewHtml={previewHtml} />}</div>
      </section>
    </div>
    {toast && <div className="fixed bottom-7 left-1/2 z-[70] -translate-x-1/2 rounded-xl bg-slate-950/88 px-5 py-3 text-sm font-semibold text-white shadow-2xl backdrop-blur"><span className="mr-2 text-emerald-400">✓</span>{toast}</div>}
    {error && <Modal title="작업을 완료하지 못했습니다" description={error} tone="danger" confirmLabel="확인" onConfirm={() => setError('')} />}
  </main>
}

function SideAction({ label, icon: Icon, compact, disabled, onClick }: { label: string; icon: typeof Download; compact: boolean; disabled?: boolean; onClick: () => void }) { return <button disabled={disabled} onClick={onClick} title={label} className="flex h-9 w-full items-center rounded-xl px-3 text-[11px] font-medium text-slate-500 transition hover:bg-white/[.055] hover:text-slate-200 disabled:opacity-30"><Icon size={16} /><span className={`${compact ? 'w-0 opacity-0' : 'ml-3 opacity-100'} whitespace-nowrap transition-all`}>{label}</span></button> }

function Welcome({ onOpen, busy }: { onOpen: () => void; busy: boolean }) { return <div className="relative grid min-h-[calc(100vh-96px)] place-items-center overflow-hidden rounded-[22px] bg-[#0d1425] px-5 lg:min-h-[calc(100vh-110px)] lg:rounded-[28px] lg:px-6"><div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_22%,rgba(99,102,241,.32),transparent_36%),radial-gradient(ellipse_at_80%_78%,rgba(20,184,166,.17),transparent_37%)]" /><div className="relative max-w-xl text-center"><div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[19px] bg-white/10 ring-1 ring-white/15 lg:mb-7 lg:h-16 lg:w-16 lg:rounded-[22px]"><Sparkles className="text-violet-200" size={29} /></div><p className="mb-3 text-[11px] font-bold tracking-[.24em] text-indigo-300 lg:mb-4">ANKI HELPER</p><h2 className="text-[34px] font-semibold leading-tight tracking-[-.045em] text-white sm:text-[38px] lg:text-[42px]">파일 하나를 열고<br /><span className="bg-gradient-to-r from-violet-300 to-cyan-200 bg-clip-text text-transparent">바로 작업하세요.</span></h2><p className="mt-4 text-sm leading-6 text-slate-400">APKG와 Anki Helper 편집 프로젝트(.zip)를 모두 열 수 있습니다.</p><button onClick={onOpen} disabled={busy} className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-slate-900 lg:mt-7 lg:h-12">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <FolderOpen size={18} />}파일 열기</button></div></div> }

function Overview({ workspace, selected, onPage, onSelect }: { workspace: Workspace; selected?: NoteType; onPage: (page: Page) => void; onSelect: (id: string) => void }) { return <div className="mx-auto max-w-[1420px] space-y-4 lg:space-y-5"><section className="rounded-[20px] bg-[#151d31] px-5 py-5 text-white lg:rounded-[26px] lg:px-8 lg:py-7"><div className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-0"><div className="mb-2 flex items-center gap-2 truncate text-[11px] text-indigo-200 lg:mb-3"><BookOpen size={14} className="shrink-0" />{workspace.source_name}</div><h2 className="truncate text-xl font-semibold lg:text-2xl">{selected?.name}</h2></div><span className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-slate-300">원본은 저장할 때 자동 백업됩니다</span></div></section><section className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4"><Stat label="카드" value={selected?.notes.length ?? 0} icon={BookOpen} /><FieldSummary fields={selected?.fields ?? []} /><Stat label="미디어" value={workspace.media_count} icon={Music2} /></section><section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr] lg:gap-5"><Card title="노트 유형"><div className="space-y-2">{workspace.note_types.map((item, index) => <button key={item.id} onClick={() => { onSelect(item.id); onPage('data') }} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left ${item.id === selected?.id ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-slate-50 hover:bg-slate-100'}`}><span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-xs font-bold text-white">{index + 1}</span><span className="min-w-0"><b className="block truncate text-sm">{item.name}</b><small className="text-slate-400">{item.notes.length}개 카드 · {item.fields.length}개 필드</small></span></button>)}</div></Card><Card title="바로가기"><div className="space-y-2"><Quick label="카드 데이터" icon={Table2} onClick={() => onPage('data')} /><Quick label="필드 관리" icon={ListChecks} onClick={() => onPage('fields')} /><Quick label="미디어 관리" icon={Music2} onClick={() => onPage('media')} /><Quick label="카드 디자인" icon={Braces} onClick={() => onPage('design')} /></div></Card></section></div> }
function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[22px] lg:p-5"><h3 className="mb-4 text-lg font-semibold">{title}</h3>{children}</section> }
function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof BookOpen }) { return <div className="rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[20px] lg:p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold lg:text-3xl">{value.toLocaleString()}</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-600"><Icon size={19} /></span></div></div> }
function FieldSummary({ fields }: { fields: Field[] }) { const shown = fields.slice(0, 4); return <div className="rounded-[20px] border border-slate-200/70 bg-white p-5 shadow-card"><p className="text-xs font-semibold text-slate-400">필드 목록</p><div className="mt-3 flex flex-wrap gap-1.5">{shown.map((field) => <span key={field.order} title={field.name} className="max-w-[120px] truncate rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">{field.name}</span>)}{fields.length > shown.length && <span className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-600">외 {fields.length - shown.length}개</span>}</div><button onClick={() => window.dispatchEvent(new CustomEvent('ankihelper:navigate', { detail: 'fields' }))} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">필드 관리에서 전체 보기<ArrowRight size={13} /></button></div> }
function Quick({ label, icon: Icon, onClick }: { label: string; icon: typeof Table2; onClick: () => void }) { const descriptions: Record<string, string> = { '카드 데이터': '불러온 필드와 노트를 확인합니다', '필드 관리': '필드 이름과 구성을 편집합니다', '미디어 관리': '음성과 이미지를 확인하고 저장합니다', '카드 디자인': 'HTML과 CSS 템플릿을 편집합니다' }; return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-3 text-left hover:bg-indigo-50"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-slate-600 shadow-sm"><Icon size={17} /></span><span><b className="block text-sm text-slate-700">{label}</b><small className="mt-0.5 block text-xs text-slate-400">{descriptions[label]}</small></span><ArrowRight className="ml-auto text-slate-300" size={15} /></button> }

function mediaFilename(value: string) {
  const sound = value.match(/\[sound:([^\]]+)\]/i)
  const image = value.match(/<img[^>]+src=["']([^"']+)["']/i)
  return sound?.[1] ?? image?.[1]?.split(/[\\/]/).pop()
}

function DataPage({ noteType, onUpdate }: { noteType?: NoteType; onUpdate: (row: number, fieldOrder: number, value: string) => Promise<void> }) {
  const columns = useMemo(() => {
    if (!noteType) return []
    return noteType.fields.map((field) => {
      const values = noteType.notes.slice(0, 300).map((row) => row[field.order] ?? '')
      const populated = values.filter((value) => value.trim())
      const mediaMatches = populated.filter((value) => Boolean(mediaFilename(value))).length
      const mediaName = /^(sound|audio|voice|media|image|photo|음성|소리|미디어|이미지)$/i.test(field.name.trim())
      const media = mediaName || (populated.length > 0 && mediaMatches / populated.length >= 0.7)
      if (media) return { media: true, minWidth: 184, track: '184px' }

      const lengths = populated.map((value) => value.replace(/<[^>]*>/g, '').trim().length).sort((a, b) => a - b)
      const typical = lengths.length ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.85))] : field.name.length
      const density = values.length ? populated.length / values.length : 0
      const effectiveLength = typical * (0.25 + density * 0.75)
      const primaryText = density > 0.1 && /(meaning|definition|example|sentence|뜻|의미|예문|설명)/i.test(field.name)
      const secondaryText = density > 0.1 && /^(note|memo|비고|메모)$/i.test(field.name)
      const minWidth = Math.max(primaryText ? 160 : 112, Math.min(224, 92 + effectiveLength * 4))
      const weight = Math.max(0.8, Math.min(2.7, 0.75 + effectiveLength / 13 + (primaryText ? 0.55 : secondaryText ? 0.1 : 0)))
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

function DataValue({ row, fieldOrder, value = '', onUpdate }: { row: number; fieldOrder: number; value?: string; onUpdate: (row: number, fieldOrder: number, value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const skipBlur = useRef(false)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  const sound = value.match(/\[sound:([^\]]+)\]/i)
  const filename = mediaFilename(value)
  if (filename) { const MediaIcon = sound ? Music2 : Image; return <button onClick={() => { sessionStorage.setItem('ankihelper:media-focus', filename); window.dispatchEvent(new CustomEvent('ankihelper:navigate', { detail: 'media' })) }} title="미디어 셀은 미디어 관리에서 확인할 수 있습니다" className="inline-flex h-9 w-full min-w-0 items-center gap-2 rounded-lg bg-violet-50 px-2.5 text-left text-xs font-semibold text-violet-700 hover:bg-violet-100"><MediaIcon size={14} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{filename}</span><ArrowRight size={13} className="shrink-0 opacity-60" /></button> }
  const commit = async () => {
    if (saving) return
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    try { await onUpdate(row, fieldOrder, draft); setEditing(false) }
    catch { /* 상위 화면의 공통 오류 창에서 안내하고 편집 상태는 유지합니다. */ }
    finally { setSaving(false) }
  }
  if (editing) return <textarea autoFocus rows={Math.min(4, Math.max(1, draft.split('\n').length))} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return } void commit() }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur() } else if (event.key === 'Escape') { event.preventDefault(); skipBlur.current = true; setDraft(value); setEditing(false) } }} disabled={saving} className="min-h-9 w-full resize-none rounded-lg border border-indigo-300 bg-white px-2.5 py-2 text-sm leading-5 text-slate-700 outline-none ring-2 ring-indigo-100" />
  return <button onDoubleClick={() => setEditing(true)} title="더블클릭하여 수정" className="block min-h-9 w-full rounded-lg px-2.5 py-2 text-left leading-5 hover:bg-indigo-50">{value ? <span className="line-clamp-2 whitespace-pre-wrap">{value}</span> : <span className="text-slate-300">—</span>}</button>
}

function FieldsPage({ noteType, onRename, onAdd, onDelete, onClone }: { noteType?: NoteType; onRename: (order: number, name: string) => Promise<void>; onAdd: (name: string) => Promise<void>; onDelete: (order: number) => Promise<void>; onClone: (name: string) => Promise<void> }) {
  const [newName, setNewName] = useState(''); const [cloneName, setCloneName] = useState(''); const [deleting, setDeleting] = useState<Field | null>(null)
  if (!noteType) return null
  const filled = deleting ? noteType.notes.filter((row) => Boolean(row[deleting.order]?.trim())).length : 0
  return <div className="mx-auto max-w-[1420px] space-y-5"><Card title="필드 구성"><p className="-mt-2 mb-5 text-sm text-slate-400">이름을 바꾸면 카드 디자인의 필드 참조도 함께 바뀝니다.</p><div className="mb-5 overflow-auto rounded-xl border border-slate-200"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-400"><tr>{noteType.fields.map((field) => <th key={field.order} className="px-3 py-2 font-semibold">{field.name}</th>)}</tr></thead><tbody>{noteType.notes.slice(0, 2).map((row, index) => <tr key={index} className="border-t border-slate-100">{noteType.fields.map((field) => <td key={field.order} className="max-w-[180px] truncate px-3 py-2 text-slate-600">{row[field.order] || '—'}</td>)}</tr>)}</tbody></table></div><div className="grid gap-2 md:grid-cols-2">{noteType.fields.map((field) => <div key={`${field.order}-${field.name}`} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2"><span className="w-7 text-xs font-bold text-slate-400">{String(field.order + 1).padStart(2, '0')}</span><input defaultValue={field.name} onBlur={(event) => { const value = event.currentTarget.value.trim(); if (value && value !== field.name) void onRename(field.order, value) }} className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none" /><button onClick={() => setDeleting(field)} disabled={noteType.fields.length <= 1} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50 disabled:opacity-25"><Trash2 size={15} /></button></div>)}</div><form className="mt-4 flex gap-2" onSubmit={async (event) => { event.preventDefault(); if (newName.trim()) { await onAdd(newName.trim()); setNewName('') } }}><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="새 필드 이름" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" /><button className="inline-flex items-center gap-2 rounded-xl bg-[#151d31] px-4 text-sm font-semibold text-white"><Plus size={15} />필드 추가</button></form></Card><Card title="새 노트 유형으로 복제"><p className="-mt-2 mb-4 text-sm text-slate-400">현재 구조를 별도의 노트 유형으로 복제합니다. 기존 유형은 그대로 유지됩니다.</p><div className="flex gap-2"><input value={cloneName} onChange={(event) => setCloneName(event.target.value)} placeholder="새 노트 유형 이름" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none" /><button onClick={async () => { if (cloneName.trim()) { await onClone(cloneName.trim()); setCloneName('') } }} className="rounded-xl border border-indigo-200 px-4 text-sm font-semibold text-indigo-700">복제</button></div></Card>{deleting && <Modal title={`‘${deleting.name}’ 필드를 삭제할까요?`} description={filled ? `${filled.toLocaleString()}개 노트에 내용이 있습니다. 필드 값과 템플릿 참조가 함께 삭제되며 저장 후에는 백업으로만 복구할 수 있습니다.` : '비어 있는 필드입니다. 템플릿의 필드 참조도 함께 삭제됩니다.'} tone="danger" confirmLabel="필드 삭제" onCancel={() => setDeleting(null)} onConfirm={async () => { await onDelete(deleting.order); setDeleting(null) }} />}</div>
}

function MediaPage({ onExport }: { onExport: () => void }) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState('')
  const [highlight, setHighlight] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  useEffect(() => { api.media().then((loaded) => { setItems(loaded); const focus = sessionStorage.getItem('ankihelper:media-focus'); if (focus) { const found = loaded.find((item) => item.name === focus); setHighlight(focus); sessionStorage.removeItem('ankihelper:media-focus'); window.setTimeout(() => found && document.getElementById(`media-${found.stored_name}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80); window.setTimeout(() => setHighlight(''), 2400) } }).catch(() => setItems([])) }, [])
  const visible = items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
  const play = (item: MediaItem) => { if (playing === item.stored_name && audioRef.current) { audioRef.current.pause(); setPlaying(''); return } audioRef.current?.pause(); const audio = new Audio(api.mediaUrl(item.stored_name)); audioRef.current = audio; setPlaying(item.stored_name); audio.onended = () => setPlaying(''); void audio.play() }
  const downloadOne = async (item: MediaItem) => { const destination = await save({ defaultPath: item.name, filters: [{ name: '미디어 파일', extensions: [item.name.split('.').pop() || '*'] }] }); if (!destination) return; const response = await fetch(api.mediaUrl(item.stored_name)); await writeFile(destination, new Uint8Array(await response.arrayBuffer())) }
  const audioCount = items.filter((item) => item.type === 'audio').length
  const imageCount = items.filter((item) => item.type === 'image').length
  return <div className="mx-auto flex h-full min-h-0 max-w-[1420px] flex-col gap-4">
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200/70 bg-white px-5 py-3 text-xs shadow-card"><b className="text-sm text-slate-700">미디어 {items.length.toLocaleString()}개</b><span className="inline-flex items-center gap-1.5 text-slate-500"><Music2 size={14} className="text-violet-500" />음성 {audioCount.toLocaleString()}</span><span className="inline-flex items-center gap-1.5 text-slate-500"><Image size={14} className="text-cyan-500" />이미지 {imageCount.toLocaleString()}</span></div>
    <section className="flex min-h-0 flex-1 flex-col rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[22px] lg:p-5"><h3 className="mb-4 shrink-0 text-lg font-semibold">미디어 확인</h3><div className="mb-4 flex shrink-0 gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="파일명 검색" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none" /><button onClick={onExport} className="inline-flex items-center gap-2 rounded-xl bg-[#151d31] px-4 text-sm font-semibold text-white"><Download size={15} />전체 추출</button></div><div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200">{visible.map((item) => <div id={`media-${item.stored_name}`} key={item.stored_name} className={`flex items-center gap-3 border-b px-4 py-3 transition-colors duration-700 last:border-0 ${highlight === item.name ? 'border-violet-200 bg-violet-100 ring-2 ring-inset ring-violet-300' : 'border-slate-100 bg-white'}`}>{item.type === 'image' ? <img src={api.mediaUrl(item.stored_name)} className="h-10 w-10 rounded-lg bg-slate-100 object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-lg bg-violet-100 text-violet-600"><Music2 size={17} /></span>}<span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.name}>{item.name}</span>{item.type === 'audio' && <button onClick={() => play(item)} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${playing === item.stored_name ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700'}`}>{playing === item.stored_name ? '■ 정지' : '▶ 듣기'}</button>}<button onClick={() => void downloadOne(item)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600"><Download size={14} />저장</button></div>)}</div></section>
  </div>
}
function formatSize(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1048576).toFixed(1)} MB` }

function highlightCode(value: string, mode: EditorMode) { const pattern = mode === 'css' ? /(\/\*[\s\S]*?\*\/|#[0-9a-fA-F]{3,8}|[.#]?[A-Za-z][\w-]*(?=\s*\{)|[A-Za-z-]+(?=\s*:)|[{}:;])/g : /(<!--[\s\S]*?-->|<\/?[^>]+>|{{[^}]+}})/g; return value.split(pattern).map((part, index) => <span key={index} className={part.startsWith('<') ? 'text-cyan-300' : part.startsWith('{{') ? 'text-amber-300' : /^[{}:;]$/.test(part) ? 'text-violet-300' : 'text-slate-300'}>{part}</span>) }

function DesignPage({ noteType, index, setIndex, onSave, notify }: { noteType?: NoteType; index: number; setIndex: (index: number) => void; onSave: (mode: EditorMode, value: string) => Promise<void>; notify: (message: string) => void }) {
  const [mode, setMode] = useState<EditorMode>('front')
  const [draft, setDraft] = useState('')
  const [changed, setChanged] = useState(false)
  const codeLayer = useRef<HTMLPreElement | null>(null)
  const template = noteType?.templates[index]
  const value = mode === 'css' ? noteType?.css ?? '' : template?.[mode] ?? ''
  useEffect(() => { setDraft(value); setChanged(false) }, [value, mode, index])
  const apply = useCallback(async () => {
    if (!changed) return
    await onSave(mode, draft)
    window.dispatchEvent(new CustomEvent('ankihelper:request-save'))
    setChanged(false)
  }, [changed, draft, mode, onSave])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void apply() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [apply])
  if (!noteType) return null
  return <div className="mx-auto grid h-full max-w-[1420px] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
    <aside className="max-h-[142px] overflow-y-auto rounded-[18px] border border-slate-200/70 bg-white p-3 shadow-card lg:max-h-none lg:rounded-[22px]"><h2 className="px-2 pb-3 pt-2 text-base font-semibold">카드 레이아웃</h2>{noteType.templates.map((item, itemIndex) => <button key={itemIndex} onClick={() => setIndex(itemIndex)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${itemIndex === index ? 'bg-[#151d31] text-white' : 'hover:bg-slate-50'}`}><span className="text-xs font-bold">{String(itemIndex + 1).padStart(2, '0')}</span>{item.name}</button>)}</aside>
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-200/70 bg-white shadow-card">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 p-4"><div className="flex gap-1 rounded-xl bg-slate-100 p-1">{([['front', '앞면 HTML'], ['back', '뒷면 HTML'], ['css', '공통 CSS']] as const).map(([id, label]) => <button key={id} onClick={() => setMode(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{label}</button>)}</div><div className="flex gap-2"><button onClick={async () => { await navigator.clipboard.writeText(draft); notify('코드를 복사했습니다.') }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"><Copy size={14} />복사</button><button onClick={apply} disabled={!changed} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold ${changed ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}><Save size={14} />{changed ? '저장' : '저장됨'}</button></div></div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0d1425]"><pre ref={codeLayer} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-5 font-mono text-[13px] leading-6"><code>{highlightCode(draft, mode)}</code></pre><textarea aria-label="카드 템플릿 코드" spellCheck={false} value={draft} onScroll={(event) => { if (codeLayer.current) { codeLayer.current.scrollTop = event.currentTarget.scrollTop; codeLayer.current.scrollLeft = event.currentTarget.scrollLeft } }} onChange={(event) => { setDraft(event.target.value); setChanged(event.target.value !== value) }} className="absolute inset-0 h-full min-h-0 w-full resize-none overflow-auto bg-transparent p-5 font-mono text-[13px] leading-6 text-transparent caret-white outline-none selection:bg-indigo-400/30" /></div>
    </section>
  </div>
}

function PreviewPage({ noteType, side, setSide, noteIndex, setNoteIndex, previewHtml }: { noteType?: NoteType; side: 'front' | 'back'; setSide: (side: 'front' | 'back') => void; noteIndex: number; setNoteIndex: (index: number) => void; previewHtml: string }) { if (!noteType) return null; const total = Math.max(noteType.notes.length, 1); const doc = `<!doctype html><html><head><style>html,body{height:100%;margin:0}body{background:#fff}#anki-card{min-height:100%;box-sizing:border-box}</style></head><body class="card"><div id="anki-card" class="card">${previewHtml}</div><script>document.querySelectorAll('.anki-audio').forEach(b=>{let a;b.onclick=()=>{a??=new Audio(b.dataset.audio);if(a.paused){a.play();b.textContent='■';b.classList.add('playing')}else{a.pause();b.textContent='▶';b.classList.remove('playing')}a.onended=()=>{b.textContent='▶';b.classList.remove('playing')}}})</script></body></html>`; return <div className="mx-auto grid max-w-[1420px] gap-3 lg:grid-cols-[minmax(0,1fr)_230px] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_250px]"><section className="grid min-h-[480px] place-items-center rounded-[20px] bg-[#172033] p-3 lg:min-h-[620px] lg:rounded-[26px] lg:p-5"><div className="flex h-[min(72vh,710px)] w-full max-w-[580px] flex-col overflow-hidden rounded-[24px] border-[6px] border-[#0a0f1d] bg-white shadow-2xl lg:rounded-[32px] lg:border-[7px]"><div className="flex h-11 shrink-0 items-center justify-between border-b px-5 text-[11px] text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-400" /><b>ANKI 미리보기</b><span>{noteIndex + 1} / {total}</span></div><iframe title="카드 미리보기" sandbox="allow-scripts allow-same-origin" srcDoc={doc} className="h-full w-full border-0" /></div></section><aside className="flex min-h-[170px] flex-col rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[22px] lg:p-5"><h2 className="text-lg font-semibold">실시간 미리보기</h2><div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 lg:mt-6"><button onClick={() => setSide('front')} className={`rounded-lg py-2 text-xs font-semibold ${side === 'front' ? 'bg-white shadow-sm' : 'text-slate-400'}`}>앞면</button><button onClick={() => setSide('back')} className={`rounded-lg py-2 text-xs font-semibold ${side === 'back' ? 'bg-white shadow-sm' : 'text-slate-400'}`}>뒷면</button></div><div className="mt-auto grid grid-cols-2 gap-2"><button onClick={() => setNoteIndex((noteIndex - 1 + total) % total)} className="inline-flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-semibold"><ArrowLeft size={15} />이전</button><button onClick={() => setNoteIndex((noteIndex + 1) % total)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#151d31] py-2.5 text-xs font-semibold text-white">다음<ArrowRight size={15} /></button></div></aside></div> }

function Modal({ title, description, tone = 'normal', confirmLabel, onCancel, onConfirm }: { title: string; description: string; tone?: 'normal' | 'danger'; confirmLabel: string; onCancel?: () => void; onConfirm: () => void | Promise<void> }) { return <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl"><div className={`mb-4 grid h-11 w-11 place-items-center rounded-xl ${tone === 'danger' ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'}`}>{tone === 'danger' ? <X size={20} /> : <Check size={20} />}</div><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p><div className="mt-6 flex justify-end gap-2">{onCancel && <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button>}<button onClick={onConfirm} className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${tone === 'danger' ? 'bg-rose-600' : 'bg-indigo-600'}`}>{confirmLabel}</button></div></div></div> }

export default App
