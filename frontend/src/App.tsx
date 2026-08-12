import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  Braces, ChevronDown, ChevronRight, Code2,
  Download, FileArchive, FolderOpen, Grid2X2, HardDrive,
  FileSpreadsheet, Layers3, ListChecks, LoaderCircle, Music2, PanelLeft,
  Play, Plus, Save, Table2,
} from 'lucide-react'
import { api, type NoteType, type TablePreview, type Workspace } from './api'
import { ExitConfirmModal, Modal, UnsavedWorkModal, UpdateAvailableModal, type AvailableUpdate } from './components/Modal'
import { SideAction } from './components/SideAction'
import { SpreadsheetImportWizard } from './components/SpreadsheetImportWizard'
import { Welcome } from './components/Welcome'
import { designDraftSavedValue, designDraftsArePending, parseDesignDraftKey, type EditorMode } from './designDrafts'
import { DataPage } from './pages/DataPage'
import { DesignPage } from './pages/DesignPage'
import { FieldsPage } from './pages/FieldsPage'
import { MediaPage } from './pages/MediaPage'
import { OverviewPage } from './pages/OverviewPage'
import { PreviewPage } from './pages/PreviewPage'
import { initialPreviewState, previewReducer, previewRequestKey, type PreviewSide } from './previewLifecycle'

type Page = 'overview' | 'data' | 'fields' | 'media' | 'design' | 'preview'
type ExportKind = 'tsv' | 'design' | 'bundle' | 'media' | 'project'
type PendingWork = { kind: 'open-picker' | 'table-picker' | 'open-path'; path?: string }

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
  const [previewState, dispatchPreview] = useReducer(previewReducer, initialPreviewState)
  const [previewDocument, setPreviewDocument] = useState<{ key: string; html: string } | null>(null)
  const previewRevision = useRef(0)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1080)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [designDrafts, setDesignDrafts] = useState<Record<string, string>>({})
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
  const designDraftDirty = useMemo(() => designDraftsArePending(designDrafts, workspace), [designDrafts, workspace])
  const unsavedWork = dirty || designDraftDirty
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
    dispatchPreview({ type: 'reset' })
  }, [selectedId])

  useEffect(() => {
    dispatchPreview({ type: 'reset' })
  }, [templateIndex])

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
    const mediaChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ workspace: Workspace } | Workspace>).detail
      hydrate(detail && typeof detail === 'object' && 'workspace' in detail ? detail.workspace : detail)
      setDirty(true)
    }
    window.addEventListener('ankihelper:media-changed', mediaChanged)
    return () => window.removeEventListener('ankihelper:media-changed', mediaChanged)
  }, [hydrate])
  useEffect(() => {
    if (!selected?.templates.length) return
    const requestKey = previewRequestKey(selected.id, templateIndex, previewState)
    const controller = new AbortController()
    const timer = window.setTimeout(() => api.preview(selected.id, templateIndex, previewState.side, previewState.noteIndex, controller.signal)
      .then(({ html }) => { if (!controller.signal.aborted) setPreviewDocument({ key: requestKey, html: `${html}<!-- anki-helper-preview:${++previewRevision.current} -->` }) })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '카드 미리보기를 불러오지 못했습니다.')
      }), 100)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [previewState, selected, templateIndex, workspace])

  const activePreviewKey = selected ? previewRequestKey(selected.id, templateIndex, previewState) : ''
  const activePreviewHtml = previewDocument?.key === activePreviewKey ? previewDocument.html : null

  const persist = useCallback(async (): Promise<boolean> => {
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
  }, [hydrate, notify, selected, workspace])

  const flushDesignDrafts = useCallback(async (): Promise<boolean> => {
    if (!workspace || !designDraftsArePending(designDrafts, workspace)) return true
    setBusy(true); setError('')
    try {
      let nextWorkspace = workspace
      for (const [key, draftValue] of Object.entries(designDrafts)) {
        const parsed = parseDesignDraftKey(key)
        if (!parsed) continue
        const noteType = nextWorkspace.note_types.find((item) => item.id === parsed.noteTypeId)
        if (!noteType) continue
        if (draftValue === designDraftSavedValue(noteType, parsed.index, parsed.mode)) continue
        nextWorkspace = parsed.mode === 'css'
          ? await api.updateCss(parsed.noteTypeId, draftValue)
          : await api.updateTemplate(parsed.noteTypeId, parsed.index, { [parsed.mode]: draftValue })
      }
      hydrate(nextWorkspace)
      setDesignDrafts({})
      setDirty(true)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '카드 디자인 초안을 적용하지 못했습니다.')
      return false
    } finally {
      setBusy(false)
    }
  }, [designDrafts, hydrate, workspace])

  const saveAll = useCallback(async () => {
    if (!(await flushDesignDrafts())) return
    await persist()
  }, [flushDesignDrafts, persist])

  useEffect(() => { const requestSave = () => { void saveAll() }; window.addEventListener('ankihelper:request-save', requestSave); return () => window.removeEventListener('ankihelper:request-save', requestSave) }, [saveAll])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && workspace && page !== 'design') { event.preventDefault(); void saveAll() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [page, saveAll, workspace])

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
    try { hydrate(await api.open(path)); setDesignDrafts({}); dispatchPreview({ type: 'reset' }); setDirty(false); setPage('overview') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'APKG를 열지 못했습니다.') }
    finally { setBusy(false) }
  }, [hydrate])

  const choosePackageNow = useCallback(async () => {
    const path = await open({ multiple: false, filters: [{ name: 'APKG 또는 편집 프로젝트', extensions: ['apkg', 'zip'] }] })
    if (typeof path !== 'string') return
    await openPackagePath(path)
  }, [openPackagePath])

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
    if (unsavedWork) { setPendingWork(work); return }
    if (work.kind === 'open-path' && work.path) void openPackagePath(work.path)
    else if (work.kind === 'open-picker') void choosePackageNow()
    else void beginTableImport(work.path)
  }, [beginTableImport, choosePackageNow, openPackagePath, unsavedWork])

  const choosePackage = useCallback(() => requestWork({ kind: 'open-picker' }), [requestWork])
  const requestTableImport = useCallback(() => requestWork({ kind: 'table-picker' }), [requestWork])
  const continuePendingWork = async (saveFirst: boolean) => {
    const work = pendingWork
    if (!work) return
    if (saveFirst) {
      if (!(await flushDesignDrafts())) return
      if (!(await persist())) return
    } else {
      setDesignDrafts({})
    }
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
          <div className="flex shrink-0 items-center gap-2">{workspace && <><button onClick={() => void saveAll()} disabled={busy || !unsavedWork} className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition lg:h-10 lg:px-4 ${unsavedWork ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'border border-slate-200 bg-white text-slate-400'}`}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{unsavedWork ? '저장' : '저장됨'}<span className="hidden text-[10px] opacity-65 lg:inline">Ctrl+S</span></button><div ref={newWorkMenuRef} className="relative"><button onClick={() => setNewWorkMenuOpen((open) => !open)} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#11182a] px-3 text-xs font-semibold text-white transition hover:bg-[#202b45] lg:h-10 lg:px-4"><Plus size={16} /><span>새 작업</span><ChevronDown size={14} className={`transition ${newWorkMenuOpen ? 'rotate-180' : ''}`} /></button>{newWorkMenuOpen && <div className="absolute right-0 top-[calc(100%+8px)] z-[75] w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl"><button onClick={() => { setNewWorkMenuOpen(false); requestTableImport() }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-indigo-50"><span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-100 text-indigo-600"><FileSpreadsheet size={17} /></span><span><b className="block text-sm text-slate-800">표 데이터에서 새 덱 만들기</b><small className="block pt-0.5 text-xs text-slate-500">Excel · CSV · TSV · TXT</small></span></button><button onClick={() => { setNewWorkMenuOpen(false); choosePackage() }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"><span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600"><FolderOpen size={17} /></span><span><b className="block text-sm text-slate-800">기존 파일 불러오기</b><small className="block pt-0.5 text-xs text-slate-500">APKG · 편집 프로젝트</small></span></button></div>}</div></>}</div>
        </header>
        <div className={`min-h-0 flex-1 px-3 ${page === 'preview' ? 'pb-0' : 'pb-4'} ${!workspace || page === 'design' || page === 'media' || page === 'preview' ? 'overflow-hidden' : 'overflow-y-auto'}`}>{!workspace ? <Welcome onOpen={choosePackage} busy={busy} dragActive={dragActive} /> : page === 'overview' ? <OverviewPage workspace={workspace} selected={selected} onPage={setPage} onSelect={(id) => { void selectNoteType(id) }} onDeleteNoteType={(id) => mutate(() => api.deleteNoteType(id), '빈 노트 유형을 제거했습니다. 저장하면 APKG에 반영됩니다.')} onMoveNotes={async (fromId, toId, mapping) => { try { const result = await api.moveNotes(fromId, toId, mapping); hydrate(result.workspace); setDirty(true); notify(`${result.moved.toLocaleString()}개 카드를 옮겼습니다.`); } catch (caught) { setError(caught instanceof Error ? caught.message : '카드를 옮기지 못했습니다.'); throw caught } }} /> : page === 'data' ? <DataPage noteType={selected} onUpdate={updateCell} /> : page === 'fields' ? <FieldsPage noteType={selected} onRename={async (order, name) => { await mutate(() => api.updateField(selected!.id, order, name)) }} onAdd={async (name) => { await mutate(() => api.addField(selected!.id, name)) }} onDelete={async (order) => { await mutate(() => api.deleteField(selected!.id, order)) }} onReorder={async (order, newOrder) => { await mutate(() => api.reorderField(selected!.id, order, newOrder)) }} onMove={async (order, destination, mode) => { const result = await api.moveFieldContents(selected!.id, order, destination, mode); hydrate(result.workspace); setDirty(true); notify(`${result.changed.toLocaleString()}개 노트에서 내용을 이동했습니다.`); return result.changed }} onClone={async (name) => { await mutate(async () => { const next = await api.cloneNoteType(selected!.id, name, true); setPage('overview'); return next }, '카드를 새 노트 유형으로 옮겼습니다. 저장하면 APKG에 반영됩니다.') }} /> : page === 'media' ? <MediaPage onExport={() => exportFile('media')} /> : page === 'design' ? <DesignPage noteType={selected} index={templateIndex} setIndex={setTemplateIndex} drafts={designDrafts} setDrafts={setDesignDrafts} onSave={async (mode, value) => { await mutate(() => mode === 'css' ? api.updateCss(selected!.id, value) : api.updateTemplate(selected!.id, templateIndex, { [mode]: value }), '카드 디자인을 적용했습니다.') }} notify={notify} /> : <PreviewPage noteType={selected} templateIndex={templateIndex} previewState={previewState} previewKey={activePreviewKey} previewHtml={activePreviewHtml} onSide={(side) => dispatchPreview({ type: 'select-side', side })} onNavigate={(delta) => dispatchPreview({ type: 'navigate', delta, total: selected?.notes.length ?? 0 })} />}</div>
      </section>
    </div>
    {toast && <div className={`fixed bottom-7 left-1/2 z-[70] -translate-x-1/2 rounded-xl bg-[#0b1426] px-5 py-3 text-sm font-semibold text-white shadow-2xl ring-1 ring-white/10 transition-opacity duration-300 ${toastVisible ? 'opacity-100' : 'opacity-0'}`}><span className="mr-2 text-emerald-400">✓</span>{toast}</div>}
    {error && <Modal title="작업을 완료하지 못했습니다" description={error} tone="danger" confirmLabel="확인" onConfirm={() => setError('')} />}
    {pendingWork && <UnsavedWorkModal onCancel={() => setPendingWork(null)} onSave={() => void continuePendingWork(true)} onDiscard={() => void continuePendingWork(false)} />}
    {tableImport && <SpreadsheetImportWizard initial={tableImport.preview} onCancel={() => setTableImport(null)} onSheetChange={(sheet) => api.inspectTable(tableImport.path, sheet)} onCreate={async (payload) => { setBusy(true); setError(''); try { hydrate(await api.createFromTable({ path: tableImport.path, ...payload })); setDirty(true); setPage('overview'); setTableImport(null); notify('새 덱 초안을 만들었습니다. 저장 위치를 선택해 주세요.'); } catch (caught) { setError(caught instanceof Error ? caught.message : '새 덱을 만들지 못했습니다.'); } finally { setBusy(false); } }} />}
    {availableUpdate && !error && !pendingWork && !tableImport && !exitPrompt && <UpdateAvailableModal update={availableUpdate} onDismiss={() => setAvailableUpdate(null)} onOpen={async () => { setAvailableUpdate(null); try { await openUrl(availableUpdate.url) } catch { setError('업데이트 페이지를 열지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.') } }} />}
    {exitPrompt && <ExitConfirmModal dirty={unsavedWork} onCancel={() => setExitPrompt(false)} onConfirm={() => void confirmExit()} />}
  </main>
}

export default App
