import { useEffect, useState } from 'react'
import { api, type MediaItem } from '../api'
import type { EditorMode } from '../designDrafts'
import { mediaSnippet } from '../editorHelpers'
import { Dialog } from './Dialog'

const labels = { image: '이미지', audio: '음성', video: '영상', font: '폰트', other: '기타' }

export function MediaInsertDialog({ mode, onInsert, onClose }: {
  mode: EditorMode
  onInsert: (snippet: string) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError(false)
    api.media().then((result) => { if (active) setItems(result) })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt])
  const available = items.filter((item) => mode === 'css' ? item.type === 'image' || item.type === 'font' : item.type !== 'other')
  const visible = available.filter((item) => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const item = visible.find((entry) => entry.stored_name === selected)
  return <Dialog label="미디어 삽입" onDismiss={onClose} dismissOnBackdrop>
    <section className="flex max-h-[85vh] w-full max-w-xl flex-col gap-4 rounded-2xl bg-white p-6 shadow-2xl">
      <div><h2 className="text-lg font-semibold">미디어 삽입</h2><p className="mt-1 text-sm text-slate-500">{mode === 'css' ? '이미지 배경 선언이나 폰트 CSS를 커서 위치에 넣습니다.' : '선택한 파일의 태그를 커서 위치에 넣습니다.'} 선택한 코드는 삽입 내용으로 바뀝니다.</p></div>
      <input autoFocus aria-label="미디어 파일 검색" placeholder="파일명으로 검색" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null) }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-indigo-500" />
      {loading ? <p role="status" className="py-6 text-center text-sm text-slate-500">미디어를 불러오는 중…</p>
        : error ? <div role="alert" className="text-sm text-rose-600">미디어 목록을 불러오지 못했습니다. <button onClick={() => setAttempt((value) => value + 1)} className="underline">다시 시도</button></div>
          : <div className="min-h-0 max-h-64 shrink overflow-y-auto rounded-lg border border-slate-200">
            {visible.length ? visible.map((entry) => <button key={entry.stored_name} type="button" aria-label={`${labels[entry.type]} ${entry.name}`} aria-pressed={selected === entry.stored_name} onClick={() => setSelected(entry.stored_name)} className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left text-sm last:border-0 ${selected === entry.stored_name ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}><span className="shrink-0 text-xs text-slate-500">{labels[entry.type]}</span><span className="min-w-0 break-all">{entry.name}</span></button>)
              : <p className="p-6 text-center text-sm text-slate-500">{query ? '검색 결과가 없습니다.' : '삽입할 파일이 없습니다. 미디어 관리에서 파일을 추가하세요.'}</p>}
          </div>}
      {item && !loading && !error && <pre aria-label="삽입할 코드" className="max-h-40 shrink overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{mediaSnippet(item, mode)}</pre>}
      <div className="flex shrink-0 justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">취소</button><button disabled={!item || loading || error} onClick={() => { if (item) onInsert(mediaSnippet(item, mode)) }} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">삽입</button></div>
    </section>
  </Dialog>
}
