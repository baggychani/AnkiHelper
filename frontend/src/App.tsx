import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  ArrowLeft, ArrowRight, ArrowRightLeft, BookOpen, Braces, Check, ChevronDown, ChevronRight, ChevronUp, Code2, Copy,
  ArrowUpRight, Database, Download, FileArchive, FolderOpen, Grid2X2, HardDrive,
  FileSpreadsheet, Image, Layers3, ListChecks, LoaderCircle, LogOut, Music2, Palette, PanelLeft,
  Play, Plus, Save, Sparkles, Table2, Trash2, Type, X,
} from 'lucide-react'
import { api, type Field, type MediaItem, type NoteType, type SourceNoteType, type TablePreview, type Workspace } from './api'

type Page = 'overview' | 'data' | 'fields' | 'media' | 'design' | 'preview'
type EditorMode = 'front' | 'back' | 'css'
type ExportKind = 'tsv' | 'design' | 'bundle' | 'media' | 'project'
type PendingWork = { kind: 'open-picker' | 'table-picker' | 'open-path'; path?: string }
type AvailableUpdate = { version: string; url: string }

const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
const UPDATE_CHECK_STORAGE_KEY = 'anki-helper:update-last-check'
const RELEASES_API_URL = 'https://api.github.com/repos/baggychani/AnkiHelper/releases/latest'

function isNewerVersion(candidate: string, current: string) {
  const toParts = (version: string) => version.replace(/^v/i, '').split(/[+-]/, 1)[0].split('.').map((part) => Number.parseInt(part, 10) || 0)
  const candidateParts = toParts(candidate)
  const currentParts = toParts(current)
  const total = Math.max(candidateParts.length, currentParts.length)
  for (let index = 0; index < total; index += 1) {
    const difference = (candidateParts[index] ?? 0) - (currentParts[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

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
  const [toastVisible, setToastVisible] = useState(false)
  const [error, setError] = useState('')
  const [exitPrompt, setExitPrompt] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [tableImport, setTableImport] = useState<{ path: string; preview: TablePreview } | null>(null)
  const [pendingWork, setPendingWork] = useState<PendingWork | null>(null)
  const [newWorkMenuOpen, setNewWorkMenuOpen] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null)
  const allowCloseRef = useRef(false)
  const newWorkMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => { void invoke('show_main_window').catch(() => undefined) })
    })
    return () => window.cancelAnimationFrame(firstFrame)
  }, [])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const lastCheck = Number.parseInt(window.localStorage.getItem(UPDATE_CHECK_STORAGE_KEY) ?? '0', 10)
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 5000)
    const checkForUpdate = async () => {
      window.localStorage.setItem(UPDATE_CHECK_STORAGE_KEY, String(Date.now()))
      try {
        const response = await fetch(RELEASES_API_URL, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        })
        if (!response.ok) return
        const release = await response.json() as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean }
        if (!release.tag_name || !release.html_url || release.draft || release.prerelease || !isNewerVersion(release.tag_name, __APP_VERSION__)) return
        setAvailableUpdate({ version: release.tag_name.replace(/^v/i, ''), url: release.html_url })
      } catch {
        // Update discovery is deliberately quiet: the app remains fully usable offline.
      } finally {
        window.clearTimeout(timer)
      }
    }
    const start = window.setTimeout(() => { void checkForUpdate() }, 1200)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const selected = useMemo(() => workspace?.note_types.find((item) => item.id === selectedId) ?? workspace?.note_types[0], [workspace, selectedId])
  const notify = useCallback((message: string) => {
    setToast(message)
    setToastVisible(true)
    window.setTimeout(() => setToastVisible(false), 2200)
    window.setTimeout(() => setToast(''), 2700)
  }, [])
  const hydrate = useCallback((next: Workspace) => {
    setWorkspace(next)
    setSelectedId((current) => {
      const preferred = next.selected_note_type_id
      if (preferred && next.note_types.some((item) => item.id === preferred)) return preferred
      if (current && next.note_types.some((item) => item.id === current)) return current
      return next.note_types[0]?.id ?? ''
    })
  }, [])

  useEffect(() => {
    setTemplateIndex(0)
    setNoteIndex(0)
  }, [selectedId])

  useEffect(() => { api.status().then((saved) => saved && hydrate(saved)).catch(() => undefined) }, [hydrate])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let disposed = false
    let unlisten: (() => void) | undefined
    try {
      void getCurrentWindow().onCloseRequested((event) => {
        if (allowCloseRef.current) return
        event.preventDefault()
        setExitPrompt(true)
      }).then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      }).catch(() => undefined)
    } catch {
      // The browser preview does not expose Tauri's window bridge.
    }
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (!exitPrompt) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setExitPrompt(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exitPrompt])

  useEffect(() => {
    if (!newWorkMenuOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (!newWorkMenuRef.current?.contains(event.target as Node)) setNewWorkMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setNewWorkMenuOpen(false) }
    }
    window.addEventListener('mousedown', closeMenu)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', closeMenu); window.removeEventListener('keydown', onKey) }
  }, [newWorkMenuOpen])

  const confirmExit = async () => {
    allowCloseRef.current = true
    setExitPrompt(false)
    try {
      await getCurrentWindow().destroy()
    } catch {
      try { await getCurrentWindow().close() }
      catch { window.close() }
    }
  }
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

  const persist = async (): Promise<boolean> => {
    if (!workspace) return false
    setBusy(true); setError('')
    try {
      let destination: string | undefined
      if (workspace.requires_save_as) {
        const chosen = await save({ defaultPath: `${selected?.name ?? 'Anki'}_수정본.apkg`, filters: [{ name: 'Anki 패키지', extensions: ['apkg'] }] })
        if (!chosen) return false
        destination = chosen
      }
      const result = await api.savePackage(destination)
      hydrate(result.workspace); setDirty(false)
      notify(`저장했습니다 · 백업: ${result.backup ?? '생성 안 됨'}`)
      return true
    } catch (caught) { setError(caught instanceof Error ? caught.message : '저장하지 못했습니다.'); return false }
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
    try {
      hydrate(await operation())
      setDirty(true)
      if (success) notify(success)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '변경사항을 처리하지 못했습니다.')
      return false
    }
  }

  const selectNoteType = async (id: string) => {
    if (id === selectedId) return
    const previous = selectedId
    setSelectedId(id)
    try {
      hydrate(await api.selectNoteType(id))
    } catch (caught) {
      setSelectedId(previous)
      setError(caught instanceof Error ? caught.message : '노트 유형을 선택하지 못했습니다.')
    }
  }

  const openPackagePath = useCallback(async (path: string) => {
    setBusy(true); setError('')
    try { hydrate(await api.open(path)); setDirty(false); setPage('overview') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'APKG를 열지 못했습니다.') }
    finally { setBusy(false) }
  }, [hydrate])

  const choosePackageNow = async () => {
    const path = await open({ multiple: false, filters: [{ name: 'APKG 또는 편집 프로젝트', extensions: ['apkg', 'zip'] }] })
    if (typeof path !== 'string') return
    await openPackagePath(path)
  }

  const beginTableImport = useCallback(async (sourcePath?: string) => {
    const path = sourcePath ?? await open({ multiple: false, filters: [{ name: '엑셀 및 표 데이터', extensions: ['xlsx', 'csv', 'tsv', 'txt'] }] })
    if (typeof path !== 'string') return
    setBusy(true); setError('')
    try {
      setTableImport({ path, preview: await api.inspectTable(path) })
    } catch (caught) { setError(caught instanceof Error ? caught.message : '표 데이터를 읽지 못했습니다.') }
    finally { setBusy(false) }
  }, [])

  const requestWork = useCallback((work: PendingWork) => {
    if (dirty) { setPendingWork(work); return }
    if (work.kind === 'open-path' && work.path) void openPackagePath(work.path)
    else if (work.kind === 'open-picker') void choosePackageNow()
    else void beginTableImport(work.path)
  }, [beginTableImport, dirty, openPackagePath])

  const choosePackage = useCallback(() => requestWork({ kind: 'open-picker' }), [requestWork])
  const requestTableImport = useCallback(() => requestWork({ kind: 'table-picker' }), [requestWork])
  const continuePendingWork = async (saveFirst: boolean) => {
    const work = pendingWork
    if (!work) return
    if (saveFirst && !(await persist())) return
    setPendingWork(null)
    if (work.kind === 'open-path' && work.path) await openPackagePath(work.path)
    else if (work.kind === 'open-picker') await choosePackageNow()
    else await beginTableImport(work.path)
  }

  useEffect(() => {
    const start = () => { requestTableImport() }
    window.addEventListener('ankihelper:import-table', start)
    return () => window.removeEventListener('ankihelper:import-table', start)
  }, [requestTableImport])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setDragActive(true)
        return
      }
      if (event.payload.type === 'leave') {
        setDragActive(false)
        return
      }
      setDragActive(false)
      const path = event.payload.paths.find((item) => /\.(apkg|zip|xlsx|csv|tsv|txt)$/i.test(item)) ?? event.payload.paths[0]
      if (path) {
        if (/\.(xlsx|csv|tsv|txt)$/i.test(path)) requestWork({ kind: 'table-picker', path })
        else requestWork({ kind: 'open-path', path })
      }
    }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    }).catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [requestWork])

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
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
          <nav className="shrink-0 space-y-1 px-2 pt-2 lg:px-3 lg:pt-4">{navItems.map(([id, label, Icon]) => <button key={id} disabled={!workspace && id !== 'overview'} onClick={() => setPage(id)} title={label} className={`flex h-11 w-full items-center rounded-xl px-3 text-left text-[13px] font-medium transition ${page === id ? 'bg-white/[.11] text-white shadow-[inset_3px_0_0_#818cf8]' : 'text-slate-500 hover:bg-white/[.055] hover:text-slate-200'} disabled:opacity-30`}><Icon size={18} /><span className={`${sidebarOpen ? 'ml-3 opacity-100' : 'w-0 opacity-0'} whitespace-nowrap transition-all`}>{label}</span></button>)}</nav>
          <div className="mt-auto shrink-0 px-2 pb-3 pt-4 lg:px-3 lg:pb-4"><p className={`${sidebarOpen ? 'block' : 'hidden'} mb-2 px-3 text-[10px] font-semibold tracking-[.14em] text-slate-600`}>가져오기·내보내기</p>
            <SideAction label="편집 프로젝트 내보내기" icon={FileArchive} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('project')} />
            <SideAction label="미디어 파일 추출" icon={Music2} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('media')} />
            <SideAction label="입력 TSV" icon={Download} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('tsv')} />
            <SideAction label="디자인 JSON" icon={Code2} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('design')} />
            <SideAction label="다른 이름으로 APKG 저장" icon={HardDrive} compact={!sidebarOpen} disabled={!selected} onClick={() => exportFile('bundle')} />
            {sidebarOpen && <div className="sidebar-version mx-2 mt-4 border-t border-white/[.07] pt-3 text-[10px] leading-5 text-slate-600"><p>v{__APP_VERSION__}</p><p>© 2026 Bae Gichan</p></div>}
          </div>
        </div>
      </aside>
      <section className="ml-2 flex h-full min-w-0 flex-1 flex-col overflow-hidden lg:ml-4">
        <header className="flex h-[64px] shrink-0 items-center justify-between gap-3 px-2 lg:h-[72px] lg:px-3">
          <div className="min-w-0 flex-1">
            {workspace ? (
              <div className="flex min-w-0 items-center gap-3 lg:gap-4">
                <div className="min-w-0 max-w-[55%]">
                  <p className="text-[10px] font-bold tracking-[.06em] text-indigo-500">열린 파일</p>
                  <h1 className="mt-1 truncate text-lg font-semibold tracking-tight lg:text-xl" title={workspace.source_name}>{workspace.source_name}</h1>
                </div>
                <span className="hidden h-9 w-px shrink-0 bg-slate-200 sm:block" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold tracking-[.06em] text-slate-400">노트 유형</p>
                  <p className="mt-1 truncate text-lg font-semibold tracking-tight text-slate-700 lg:text-xl" title={selected?.name}>{selected?.name ?? '—'}</p>
                </div>
              </div>
            ) : (
              <h1 className="truncate text-lg font-semibold tracking-tight lg:text-xl">안녕하세요, 반갑습니다!</h1>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">{workspace && <><button onClick={persist} disabled={busy || !dirty} className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition lg:h-10 lg:px-4 ${dirty ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'border border-slate-200 bg-white text-slate-400'}`}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{dirty ? '저장' : '저장됨'}<span className="hidden text-[10px] opacity-65 lg:inline">Ctrl+S</span></button><div ref={newWorkMenuRef} className="relative"><button onClick={() => setNewWorkMenuOpen((open) => !open)} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#11182a] px-3 text-xs font-semibold text-white transition hover:bg-[#202b45] lg:h-10 lg:px-4"><Plus size={16} /><span>새 작업</span><ChevronDown size={14} className={`transition ${newWorkMenuOpen ? 'rotate-180' : ''}`} /></button>{newWorkMenuOpen && <div className="absolute right-0 top-[calc(100%+8px)] z-[75] w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl"><button onClick={() => { setNewWorkMenuOpen(false); requestTableImport() }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-indigo-50"><span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-100 text-indigo-600"><FileSpreadsheet size={17} /></span><span><b className="block text-sm text-slate-800">표 데이터에서 새 덱 만들기</b><small className="block pt-0.5 text-xs text-slate-500">Excel · CSV · TSV · TXT</small></span></button><button onClick={() => { setNewWorkMenuOpen(false); choosePackage() }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"><span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600"><FolderOpen size={17} /></span><span><b className="block text-sm text-slate-800">기존 파일 불러오기</b><small className="block pt-0.5 text-xs text-slate-500">APKG · 편집 프로젝트</small></span></button></div>}</div></>}</div>
        </header>
        <div className={`min-h-0 flex-1 px-3 pb-4 ${!workspace || page === 'design' || page === 'media' ? 'overflow-hidden' : 'overflow-y-auto'}`}>{!workspace ? <Welcome onOpen={choosePackage} busy={busy} dragActive={dragActive} /> : page === 'overview' ? <Overview workspace={workspace} selected={selected} onPage={setPage} onSelect={(id) => { void selectNoteType(id) }} onDeleteNoteType={(id) => mutate(() => api.deleteNoteType(id), '빈 노트 유형을 제거했습니다. 저장하면 APKG에 반영됩니다.')} onMoveNotes={async (fromId, toId, mapping) => { try { const result = await api.moveNotes(fromId, toId, mapping); hydrate(result.workspace); setDirty(true); notify(`${result.moved.toLocaleString()}개 카드를 옮겼습니다.`); } catch (caught) { setError(caught instanceof Error ? caught.message : '카드를 옮기지 못했습니다.'); throw caught } }} /> : page === 'data' ? <DataPage noteType={selected} onUpdate={updateCell} /> : page === 'fields' ? <FieldsPage noteType={selected} onRename={async (order, name) => { await mutate(() => api.updateField(selected!.id, order, name)) }} onAdd={async (name) => { await mutate(() => api.addField(selected!.id, name)) }} onDelete={async (order) => { await mutate(() => api.deleteField(selected!.id, order)) }} onReorder={async (order, newOrder) => { await mutate(() => api.reorderField(selected!.id, order, newOrder)) }} onMove={async (order, destination, mode) => { const result = await api.moveFieldContents(selected!.id, order, destination, mode); hydrate(result.workspace); setDirty(true); notify(`${result.changed.toLocaleString()}개 노트에서 내용을 이동했습니다.`); return result.changed }} onClone={async (name) => { await mutate(async () => { const next = await api.cloneNoteType(selected!.id, name, true); setPage('overview'); return next }, '카드를 새 노트 유형으로 옮겼습니다. 저장하면 APKG에 반영됩니다.') }} /> : page === 'media' ? <MediaPage onExport={() => exportFile('media')} /> : page === 'design' ? <DesignPage noteType={selected} index={templateIndex} setIndex={setTemplateIndex} onSave={async (mode, value) => { await mutate(() => mode === 'css' ? api.updateCss(selected!.id, value) : api.updateTemplate(selected!.id, templateIndex, { [mode]: value }), '카드 디자인을 적용했습니다.') }} notify={notify} /> : <PreviewPage noteType={selected} side={side} setSide={setSide} noteIndex={noteIndex} setNoteIndex={setNoteIndex} previewHtml={previewHtml} />}</div>
      </section>
    </div>
    {toast && <div className={`fixed bottom-7 left-1/2 z-[70] -translate-x-1/2 rounded-xl bg-[#0b1426] px-5 py-3 text-sm font-semibold text-white shadow-2xl ring-1 ring-white/10 transition-opacity duration-300 ${toastVisible ? 'opacity-100' : 'opacity-0'}`}><span className="mr-2 text-emerald-400">✓</span>{toast}</div>}
    {error && <Modal title="작업을 완료하지 못했습니다" description={error} tone="danger" confirmLabel="확인" onConfirm={() => setError('')} />}
    {pendingWork && <UnsavedWorkModal onCancel={() => setPendingWork(null)} onSave={() => void continuePendingWork(true)} onDiscard={() => void continuePendingWork(false)} />}
    {tableImport && <SpreadsheetImportWizard path={tableImport.path} initial={tableImport.preview} onCancel={() => setTableImport(null)} onSheetChange={(sheet) => api.inspectTable(tableImport.path, sheet)} onCreate={async (payload) => { setBusy(true); setError(''); try { hydrate(await api.createFromTable({ path: tableImport.path, ...payload })); setDirty(true); setPage('overview'); setTableImport(null); notify('새 덱 초안을 만들었습니다. 저장 위치를 선택해 주세요.'); } catch (caught) { setError(caught instanceof Error ? caught.message : '새 덱을 만들지 못했습니다.'); } finally { setBusy(false); } }} />}
    {availableUpdate && !error && !pendingWork && !tableImport && !exitPrompt && <UpdateAvailableModal update={availableUpdate} onDismiss={() => setAvailableUpdate(null)} onOpen={async () => { setAvailableUpdate(null); try { await openUrl(availableUpdate.url) } catch { setError('업데이트 페이지를 열지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.') } }} />}
    {exitPrompt && (
      <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={() => setExitPrompt(false)}>
        <div role="dialog" aria-modal="true" aria-labelledby="exit-title" className="w-full max-w-md rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-[#151d31] text-white"><LogOut size={20} /></div>
          <h3 id="exit-title" className="text-lg font-semibold">Anki Helper를 종료할까요?</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {dirty
              ? '저장하지 않은 변경이 있습니다. 종료하면 이 작업 내용은 사라집니다.'
              : '창을 닫으면 프로그램이 종료됩니다.'}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setExitPrompt(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button>
            <button onClick={() => void confirmExit()} className="rounded-xl bg-[#151d31] px-4 py-2.5 text-sm font-semibold text-white">종료</button>
          </div>
        </div>
      </div>
    )}
  </main>
}

function UpdateAvailableModal({ update, onDismiss, onOpen }: { update: AvailableUpdate; onDismiss: () => void; onOpen: () => void | Promise<void> }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return <div className="fixed inset-0 z-[160] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-md" onClick={onDismiss}>
    <section role="dialog" aria-modal="true" aria-labelledby="update-title" className="relative w-full max-w-[470px] overflow-hidden rounded-[28px] border border-white/15 bg-[#111a32] p-6 text-white shadow-[0_32px_90px_rgba(15,23,42,.55)] sm:p-8" onClick={(event) => event.stopPropagation()}>
      <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-indigo-500/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-52 w-52 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-6">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/15 bg-gradient-to-br from-indigo-400 to-cyan-300 text-[#10192f] shadow-lg shadow-indigo-950/30"><Sparkles size={25} /></div>
          <button aria-label="업데이트 알림 닫기" onClick={onDismiss} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={19} /></button>
        </div>
        <p className="mt-7 text-[11px] font-extrabold tracking-[.18em] text-cyan-200">NEW VERSION AVAILABLE</p>
        <h2 id="update-title" className="mt-3 text-2xl font-bold tracking-tight sm:text-[28px]">더 나은 Anki Helper가<br /><span className="bg-gradient-to-r from-indigo-200 via-violet-200 to-cyan-200 bg-clip-text text-transparent">준비되어 있어요.</span></h2>
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.07] px-4 py-3.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-cyan-200"><Download size={17} /></span>
          <div><p className="text-xs font-medium text-slate-300">새 버전</p><p className="mt-0.5 text-sm font-bold text-white">Anki Helper {update.version}</p></div>
        </div>
        <div className="mt-7 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button onClick={onDismiss} className="rounded-xl px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white">나중에</button>
          <button onClick={() => void onOpen()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-950/40 transition hover:-translate-y-0.5 hover:from-indigo-400 hover:to-violet-400 focus:outline-none focus:ring-2 focus:ring-cyan-200/80">업데이트 받기 <ArrowUpRight size={17} /></button>
        </div>
      </div>
    </section>
  </div>
}

function SpreadsheetImportWizard({ path, initial, onCancel, onSheetChange, onCreate }: {
  path: string
  initial: TablePreview
  onCancel: () => void
  onSheetChange: (sheet: string) => Promise<TablePreview>
  onCreate: (payload: { sheetName?: string; firstRowIsHeader: boolean; fieldNames: string[]; deckName: string; noteTypeName: string; frontField: number; backField: number; templateSourcePath?: string; templateNoteTypeId?: string; fieldMapping?: Record<number, number> }) => Promise<void>
}) {
  const [preview, setPreview] = useState(initial)
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(false)
  const [fieldNames, setFieldNames] = useState(() => initial.sample_rows[0]?.map((_, index) => `필드 ${index + 1}`) ?? [])
  const [deckName, setDeckName] = useState(() => initial.source_name.replace(/\.[^.]+$/, ''))
  const [noteTypeName, setNoteTypeName] = useState('기본')
  const [frontField, setFrontField] = useState(0)
  const [backField, setBackField] = useState(() => Math.min(1, Math.max(initial.column_count - 1, 0)))
  const [switchingSheet, setSwitchingSheet] = useState(false)
  const [templateSourcePath, setTemplateSourcePath] = useState('')
  const [templateTypes, setTemplateTypes] = useState<SourceNoteType[]>([])
  const [templateTypeId, setTemplateTypeId] = useState('')
  const [templateMapping, setTemplateMapping] = useState<Record<number, number>>({})
  const [activeColumn, setActiveColumn] = useState<number | null>(null)
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [mappingBeforeOpen, setMappingBeforeOpen] = useState<Record<number, number>>({})
  const columns = Array.from({ length: preview.column_count }, (_, index) => index)
  const templateType = templateTypes.find((item) => item.id === templateTypeId)
  const shownRows = preview.sample_rows.slice(firstRowIsHeader ? 1 : 0)
  const invalidNames = fieldNames.length !== preview.column_count || fieldNames.some((name) => !name.trim()) || new Set(fieldNames.map((name) => name.trim().toLowerCase())).size !== fieldNames.length
  const changeSheet = async (sheet: string) => {
    if (sheet === preview.selected_sheet) return
    setSwitchingSheet(true)
    try {
      const next = await onSheetChange(sheet)
      setPreview(next)
      setFirstRowIsHeader(false)
      setFieldNames(Array.from({ length: next.column_count }, (_, index) => `필드 ${index + 1}`))
      setFrontField(0)
      setBackField(Math.min(1, Math.max(next.column_count - 1, 0)))
    } finally { setSwitchingSheet(false) }
  }
  const setHeaderMode = (next: boolean) => {
    setFirstRowIsHeader(next)
    if (next) setFieldNames(columns.map((index) => preview.sample_rows[0]?.[index]?.trim() || `필드 ${index + 1}`))
    else setFieldNames(columns.map((index) => `필드 ${index + 1}`))
  }
  const autoMap = (type: SourceNoteType) => {
    const next: Record<number, number> = {}
    for (const column of columns) {
      const target = type.fields.find((field) => field.name.trim().toLowerCase() === (fieldNames[column] ?? '').trim().toLowerCase())
      if (target) next[column] = target.order
    }
    setTemplateMapping(next)
    setActiveColumn(null)
  }
  const chooseTemplateSource = async () => {
    const selected = await open({ multiple: false, filters: [{ name: 'Anki 패키지 또는 편집 프로젝트', extensions: ['apkg', 'zip'] }] })
    if (typeof selected !== 'string') return
    setLoadingTemplate(true)
    try {
      const result = await api.inspectNoteTypeSource(selected)
      setTemplateSourcePath(selected)
      setTemplateTypes(result.note_types)
      const first = result.note_types[0]
      setTemplateTypeId(first?.id ?? '')
      if (first) autoMap(first)
    } finally { setLoadingTemplate(false) }
  }
  const connectTemplateField = (destination: number) => {
    if (activeColumn === null) return
    setTemplateMapping((current) => {
      const next = { ...current }
      for (const [source, target] of Object.entries(next)) if (target === destination) delete next[Number(source)]
      next[activeColumn] = destination
      return next
    })
    setActiveColumn(null)
  }
  const applyTemplateMapping = () => {
    if (!templateType) return
    setFieldNames((names) => names.map((name, source) => {
      const destination = templateMapping[source]
      return destination === undefined ? name : templateType.fields[destination]?.name ?? name
    }))
    setMappingOpen(false)
  }
  useEffect(() => {
    if (mappingOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mappingOpen, onCancel])
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6">
    <div role="dialog" aria-modal="true" aria-label="Excel에서 새 덱 만들기" className="flex max-h-[calc(100vh-24px)] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-white/70 bg-[#f7f8fc] shadow-2xl sm:max-h-[calc(100vh-48px)] sm:rounded-[28px]">
      <div className="flex shrink-0 items-start justify-between border-b border-slate-200/80 bg-white px-5 py-5 sm:px-7">
        <div><div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[.12em] text-indigo-500"><FileSpreadsheet size={15} /> STRUCTURED DATA</div><h2 className="text-xl font-semibold tracking-tight text-slate-900">엑셀에서 새 Anki 덱 만들기</h2></div>
        <button onClick={onCancel} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="가져오기 취소"><X size={19} /></button>
      </div>
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,.7fr)]">
        <section className="min-w-0 border-b border-slate-200/80 p-5 lg:border-b-0 lg:border-r lg:p-7">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3"><div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-6 gap-y-3"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">원본 데이터</p><p title={preview.source_name} className="mt-0.5 max-w-[360px] truncate text-xs text-slate-500">{preview.source_name} · {preview.row_count.toLocaleString()}행 · {preview.column_count}열</p></div>{templateType && <div className="min-w-[235px] border-l border-slate-200 pl-5"><p className="text-sm font-semibold text-slate-800">불러온 노트 유형</p><p className="mt-0.5 text-xs text-slate-500">{templateType.name} · {templateType.fields.length}개 필드 · 카드 {templateType.template_count}개</p>{templateTypes.length > 1 && <select value={templateTypeId} onChange={(event) => { const next = templateTypes.find((item) => item.id === event.target.value); setTemplateTypeId(event.target.value); if (next) autoMap(next) }} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-indigo-400">{templateTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</div>}</div>{preview.sheet_names.length > 1 && <label className="shrink-0 text-xs font-semibold text-slate-500">시트 <select value={preview.selected_sheet} disabled={switchingSheet} onChange={(event) => void changeSheet(event.target.value)} className="ml-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-700 outline-none focus:border-indigo-400">{preview.sheet_names.map((sheet) => <option key={sheet}>{sheet}</option>)}</select></label>}</div>
          <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm text-slate-700 transition hover:border-indigo-200"><input type="checkbox" checked={firstRowIsHeader} onChange={(event) => setHeaderMode(event.target.checked)} className="h-4 w-4 accent-indigo-600" /><span><b className="font-semibold">첫 행을 필드명 후보로 사용</b><span className="ml-1.5 text-slate-500">아래에서 언제든 직접 수정할 수 있습니다.</span></span></label>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="min-w-full border-collapse text-left text-xs"><thead className="bg-slate-50 text-slate-400"><tr>{columns.map((index) => <th key={index} className="min-w-[120px] border-b border-slate-200 px-3 py-2.5 font-semibold">열 {String.fromCharCode(65 + index)}</th>)}</tr></thead><tbody>{shownRows.length ? shownRows.slice(0, 7).map((row, rowIndex) => <tr key={rowIndex} className="border-b border-slate-100 last:border-0">{columns.map((column) => <td key={column} className="max-w-[210px] truncate px-3 py-2.5 text-slate-600" title={row[column] ?? ''}>{row[column] || <span className="text-slate-300">—</span>}</td>)}</tr>) : <tr><td colSpan={Math.max(columns.length, 1)} className="px-4 py-8 text-center text-slate-400">표시할 데이터 행이 없습니다.</td></tr>}</tbody></table></div></div>
          <p className="mt-3 text-xs leading-5 text-slate-400">미리보기는 처음 10행만 표시합니다. 빈 행은 새 덱을 만들 때 제외됩니다.{preview.omitted_empty_columns > 0 && ` 완전히 빈 열 ${preview.omitted_empty_columns}개는 건너뛰며, 필요하면 가져온 뒤 필드 관리에서 추가할 수 있습니다.`}</p>
        </section>
        <section className="p-5 lg:p-7">
          <div className="mb-5 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-xs font-bold text-white">1</span><h3 className="font-semibold text-slate-800">덱과 필드 확인</h3></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><label className="text-xs font-semibold text-slate-500">덱 이름<input value={deckName} onChange={(event) => setDeckName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>{!templateType && <label className="text-xs font-semibold text-slate-500">새 노트 유형 이름<input value={noteTypeName} onChange={(event) => setNoteTypeName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>}</div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">{templateType ? <button type="button" onClick={() => { setMappingBeforeOpen(templateMapping); setMappingOpen(true) }} className="flex w-full items-center justify-between text-left"><span><b className="block text-sm text-slate-800">엑셀 열 연결</b><small className="mt-0.5 block text-xs text-slate-500">{Object.keys(templateMapping).length}개 필드 연결됨</small></span><ArrowRightLeft size={18} className="text-indigo-500" /></button> : <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">기존 노트 유형 사용 <span className="font-normal text-slate-400">(선택)</span></p></div><button type="button" onClick={() => void chooseTemplateSource()} disabled={loadingTemplate} className="shrink-0 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50">{loadingTemplate ? '불러오는 중…' : '노트 유형 불러오기'}</button></div>}</div>
          <div className="mt-5"><p className="mb-2 text-xs font-semibold text-slate-500">{templateType ? '엑셀 열' : 'Anki 필드명'}</p><div className="space-y-2">{columns.map((column) => <div key={column} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="w-8 text-center text-xs font-bold text-indigo-500">{String.fromCharCode(65 + column)}</span>{templateType ? <span className="min-w-0 flex-1 py-2.5 text-sm font-medium text-slate-600">{fieldNames[column] || `열 ${column + 1}`}</span> : <input value={fieldNames[column] ?? ''} onChange={(event) => setFieldNames((names) => names.map((name, index) => index === column ? event.target.value : name))} placeholder={`필드 ${column + 1}`} className="min-w-0 flex-1 bg-transparent py-2.5 text-sm font-medium text-slate-800 outline-none" />}</div>)}</div>{!templateType && invalidNames && <p className="mt-2 text-xs font-medium text-rose-600">비어 있거나 중복된 필드명이 있습니다.</p>}</div>
        </section>
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-slate-200/80 bg-white px-5 py-4 sm:px-7"><p className="hidden text-xs text-slate-400 sm:block">저장 위치는 다음 단계에서 선택합니다.</p><div className="ml-auto flex gap-2"><button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">취소</button><button disabled={invalidNames || !deckName.trim() || !noteTypeName.trim() || !preview.column_count || (!!templateType && Object.keys(templateMapping).length === 0)} onClick={() => void onCreate({ sheetName: preview.selected_sheet, firstRowIsHeader, fieldNames, deckName, noteTypeName, frontField, backField, templateSourcePath: templateType ? templateSourcePath : undefined, templateNoteTypeId: templateType?.id, fieldMapping: templateType ? templateMapping : undefined })} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"><Sparkles size={16} />새 덱 초안 만들기</button></div></div>
    </div>
    {templateType && mappingOpen && <TemplateFieldMappingModal columns={columns} names={fieldNames} destination={templateType} mapping={templateMapping} activeColumn={activeColumn} onSelectColumn={(column) => { setActiveColumn(column); if (templateMapping[column] !== undefined) setTemplateMapping((current) => { const next = { ...current }; delete next[column]; return next }) }} onConnect={connectTemplateField} onCancel={() => { setTemplateMapping(mappingBeforeOpen); setMappingOpen(false); setActiveColumn(null) }} onDone={applyTemplateMapping} />}
  </div>
}

function TemplateFieldMappingModal({ columns, names, destination, mapping, activeColumn, onSelectColumn, onConnect, onCancel, onDone }: { columns: number[]; names: string[]; destination: SourceNoteType; mapping: Record<number, number>; activeColumn: number | null; onSelectColumn: (column: number) => void; onConnect: (field: number) => void; onCancel: () => void; onDone: () => void }) {
  const sourceAnchors = columns.map((_, index) => 28 + index * 56 + 20)
  const destinationAnchors = destination.fields.map((_, index) => 28 + index * 56 + 20)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-label="엑셀 열 연결" className="flex max-h-[calc(100vh-32px)] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] border border-white/70 bg-white shadow-2xl"><div className="flex shrink-0 items-start justify-between border-b border-slate-100 p-6"><div><h3 className="text-lg font-semibold text-slate-900">엑셀 열 연결</h3><p className="mt-1 text-sm text-slate-500">왼쪽 열을 누른 뒤 오른쪽 필드를 누르면 연결됩니다.</p></div><button onClick={onCancel} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="연결 취소"><X size={19} /></button></div><div className="min-h-0 overflow-y-auto p-6"><div className="relative grid grid-cols-[1fr_72px_1fr] gap-3"><div className="space-y-2">{columns.map((column) => { const linked = mapping[column] !== undefined; return <button key={column} type="button" onClick={() => onSelectColumn(column)} className={`flex h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ${activeColumn === column ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : linked ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}><span className="truncate">{names[column] || `열 ${column + 1}`}</span><span className="h-3 w-3 rounded-full bg-indigo-500" /></button> })}</div><div className="relative"><svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 72 ${Math.max(columns.length, destination.fields.length) * 56}`} preserveAspectRatio="none">{Object.entries(mapping).map(([source, target]) => <path key={`${source}-${target}`} d={`M 8 ${sourceAnchors[Number(source)]} C 36 ${sourceAnchors[Number(source)]}, 36 ${destinationAnchors[target]}, 64 ${destinationAnchors[target]}`} fill="none" stroke="#6366f1" strokeWidth="2.5" />)}</svg></div><div className="space-y-2">{destination.fields.map((field) => { const taken = Object.values(mapping).includes(field.order); return <button key={field.order} type="button" onClick={() => onConnect(field.order)} className={`flex h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ${taken ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : activeColumn !== null ? 'border-indigo-200 bg-indigo-50/40 text-slate-700' : 'border-slate-200 bg-white text-slate-700'}`}><span className="h-3 w-3 rounded-full bg-indigo-500" /><span className="truncate">{field.name}</span></button> })}</div></div></div><div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 p-5"><button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button><button onClick={onDone} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">완료</button></div></div></div>
}

function SideAction({ label, icon: Icon, compact, disabled, onClick }: { label: string; icon: typeof Download; compact: boolean; disabled?: boolean; onClick: () => void }) { return <button disabled={disabled} onClick={onClick} title={label} className="flex h-9 w-full items-center rounded-xl px-3 text-[11px] font-medium text-slate-500 transition hover:bg-white/[.055] hover:text-slate-200 disabled:opacity-30"><Icon size={16} /><span className={`${compact ? 'w-0 opacity-0' : 'ml-3 opacity-100'} whitespace-nowrap transition-all`}>{label}</span></button> }

function Welcome({ onOpen, busy, dragActive }: { onOpen: () => void; busy: boolean; dragActive: boolean }) {
  return <div className={`relative grid h-full min-h-0 place-items-center overflow-hidden rounded-[22px] bg-[#0d1425] px-5 transition lg:rounded-[28px] lg:px-6 ${dragActive ? 'ring-2 ring-cyan-200/80 ring-offset-4 ring-offset-[#eef1f7]' : ''}`}>
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_22%,rgba(99,102,241,.32),transparent_36%),radial-gradient(ellipse_at_80%_78%,rgba(20,184,166,.17),transparent_37%)]" />
    <div className={`pointer-events-none absolute inset-4 rounded-[18px] border border-dashed border-cyan-200/0 transition lg:rounded-[24px] ${dragActive ? 'border-cyan-200/70 bg-cyan-200/[.04]' : ''}`} />
    <div className="relative max-w-xl text-center"><div className="welcome-rise mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[19px] bg-white/10 ring-1 ring-white/15 lg:mb-7 lg:h-16 lg:w-16 lg:rounded-[22px]"><Sparkles className="text-violet-200" size={29} /></div><h2 className="text-[34px] font-semibold leading-[1.2] tracking-[-.045em] text-white sm:text-[38px] lg:text-[42px]"><span className="welcome-rise welcome-delay-title block">복잡한 Anki 파일,</span><span className="welcome-rise welcome-delay-subtitle block bg-gradient-to-r from-violet-300 to-cyan-200 bg-clip-text text-transparent">누구보다 쉽게 다루세요.</span></h2><p className="welcome-rise welcome-delay-copy mt-4 text-sm leading-6 text-slate-400">Excel로 새 덱을 만들거나 기존 APKG를 열어 이어서 편집할 수 있습니다.</p><div className="welcome-rise welcome-delay-action mt-6 flex flex-col justify-center gap-2 sm:flex-row lg:mt-7"><button onClick={() => window.dispatchEvent(new Event('ankihelper:import-table'))} disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-slate-900 transition hover:bg-indigo-50 lg:h-12"><FileSpreadsheet size={18} />엑셀로 새 덱 만들기</button><button onClick={onOpen} disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10 lg:h-12">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <FolderOpen size={18} />}기존 파일 열기</button></div></div>
  </div>
}

function defaultFieldMapping(source: NoteType, destination: NoteType): Record<number, number> {
  const mapping: Record<number, number> = {}
  const used = new Set<number>()
  for (const dest of destination.fields) {
    const match = source.fields.find((field) => field.name.toLowerCase() === dest.name.toLowerCase())
    if (match && !used.has(dest.order)) {
      mapping[match.order] = dest.order
      used.add(dest.order)
    }
  }
  return mapping
}

function Overview({ workspace, selected, onPage, onSelect, onDeleteNoteType, onMoveNotes }: {
  workspace: Workspace
  selected?: NoteType
  onPage: (page: Page) => void
  onSelect: (id: string) => void
  onDeleteNoteType: (id: string) => Promise<boolean>
  onMoveNotes: (fromId: string, toId: string, mapping: Record<number, number>) => Promise<void>
}) {
  const [movingFrom, setMovingFrom] = useState<NoteType | null>(null)
  const [movingTo, setMovingTo] = useState<NoteType | null>(null)
  const [mapping, setMapping] = useState<Record<number, number>>({})
  const [activeSource, setActiveSource] = useState<number | null>(null)
  const [busyMove, setBusyMove] = useState(false)
  const [deletingType, setDeletingType] = useState<NoteType | null>(null)
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [lineBox, setLineBox] = useState({ width: 0, height: 0 })
  const otherTypes = movingFrom ? workspace.note_types.filter((item) => item.id !== movingFrom.id) : []

  useEffect(() => {
    if (!movingTo || !mapRef.current) return
    const update = () => {
      if (!mapRef.current) return
      setLineBox({ width: mapRef.current.clientWidth, height: mapRef.current.clientHeight })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [movingTo, mapping, movingFrom])

  const closeMove = () => {
    setMovingFrom(null)
    setMovingTo(null)
    setMapping({})
    setActiveSource(null)
  }

  useEffect(() => {
    if (!movingFrom) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (movingTo) { setMovingTo(null); setMapping({}); setActiveSource(null) }
      else closeMove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [movingFrom, movingTo])

  const chooseDestination = (item: NoteType) => {
    if (!movingFrom) return
    setMovingTo(item)
    setMapping(defaultFieldMapping(movingFrom, item))
    setActiveSource(null)
  }

  const connectField = (destinationOrder: number) => {
    if (activeSource === null) return
    setMapping((current) => {
      const next = { ...current }
      for (const [source, destination] of Object.entries(next)) {
        if (Number(destination) === destinationOrder) delete next[Number(source)]
      }
      next[activeSource] = destinationOrder
      return next
    })
    setActiveSource(null)
  }

  const clearSourceLink = (sourceOrder: number) => {
    setMapping((current) => {
      const next = { ...current }
      delete next[sourceOrder]
      return next
    })
  }

  const sourceAnchors = movingFrom?.fields.map((_, index) => 28 + index * 56 + 20) ?? []
  const destAnchors = movingTo?.fields.map((_, index) => 28 + index * 56 + 20) ?? []

  return <div className="mx-auto max-w-[1420px] space-y-4 lg:space-y-5">
    <section className="rounded-[20px] bg-[#151d31] px-5 py-5 text-white lg:rounded-[26px] lg:px-8 lg:py-7"><div className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-0"><div className="mb-2 flex items-center gap-2 truncate text-[11px] text-indigo-200 lg:mb-3"><BookOpen size={14} className="shrink-0" />{workspace.source_name}</div><h2 className="truncate text-xl font-semibold lg:text-2xl">{selected?.name}</h2></div><span className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-slate-300">원본은 저장할 때 자동 백업됩니다</span></div></section>
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4"><Stat label="카드" value={selected?.notes.length ?? 0} icon={BookOpen} /><FieldSummary fields={selected?.fields ?? []} /><Stat label="미디어" value={workspace.media_count} icon={Music2} /></section>
    <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr] lg:gap-5">
      <Card title="노트 유형">
        <p className="-mt-2 mb-4 text-sm text-slate-400">카드를 다른 노트 유형으로 옮기려면 이동 버튼을 누르세요. 카드가 0개인 유형은 제거할 수 있습니다.</p>
        <div className="space-y-2">{workspace.note_types.map((item, index) => (
          <div key={item.id} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${item.id === selected?.id ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-slate-50'}`}>
            <button onClick={() => onSelect(item.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-white/70">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-xs font-bold text-white">{index + 1}</span>
              <span className="min-w-0"><b className="block truncate text-sm">{item.name}</b><small className="text-slate-400">{item.notes.length}개 카드 · {item.fields.length}개 필드</small></span>
            </button>
            <button title="카드 이동" disabled={item.notes.length === 0 || workspace.note_types.length < 2} onClick={() => { setMovingFrom(item); setMovingTo(null) }} className="rounded-lg p-2 text-indigo-600 hover:bg-indigo-100 disabled:opacity-25"><ArrowRightLeft size={16} /></button>
            <button title="노트 유형 제거" disabled={item.notes.length > 0 || workspace.note_types.length <= 1} onClick={() => setDeletingType(item)} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50 disabled:opacity-25"><Trash2 size={16} /></button>
          </div>
        ))}</div>
      </Card>
      <Card title="바로가기"><div className="space-y-2"><Quick label="카드 데이터" icon={Table2} onClick={() => onPage('data')} /><Quick label="필드 관리" icon={ListChecks} onClick={() => onPage('fields')} /><Quick label="미디어 관리" icon={Music2} onClick={() => onPage('media')} /><Quick label="카드 디자인" icon={Braces} onClick={() => onPage('design')} /></div></Card>
    </section>

    {movingFrom && !movingTo && (
      <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-indigo-100 text-indigo-600"><ArrowRightLeft size={20} /></div>
          <h3 className="text-lg font-semibold">‘{movingFrom.name}’ 카드를 어디로 옮길까요?</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">{movingFrom.notes.length.toLocaleString()}개 카드가 이동합니다. 다음 단계에서 필드를 선으로 연결합니다.</p>
          <div className="mt-5 max-h-72 space-y-2 overflow-y-auto">
            {otherTypes.map((item) => (
              <button key={item.id} disabled={busyMove} onClick={() => chooseDestination(item)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50">
                <span><b className="block text-sm text-slate-700">{item.name}</b><small className="text-xs text-slate-400">현재 {item.notes.length.toLocaleString()}개 카드 · {item.fields.length}개 필드</small></span>
                <ArrowRight className="text-slate-300" size={16} />
              </button>
            ))}
          </div>
          <div className="mt-6 flex justify-end"><button onClick={closeMove} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button></div>
        </div>
      </div>
    )}

    {movingFrom && movingTo && (
      <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
        <div className="w-full max-w-3xl rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-indigo-100 text-indigo-600"><ArrowRightLeft size={20} /></div>
          <h3 className="text-lg font-semibold">필드를 선으로 이으세요</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">왼쪽(출발: {movingFrom.name})을 누른 뒤 오른쪽(도착: {movingTo.name})을 누르면 연결됩니다. 같은 이름은 자동으로 이어 둡니다.</p>
          <div ref={mapRef} className="relative mt-5 grid grid-cols-[1fr_72px_1fr] gap-3">
            <div className="space-y-2">
              {movingFrom.fields.map((field) => {
                const linked = mapping[field.order]
                const active = activeSource === field.order
                return <button key={field.order} onClick={() => { setActiveSource(field.order); if (linked !== undefined) clearSourceLink(field.order) }} className={`flex h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ${active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : linked !== undefined ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}>
                  <span>{field.name}</span>
                  <span className={`h-3 w-3 rounded-full ${active || linked !== undefined ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                </button>
              })}
            </div>
            <div className="relative">
              <svg className="pointer-events-none absolute inset-0 h-full w-full" width={lineBox.width || 72} height={Math.max(lineBox.height, Math.max(sourceAnchors.length, destAnchors.length) * 56)}>
                {Object.entries(mapping).map(([source, destination]) => {
                  const y1 = sourceAnchors[Number(source)] ?? 0
                  const y2 = destAnchors[Number(destination)] ?? 0
                  return <path key={`${source}-${destination}`} d={`M 8 ${y1} C 36 ${y1}, 36 ${y2}, 64 ${y2}`} fill="none" stroke="#6366f1" strokeWidth="2.5" />
                })}
              </svg>
            </div>
            <div className="space-y-2">
              {movingTo.fields.map((field) => {
                const taken = Object.values(mapping).includes(field.order)
                return <button key={field.order} onClick={() => connectField(field.order)} className={`flex h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ${taken ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : activeSource !== null ? 'border-indigo-200 bg-indigo-50/40 text-slate-700' : 'border-slate-200 bg-white text-slate-700'}`}>
                  <span className={`h-3 w-3 rounded-full ${taken ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                  <span>{field.name}</span>
                </button>
              })}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => { setMovingTo(null); setMapping({}); setActiveSource(null) }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">뒤로</button>
            <button
              disabled={busyMove || Object.keys(mapping).length === 0}
              onClick={async () => {
                setBusyMove(true)
                try {
                  await onMoveNotes(movingFrom.id, movingTo.id, mapping)
                  onSelect(movingTo.id)
                  closeMove()
                } finally {
                  setBusyMove(false)
                }
              }}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busyMove ? '이동 중…' : `${movingFrom.notes.length.toLocaleString()}개 카드 이동`}
            </button>
          </div>
        </div>
      </div>
    )}

    {deletingType && (
      <Modal
        title={`‘${deletingType.name}’ 노트 유형을 제거할까요?`}
        description="카드가 없는 빈 유형만 제거할 수 있습니다. 저장하면 APKG에서도 사라집니다."
        tone="danger"
        confirmLabel="제거"
        onCancel={() => setDeletingType(null)}
        onConfirm={async () => {
          if (await onDeleteNoteType(deletingType.id)) setDeletingType(null)
        }}
      />
    )}
  </div>
}
function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[22px] lg:p-5"><h3 className="mb-4 text-lg font-semibold">{title}</h3>{children}</section> }
function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof BookOpen }) { return <div className="rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[20px] lg:p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold lg:text-3xl">{value.toLocaleString()}</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-600"><Icon size={19} /></span></div></div> }
function FieldSummary({ fields }: { fields: Field[] }) { const shown = fields.slice(0, 4); return <div className="rounded-[20px] border border-slate-200/70 bg-white p-5 shadow-card"><p className="text-xs font-semibold text-slate-400">필드 목록</p><div className="mt-3 flex flex-wrap gap-1.5">{shown.map((field) => <span key={field.order} title={field.name} className="max-w-[120px] truncate rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">{field.name}</span>)}{fields.length > shown.length && <span className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-600">외 {fields.length - shown.length}개</span>}</div><button onClick={() => window.dispatchEvent(new CustomEvent('ankihelper:navigate', { detail: 'fields' }))} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">필드 관리에서 전체 보기<ArrowRight size={13} /></button></div> }
function Quick({ label, icon: Icon, onClick }: { label: string; icon: typeof Table2; onClick: () => void }) { const descriptions: Record<string, string> = { '카드 데이터': '불러온 필드와 노트를 확인합니다', '필드 관리': '필드 이름과 구성을 편집합니다', '미디어 관리': '음성과 이미지를 확인하고 저장합니다', '카드 디자인': 'HTML과 CSS 템플릿을 편집합니다' }; return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-3 text-left hover:bg-indigo-50"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-slate-600 shadow-sm"><Icon size={17} /></span><span><b className="block text-sm text-slate-700">{label}</b><small className="mt-0.5 block text-xs text-slate-400">{descriptions[label]}</small></span><ArrowRight className="ml-auto text-slate-300" size={15} /></button> }

function splitCellContent(value: string) {
  const mediaMatches = [...value.matchAll(/\[sound:([^\]]+)\]|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
  const media = mediaMatches.map((match) => {
    const filename = match[1] ?? match[2]?.split(/[\\/]/).pop() ?? ''
    return { filename, isSound: Boolean(match[1]) }
  }).filter((item) => item.filename)
  const text = value
    .replace(/\[sound:[^\]]+\]/gi, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { text, media, filename: media[0]?.filename, isSound: media[0]?.isSound ?? false }
}

function DataPage({ noteType, onUpdate }: { noteType?: NoteType; onUpdate: (row: number, fieldOrder: number, value: string) => Promise<void> }) {
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

function FieldsPage({ noteType, onRename, onAdd, onDelete, onReorder, onMove, onClone }: {
  noteType?: NoteType
  onRename: (order: number, name: string) => Promise<void>
  onAdd: (name: string) => Promise<void>
  onDelete: (order: number) => Promise<void>
  onReorder: (order: number, newOrder: number) => Promise<void>
  onMove: (order: number, destination: number, mode: 'text' | 'media' | 'all') => Promise<number>
  onClone: (name: string) => Promise<void>
}) {
  const [newName, setNewName] = useState('')
  const [cloneName, setCloneName] = useState('')
  const [deleting, setDeleting] = useState<Field | null>(null)
  const [moving, setMoving] = useState<Field | null>(null)
  const [moveStep, setMoveStep] = useState<'destination' | 'payload' | 'confirm'>('destination')
  const [destination, setDestination] = useState<Field | null>(null)
  const [moveMode, setMoveMode] = useState<'text' | 'media' | 'all'>('all')
  const [summary, setSummary] = useState<{ filled: number; mixed: number; has_mixed: boolean; destination_filled: Record<string, number>; sample_text: string; sample_media: string } | null>(null)
  const [busyMove, setBusyMove] = useState(false)

  useEffect(() => {
    if (!moving) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMoving(null); setDestination(null); setSummary(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moving])

  if (!noteType) return null
  const filled = deleting ? noteType.notes.filter((row) => Boolean(row[deleting.order]?.trim())).length : 0

  const openMove = async (field: Field) => {
    setMoving(field)
    setMoveStep('destination')
    setDestination(null)
    setMoveMode('all')
    setSummary(null)
    try {
      const next = await api.fieldContentSummary(noteType.id, field.order)
      setSummary(next)
    } catch {
      setSummary({ filled: 0, mixed: 0, has_mixed: false, destination_filled: {}, sample_text: '', sample_media: '' })
    }
  }

  const chooseDestination = (field: Field) => {
    setDestination(field)
    if (summary?.has_mixed) {
      setMoveStep('payload')
      return
    }
    const destFilled = summary?.destination_filled?.[String(field.order)] ?? 0
    if (destFilled > 0) {
      setMoveMode('all')
      setMoveStep('confirm')
      return
    }
    void runMove(field, 'all')
  }

  const choosePayload = (mode: 'text' | 'media' | 'all') => {
    if (!destination) return
    setMoveMode(mode)
    const destFilled = summary?.destination_filled?.[String(destination.order)] ?? 0
    if (destFilled > 0) {
      setMoveStep('confirm')
      return
    }
    void runMove(destination, mode)
  }

  const runMove = async (target: Field, mode: 'text' | 'media' | 'all') => {
    if (!moving) return
    setBusyMove(true)
    try {
      await onMove(moving.order, target.order, mode)
      setMoving(null)
      setDestination(null)
      setSummary(null)
    } finally {
      setBusyMove(false)
    }
  }

  return <div className="mx-auto max-w-[1420px] space-y-5">
    <Card title="필드 구성">
      <p className="-mt-2 mb-5 text-sm text-slate-400">이름을 바꾸면 카드 디자인의 필드 참조도 함께 바뀝니다. 위·아래 버튼으로 순서를 바꾸고, 내용이 잘못된 칸에 들어갔다면 이동 버튼으로 텍스트와 미디어를 옮길 수 있습니다.</p>
      <div className="mb-5 overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-400"><tr>{noteType.fields.map((field) => <th key={field.order} className="px-3 py-2 font-semibold">{field.name}</th>)}</tr></thead>
          <tbody>{noteType.notes.slice(0, 2).map((row, index) => <tr key={index} className="border-t border-slate-100">{noteType.fields.map((field) => <td key={field.order} className="max-w-[180px] truncate px-3 py-2 text-slate-600">{row[field.order] || '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="grid gap-2 md:grid-cols-2">{noteType.fields.map((field, index) => (
        <div key={`${field.order}-${field.name}`} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
          <div className="flex flex-col">
            <button title="위로" disabled={index === 0} onClick={() => void onReorder(field.order, field.order - 1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20"><ChevronUp size={14} /></button>
            <button title="아래로" disabled={index >= noteType.fields.length - 1} onClick={() => void onReorder(field.order, field.order + 1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20"><ChevronDown size={14} /></button>
          </div>
          <span className="w-7 text-xs font-bold text-slate-400">{String(field.order + 1).padStart(2, '0')}</span>
          <input defaultValue={field.name} onBlur={(event) => { const value = event.currentTarget.value.trim(); if (value && value !== field.name) void onRename(field.order, value) }} className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none" />
          <button title="내용 이동" onClick={() => void openMove(field)} className="rounded-lg p-2 text-indigo-600 hover:bg-indigo-50"><ArrowRightLeft size={15} /></button>
          <button title="필드 삭제" onClick={() => setDeleting(field)} disabled={noteType.fields.length <= 1} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50 disabled:opacity-25"><Trash2 size={15} /></button>
        </div>
      ))}</div>
      <form className="mt-4 flex gap-2" onSubmit={async (event) => { event.preventDefault(); if (newName.trim()) { await onAdd(newName.trim()); setNewName('') } }}>
        <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="새 필드 이름" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
        <button className="inline-flex items-center gap-2 rounded-xl bg-[#151d31] px-4 text-sm font-semibold text-white"><Plus size={15} />필드 추가</button>
      </form>
    </Card>

    <Card title="새 노트 유형으로 저장">
      <p className="-mt-2 mb-4 text-sm leading-6 text-slate-400">지금 구성을 <b className="font-semibold text-slate-600">새 노트 유형</b>으로 만들고, <b className="font-semibold text-slate-600">카드도 함께 옮깁니다</b>. 원래 유형은 카드 0개가 됩니다.<br />Anki에서 기존 공유 유형을 덮어쓰지 않으려면 이 방법이 안전합니다.</p>
      <div className="flex gap-2">
        <input value={cloneName} onChange={(event) => setCloneName(event.target.value)} placeholder="새 노트 유형 이름" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none" />
        <button
          disabled={!cloneName.trim()}
          onClick={async () => { if (cloneName.trim()) { await onClone(cloneName.trim()); setCloneName('') } }}
          className={`rounded-xl border px-4 text-sm font-semibold transition ${cloneName.trim() ? 'border-indigo-200 text-indigo-700 hover:bg-indigo-50' : 'cursor-not-allowed border-slate-200 text-slate-300'}`}
        >
          저장
        </button>
      </div>
    </Card>

    {deleting && <Modal title={`‘${deleting.name}’ 필드를 삭제할까요?`} description={filled ? `${filled.toLocaleString()}개 노트에 내용이 있습니다. 필드 값과 템플릿 참조가 함께 삭제되며 저장 후에는 백업으로만 복구할 수 있습니다.` : '비어 있는 필드입니다. 템플릿의 필드 참조도 함께 삭제됩니다.'} tone="danger" confirmLabel="필드 삭제" onCancel={() => setDeleting(null)} onConfirm={async () => { await onDelete(deleting.order); setDeleting(null) }} />}

    {moving && (
      <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-indigo-100 text-indigo-600"><ArrowRightLeft size={20} /></div>
          {moveStep === 'destination' && (
            <>
              <h3 className="text-lg font-semibold">‘{moving.name}’ 내용을 어디로 옮길까요?</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{summary ? `${summary.filled.toLocaleString()}개 노트에 내용이 있습니다.` : '도착할 필드를 선택하세요.'} 도착 필드에 이미 값이 있으면 뒤에 이어 붙입니다.</p>
              <div className="mt-5 max-h-72 space-y-2 overflow-y-auto">
                {noteType.fields.filter((field) => field.order !== moving.order).map((field) => {
                  const occupied = summary?.destination_filled?.[String(field.order)] ?? 0
                  return <button key={field.order} disabled={busyMove} onClick={() => chooseDestination(field)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50">
                    <span><b className="block text-sm text-slate-700">{field.name}</b><small className="text-xs text-slate-400">{occupied > 0 ? `${occupied.toLocaleString()}개 노트에 기존 내용 있음` : '비어 있는 필드'}</small></span>
                    <ArrowRight className="text-slate-300" size={16} />
                  </button>
                })}
              </div>
            </>
          )}
          {moveStep === 'payload' && destination && (
            <>
              <h3 className="text-lg font-semibold">무엇을 옮길까요?</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">‘{moving.name}’에는 텍스트와 미디어가 섞여 있습니다. 예: {summary?.sample_text || '텍스트'} + {summary?.sample_media || '사운드/이미지 태그'}</p>
              <div className="mt-5 grid gap-3">
                <button disabled={busyMove} onClick={() => choosePayload('text')} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700"><Type size={20} /></span>
                  <span><b className="block text-sm text-slate-800">텍스트만</b><small className="text-xs text-slate-400">단어·뜻 같은 글자만 ‘{destination.name}’으로</small></span>
                </button>
                <button disabled={busyMove} onClick={() => choosePayload('media')} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-100 text-violet-700"><Music2 size={20} /></span>
                  <span><b className="block text-sm text-slate-800">미디어만</b><small className="text-xs text-slate-400">사운드 태그 / 이미지 태그만 ‘{destination.name}’으로</small></span>
                </button>
                <button disabled={busyMove} onClick={() => choosePayload('all')} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-white"><ArrowRightLeft size={20} /></span>
                  <span><b className="block text-sm text-slate-800">모두</b><small className="text-xs text-slate-400">칸 전체 내용을 ‘{destination.name}’으로</small></span>
                </button>
              </div>
            </>
          )}
          {moveStep === 'confirm' && destination && (
            <>
              <h3 className="text-lg font-semibold">도착 필드에 이미 내용이 있습니다</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">‘{destination.name}’에는 {(summary?.destination_filled?.[String(destination.order)] ?? 0).toLocaleString()}개 노트에 값이 있습니다. 이동하면 기존 내용 뒤에 이어 붙입니다.</p>
              <div className="mt-6 flex justify-end gap-2">
                <button onClick={() => setMoveStep(summary?.has_mixed ? 'payload' : 'destination')} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">뒤로</button>
                <button disabled={busyMove} onClick={() => void runMove(destination, moveMode)} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busyMove ? '이동 중…' : '이어 붙이며 이동'}</button>
              </div>
            </>
          )}
          {moveStep !== 'confirm' && <div className="mt-6 flex justify-end"><button onClick={() => { setMoving(null); setDestination(null) }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button></div>}
        </div>
      </div>
    )}
  </div>
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

function UnsavedWorkModal({ onCancel, onSave, onDiscard }: { onCancel: () => void; onSave: () => void; onDiscard: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return <div className="fixed inset-0 z-[210] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onCancel}><div role="dialog" aria-modal="true" aria-label="새 작업 시작" className="w-full max-w-md rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700"><Save size={20} /></div><h3 className="text-lg font-semibold text-slate-900">저장하지 않은 변경이 있습니다</h3><p className="mt-2 text-sm leading-6 text-slate-500">현재 작업을 저장한 뒤 새 작업을 시작하거나, 저장하지 않고 계속할 수 있습니다.</p><div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button><button onClick={onDiscard} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">저장하지 않고 계속</button><button onClick={onSave} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">저장 후 계속</button></div></div></div>
}

function Modal({ title, description, tone = 'normal', confirmLabel, onCancel, onConfirm }: { title: string; description: string; tone?: 'normal' | 'danger'; confirmLabel: string; onCancel?: () => void; onConfirm: () => void | Promise<void> }) {
  useEffect(() => {
    if (!onCancel) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl"><div className={`mb-4 grid h-11 w-11 place-items-center rounded-xl ${tone === 'danger' ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'}`}>{tone === 'danger' ? <X size={20} /> : <Check size={20} />}</div><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p><div className="mt-6 flex justify-end gap-2">{onCancel && <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button>}<button onClick={onConfirm} className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${tone === 'danger' ? 'bg-rose-600' : 'bg-indigo-600'}`}>{confirmLabel}</button></div></div></div>
}

export default App
