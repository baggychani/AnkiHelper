import { useCallback, useEffect, useRef, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import {
  Copy, Download, File, Image, Link2, Music2, Palette, Pencil, Play, Plus, ScanSearch, Trash2, Type,
} from 'lucide-react'
import { api, type MediaHealth, type MediaItem, type MediaReference } from '../api'

const mediaTypeLabels: Record<MediaItem['type'], string> = {
  audio: '음성',
  image: '이미지',
  video: '영상',
  font: '폰트',
  other: '기타',
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function MediaPage({ onExport, onExportSelected, notify }: {
  onExport: (mediaType?: MediaItem['type']) => void
  onExportSelected: (storedNames: string[]) => void
  notify: (message: string) => void
}) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | MediaItem['type']>('all')
  const [playing, setPlaying] = useState('')
  const [health, setHealth] = useState<MediaHealth | null>(null)
  const [video, setVideo] = useState<MediaItem | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [highlighted, setHighlighted] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [hoverPreview, setHoverPreview] = useState<MediaItem | null>(null)
  const [usage, setUsage] = useState<{ item: MediaItem; references: MediaReference[] } | null>(null)
  const [usageBusy, setUsageBusy] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const playbackRequestRef = useRef(0)
  const renameSkipBlur = useRef(false)
  const highlightTimers = useRef<number[]>([])
  const focusGeneration = useRef(0)
  const scrollEndCleanup = useRef<(() => void) | null>(null)

  const clearHighlightTimers = useCallback(() => {
    highlightTimers.current.forEach((timer) => window.clearTimeout(timer))
    highlightTimers.current = []
    scrollEndCleanup.current?.()
    scrollEndCleanup.current = null
  }, [])

  const focusMediaRow = useCallback((storedName: string) => {
    clearHighlightTimers()
    const generation = ++focusGeneration.current
    setFilter('all')
    setQuery('')
    const start = window.setTimeout(() => {
      if (focusGeneration.current !== generation) return
      const row = document.getElementById(`media-${storedName}`)
      if (!row) return
      let finished = false
      const finishHighlight = () => {
        if (finished || focusGeneration.current !== generation) return
        finished = true
        scrollEndCleanup.current?.()
        scrollEndCleanup.current = null
        const delay = window.setTimeout(() => {
          if (focusGeneration.current !== generation) return
          setHighlighted(storedName)
          const clear = window.setTimeout(() => setHighlighted((current) => current === storedName ? '' : current), 1400)
          highlightTimers.current.push(clear)
        }, 100)
        highlightTimers.current.push(delay)
      }
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const scroller = row.closest('.overflow-y-auto')
      if (scroller && 'onscrollend' in window) {
        const onScrollEnd = () => finishHighlight()
        scroller.addEventListener('scrollend', onScrollEnd)
        scrollEndCleanup.current = () => scroller.removeEventListener('scrollend', onScrollEnd)
        const fallback = window.setTimeout(finishHighlight, 450)
        highlightTimers.current.push(fallback)
      } else {
        const fallback = window.setTimeout(finishHighlight, 350)
        highlightTimers.current.push(fallback)
      }
    }, 80)
    highlightTimers.current.push(start)
  }, [clearHighlightTimers])

  const disposeAudio = useCallback(() => {
    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }, [])

  const load = useCallback(async () => {
    const loaded = await api.media()
    setItems(loaded)
    const focus = sessionStorage.getItem('ankihelper:media-focus')
    if (!focus) return
    const found = loaded.find((item) => item.name === focus)
    sessionStorage.removeItem('ankihelper:media-focus')
    if (found) focusMediaRow(found.stored_name)
  }, [focusMediaRow])
  useEffect(() => { void load().catch(() => setItems([])) }, [load])
  useEffect(() => () => {
    playbackRequestRef.current += 1
    disposeAudio()
    clearHighlightTimers()
  }, [clearHighlightTimers, disposeAudio])

  const inspect = async () => {
    setError('')
    try { setHealth(await api.mediaHealth()) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '미디어 검사를 완료하지 못했습니다.') }
  }
  const addFiles = async (templateAsset: boolean) => {
    const selected = await open({ multiple: true })
    const paths = selected === null ? [] : Array.isArray(selected) ? selected : [selected]
    if (!paths.length) return
    setError('')
    try {
      const result = await api.importMedia(paths, templateAsset)
      setItems((current) => [...current, ...result.items].sort((left, right) => left.name.localeCompare(right.name)))
      setHealth(null)
      window.dispatchEvent(new CustomEvent('ankihelper:media-changed', { detail: { workspace: result.workspace } }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : '미디어를 추가하지 못했습니다.') }
  }
  const beginRename = (item: MediaItem) => {
    renameSkipBlur.current = false
    setEditing(item.stored_name)
    setRenameDraft(item.name)
    setError('')
  }
  const commitRename = async (item: MediaItem) => {
    if (renaming) return
    const next = renameDraft.trim()
    if (!next || next === item.name) { setEditing(''); return }
    setRenaming(true)
    setError('')
    try {
      const result = await api.renameMedia(item.stored_name, next)
      setItems((current) => current.map((entry) => entry.stored_name === item.stored_name ? result.item : entry).sort((left, right) => left.name.localeCompare(right.name)))
      setHealth(null)
      setEditing('')
      window.dispatchEvent(new CustomEvent('ankihelper:media-changed', {
        detail: { workspace: result.workspace, rename: { old: result.old_name, new: result.new_name } },
      }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : '파일명을 바꾸지 못했습니다.') }
    finally { setRenaming(false) }
  }
  const play = async (item: MediaItem) => {
    if (playing === item.stored_name) {
      playbackRequestRef.current += 1
      disposeAudio()
      setPlaying('')
      return
    }
    const requestId = playbackRequestRef.current + 1
    playbackRequestRef.current = requestId
    disposeAudio()
    setError('')
    setPlaying(item.stored_name)
    try {
      const response = await fetch(api.mediaUrl(item.stored_name), { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = await response.arrayBuffer()
      if (playbackRequestRef.current !== requestId) return
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: response.headers.get('content-type') ?? 'application/octet-stream' }))
      const audio = new Audio(objectUrl)
      audio.preload = 'auto'
      audioUrlRef.current = objectUrl
      audioRef.current = audio
      audio.onended = () => {
        if (playbackRequestRef.current !== requestId) return
        disposeAudio()
        setPlaying('')
      }
      audio.onerror = () => {
        if (playbackRequestRef.current !== requestId) return
        disposeAudio()
        setPlaying('')
        setError('이 음성 파일을 현재 재생 환경에서 해석하지 못했습니다.')
      }
      await audio.play()
    } catch {
      if (playbackRequestRef.current !== requestId) return
      disposeAudio()
      setPlaying('')
      setError('음성 파일을 온전히 불러오거나 재생하지 못했습니다.')
    }
  }
  const showUsage = async (item: MediaItem) => {
    setError('')
    setUsageBusy(true)
    try {
      const report = health ?? await api.mediaHealth()
      setUsage({ item, references: report.references[item.name] ?? [] })
    } catch (caught) { setError(caught instanceof Error ? caught.message : '사용처를 확인하지 못했습니다.') }
    finally { setUsageBusy(false) }
  }
  const remove = async (item: MediaItem) => {
    setError('')
    try {
      const report = health ?? await api.mediaHealth()
      const references = report.references[item.name] ?? []
      const summary = references.length ? `\n\n현재 참조 ${references.length}곳:\n${references.slice(0, 3).map((reference) => `• ${reference.location}`).join('\n')}\n\n강제로 삭제하면 카드·디자인이 깨질 수 있습니다.` : ''
      if (!window.confirm(`‘${item.name}’을(를) 제거할까요? 저장하면 APKG에서도 삭제됩니다.${summary}`)) return
      const result = await api.deleteMedia(item.stored_name, references.length > 0)
      playbackRequestRef.current += 1; disposeAudio(); setPlaying('')
      setItems((current) => current.filter((entry) => entry.stored_name !== item.stored_name))
      setHealth(null)
      window.dispatchEvent(new CustomEvent('ankihelper:media-changed', { detail: { workspace: result.workspace } }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : '미디어를 제거하지 못했습니다.') }
  }
  const downloadOne = async (item: MediaItem) => {
    const destination = await save({ defaultPath: item.name, filters: [{ name: '미디어 파일', extensions: [item.name.split('.').pop() || '*'] }] })
    if (!destination) return
    const response = await fetch(api.mediaUrl(item.stored_name))
    await writeFile(destination, new Uint8Array(await response.arrayBuffer()))
  }
  const copyReference = async (item: MediaItem) => {
    const family = item.name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_')
    const reference = item.type === 'image' ? `<img src="${item.name}" alt="">`
      : item.type === 'audio' || item.type === 'video' ? `[sound:${item.name}]`
        : item.type === 'font' ? `@font-face {\n  font-family: "${family}";\n  src: url("${item.name}");\n}`
          : item.name
    try {
      await navigator.clipboard.writeText(reference)
      notify(`${copyLabel(item)}했습니다.`)
    } catch {
      setError('클립보드에 복사하지 못했습니다. 앱 권한을 확인해 주세요.')
    }
  }
  const toggleChecked = (storedName: string) => {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(storedName)) next.delete(storedName)
      else next.add(storedName)
      return next
    })
  }
  const toggleCheckedAll = (names: string[], allChecked: boolean) => {
    setChecked((current) => {
      const next = new Set(current)
      names.forEach((name) => allChecked ? next.delete(name) : next.add(name))
      return next
    })
  }
  const removeSelected = async () => {
    if (bulkBusy || checked.size === 0) return
    const targets = items.filter((item) => checked.has(item.stored_name))
    if (!targets.length) return
    setError('')
    try {
      const report = health ?? await api.mediaHealth()
      const referenced = targets.filter((item) => (report.references[item.name] ?? []).length > 0)
      const summary = referenced.length
        ? `\n\n이 중 ${referenced.length}개는 카드·디자인에서 참조 중입니다. 강제로 삭제하면 카드·디자인이 깨질 수 있습니다.`
        : ''
      if (!window.confirm(`선택한 ${targets.length}개 파일을 제거할까요? 저장하면 APKG에서도 삭제됩니다.${summary}`)) return
      setBulkBusy(true)
      const result = await api.deleteMediaFiles(targets.map((item) => item.stored_name), referenced.length > 0)
      playbackRequestRef.current += 1; disposeAudio(); setPlaying('')
      setItems((current) => current.filter((entry) => !checked.has(entry.stored_name)))
      setChecked(new Set())
      setHealth(null)
      window.dispatchEvent(new CustomEvent('ankihelper:media-changed', { detail: { workspace: result.workspace } }))
      notify(`${targets.length}개 파일을 제거했습니다.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '미디어를 제거하지 못했습니다.') }
    finally { setBulkBusy(false) }
  }
  const exportSelected = () => {
    if (checked.size === 0) return
    onExportSelected([...checked])
  }
  const visible = items.filter((item) =>
    (filter === 'all' || item.type === filter)
    && item.name.toLowerCase().includes(query.toLowerCase()),
  )
  const count = (type: MediaItem['type']) => items.filter((item) => item.type === type).length
  const exportLabel = filter === 'all' ? '전체 추출' : `${mediaTypeLabels[filter]} 추출`
  const chooseFilter = (next: 'all' | MediaItem['type']) => {
    if (next !== 'all' && items.find((item) => item.stored_name === playing)?.type !== next) {
      playbackRequestRef.current += 1
      disposeAudio()
      setPlaying('')
    }
    setFilter(next)
  }
  const icon = (item: MediaItem) => item.type === 'image'
    ? <img src={api.mediaUrl(item.stored_name)} alt="" onMouseEnter={() => setHoverPreview(item)} onMouseLeave={() => setHoverPreview((current) => current?.stored_name === item.stored_name ? null : current)} className="h-10 w-10 cursor-zoom-in rounded-lg bg-slate-100 object-cover" />
    : <span className="grid h-10 w-10 place-items-center rounded-lg bg-violet-100 text-violet-600">{item.type === 'font' ? <Type size={17} /> : item.type === 'video' ? <Play size={17} /> : <Music2 size={17} />}</span>
  const copyLabel = (item: MediaItem) => item.type === 'font' ? 'CSS 복사' : item.type === 'other' ? '이름 복사' : '태그 복사'
  const allVisibleChecked = visible.length > 0 && visible.every((item) => checked.has(item.stored_name))

  return <><div className="mx-auto flex h-full min-h-0 max-w-[1420px] flex-col gap-4">
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200/70 bg-white px-5 py-3 text-xs shadow-card">
      <button type="button" aria-pressed={filter === 'all'} onClick={() => chooseFilter('all')} className={`text-sm font-bold transition hover:text-indigo-600 ${filter === 'all' ? 'text-slate-800' : 'text-slate-700'}`}>미디어 {items.length.toLocaleString()}개</button>
      <button type="button" aria-pressed={filter === 'audio'} onClick={() => chooseFilter('audio')} className={`inline-flex items-center gap-1.5 transition hover:text-violet-700 ${filter === 'audio' ? 'font-semibold text-violet-700' : 'text-slate-500'}`}><Music2 size={14} className="text-violet-500" />음성 {count('audio').toLocaleString()}</button>
      <button type="button" aria-pressed={filter === 'image'} onClick={() => chooseFilter('image')} className={`inline-flex items-center gap-1.5 transition hover:text-cyan-700 ${filter === 'image' ? 'font-semibold text-cyan-700' : 'text-slate-500'}`}><Image size={14} className="text-cyan-500" />이미지 {count('image').toLocaleString()}</button>
      <button type="button" aria-pressed={filter === 'video'} onClick={() => chooseFilter('video')} className={`inline-flex items-center gap-1.5 transition hover:text-rose-700 ${filter === 'video' ? 'font-semibold text-rose-700' : 'text-slate-500'}`}><Play size={14} className="text-rose-500" />영상 {count('video').toLocaleString()}</button>
      <button type="button" aria-pressed={filter === 'font'} onClick={() => chooseFilter('font')} className={`inline-flex items-center gap-1.5 transition hover:text-amber-700 ${filter === 'font' ? 'font-semibold text-amber-700' : 'text-slate-500'}`}><Type size={14} className="text-amber-600" />폰트 {count('font').toLocaleString()}</button>
      <button type="button" aria-pressed={filter === 'other'} onClick={() => chooseFilter('other')} className={`inline-flex items-center gap-1.5 transition hover:text-slate-800 ${filter === 'other' ? 'font-semibold text-slate-800' : 'text-slate-500'}`}><File size={14} className="text-slate-500" />기타 {count('other').toLocaleString()}</button>
    </div>
    <section className="flex min-h-0 flex-1 flex-col rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[22px] lg:p-5">
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold">미디어 관리</h3><p className="mt-1 text-xs text-slate-400">Anki는 템플릿 폰트·디자인 파일을 <code>_이름</code>으로 넣고 CSS/HTML도 그 이름을 그대로 씁니다. 디자인용 추가와 폰트는 앞에 <code>_</code>를 붙이되, 이미 CSS·템플릿이 쓰고 있는 이름은 그대로 둡니다. CSS 복사 버튼이 그 이름을 넣습니다.</p></div>
        <div className="flex flex-wrap gap-2"><button onClick={() => void addFiles(false)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Plus size={15} />파일 추가</button><button onClick={() => void addFiles(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Palette size={15} />디자인용 추가</button></div>
      </div>
      <div className="mb-3 flex shrink-0 gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="파일명 검색" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none" /><button onClick={() => void inspect()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ScanSearch size={15} />미디어 검사</button><button onClick={() => onExport(filter === 'all' ? undefined : filter)} className="inline-flex items-center gap-2 rounded-xl bg-[#151d31] px-4 text-sm font-semibold text-white"><Download size={15} />{exportLabel}</button></div>
      {error && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}
      {visible.length > 0 && <div className="mb-2 flex shrink-0 flex-wrap items-center gap-3 px-1 text-xs text-slate-500">
        <label className="inline-flex items-center gap-2 font-medium"><input type="checkbox" checked={allVisibleChecked} onChange={() => toggleCheckedAll(visible.map((item) => item.stored_name), allVisibleChecked)} className="h-4 w-4 rounded border-slate-300" />전체 선택</label>
        {checked.size > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">{checked.size}개 선택됨</span>}
        {checked.size > 0 && <div className="ml-auto flex gap-2">
          <button disabled={bulkBusy} onClick={exportSelected} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download size={13} />선택 항목 추출</button>
          <button disabled={bulkBusy} onClick={() => void removeSelected()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={13} />선택 항목 삭제</button>
        </div>}
      </div>}
      {health && <div className="mb-3 shrink-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><div className="flex items-center justify-between gap-3"><b>미디어 검사 결과</b><button onClick={() => setHealth(null)} className="font-semibold text-amber-700">닫기</button></div><div className="mt-2 space-y-1 leading-5">{health.missing.length > 0 && <p>누락된 참조 {health.missing.length}개: {health.missing.slice(0, 3).map((item) => `${item.filename} (${item.location})`).join(', ')}</p>}{health.mapped_missing.length > 0 && <p>APKG 미디어 맵에만 남은 파일 {health.mapped_missing.length}개</p>}{health.unused.length > 0 && <p>노트·디자인에서 쓰이지 않는 일반 파일 {health.unused.length}개</p>}{health.static_unreferenced.length > 0 && <p>참조되지 않는 디자인용 _ 파일 {health.static_unreferenced.length}개</p>}{health.case_collisions.length > 0 && <p>대소문자 충돌 {health.case_collisions.length}개</p>}{health.unindexed_entries.length > 0 && <p>미디어 맵에 없는 APKG 항목 {health.unindexed_entries.length}개</p>}{health.missing.length + health.mapped_missing.length + health.unused.length + health.static_unreferenced.length + health.case_collisions.length + health.unindexed_entries.length === 0 && <p>누락·중복·미사용 참조를 찾지 못했습니다.</p>}</div></div>}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200">{visible.length === 0 ? <div className="grid h-full min-h-40 place-items-center px-4 text-center text-sm text-slate-400">추가한 이미지, 음성, 영상, 폰트 파일이 여기에 표시됩니다.</div> : visible.map((item) => <div id={`media-${item.stored_name}`} key={item.stored_name} className={`flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 transition-[background-color,box-shadow] duration-500 ${highlighted === item.stored_name ? 'bg-violet-100/90 shadow-[inset_0_0_0_2px_rgba(139,92,246,0.45)]' : ''}`}><input type="checkbox" checked={checked.has(item.stored_name)} onChange={() => toggleChecked(item.stored_name)} className="h-4 w-4 shrink-0 rounded border-slate-300" />{icon(item)}{editing === item.stored_name ? <input autoFocus value={renameDraft} disabled={renaming} onChange={(event) => setRenameDraft(event.target.value)} onBlur={() => { if (renameSkipBlur.current) { renameSkipBlur.current = false; return } void commitRename(item) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } else if (event.key === 'Escape') { event.preventDefault(); renameSkipBlur.current = true; setEditing(''); setRenameDraft(item.name) } }} className="min-w-0 flex-1 rounded-lg border border-indigo-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 outline-none ring-2 ring-indigo-100" /> : <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.name}>{item.name}<small className="ml-2 text-xs font-normal text-slate-400">{formatSize(item.size)}</small></span>}{item.type === 'audio' && <button onClick={() => play(item)} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${playing === item.stored_name ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700'}`}>{playing === item.stored_name ? '■ 정지' : '▶ 듣기'}</button>}{item.type === 'video' && <button onClick={() => setVideo(item)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-rose-50 px-3 text-xs font-semibold text-rose-700"><Play size={14} />미리보기</button>}<button title="사용처 보기" disabled={usageBusy} onClick={() => void showUsage(item)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"><Link2 size={15} /></button><button title={copyLabel(item)} onClick={() => void copyReference(item)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-700"><Copy size={15} /></button><button title="파일명 수정" onClick={() => beginRename(item)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-700"><Pencil size={15} /></button><button title="저장" onClick={() => void downloadOne(item)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-700"><Download size={15} /></button><button onClick={() => void remove(item)} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 size={14} />삭제</button></div>)}</div>
    </section>
    {video && <div className="fixed inset-0 z-[220] grid place-items-center bg-slate-950/60 p-4" onClick={() => setVideo(null)}><div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex items-center justify-between gap-3"><b className="truncate">{video.name}</b><button onClick={() => setVideo(null)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">닫기</button></div><video src={api.mediaUrl(video.stored_name)} controls autoPlay className="max-h-[70vh] w-full rounded-xl bg-slate-950" /></div></div>}
    {usage && (() => {
      const cardSides = new Map<string, { front: boolean; back: boolean }>()
      const otherRefs: MediaReference[] = []
      for (const reference of usage.references) {
        if (reference.card && reference.side) {
          const entry = cardSides.get(reference.card) ?? { front: false, back: false }
          entry[reference.side] = true
          cardSides.set(reference.card, entry)
        } else {
          otherRefs.push(reference)
        }
      }
      const sidePill = (label: string, lit: boolean) => <span className={`inline-flex h-6 items-center rounded-md px-2 text-[11px] font-bold ${lit ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{label}</span>
      return <div className="fixed inset-0 z-[220] grid place-items-center bg-slate-950/60 p-4" onClick={() => setUsage(null)}><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between gap-3"><b className="truncate">{usage.item.name} 사용처</b><button onClick={() => setUsage(null)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">닫기</button></div>
        <p className="mb-3 text-xs text-slate-400">{usage.references.length}곳에서 참조 중</p>
        {usage.references.length === 0
          ? <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">이 파일을 사용하는 카드·디자인이 없습니다.</p>
          : <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {[...cardSides.entries()].map(([card, sides]) => <li key={card} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"><span className="min-w-0 truncate">{card}</span><span className="flex shrink-0 gap-1">{sidePill('앞면', sides.front)}{sidePill('뒷면', sides.back)}</span></li>)}
            {otherRefs.map((reference, index) => <li key={index} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">{reference.location}</li>)}
          </ul>}
      </div></div>
    })()}
  </div>
  {hoverPreview && <div className="pointer-events-none fixed bottom-6 right-6 z-[200] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl"><img src={api.mediaUrl(hoverPreview.stored_name)} alt="" className="max-h-64 max-w-64 rounded-lg object-contain" /><p className="mt-2 max-w-64 truncate text-xs font-medium text-slate-600">{hoverPreview.name}</p></div>}
  </>
}
