import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowRightLeft, BookOpen, Braces, ListChecks, Music2, Table2, Trash2 } from 'lucide-react'
import type { Field, NoteType, Workspace } from '../api'
import { Card } from '../components/Card'
import { Modal } from '../components/Modal'

type Page = 'overview' | 'data' | 'fields' | 'media' | 'design' | 'preview'

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

export function OverviewPage({ workspace, selected, onPage, onSelect, onDeleteNoteType, onMoveNotes }: {
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
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4"><Stat label="카드" value={selected?.notes.length ?? 0} icon={BookOpen} linkLabel="카드 관리" onNavigate={() => onPage('data')} /><FieldSummary fields={selected?.fields ?? []} /><Stat label="미디어" value={workspace.media_count} icon={Music2} linkLabel="미디어 관리" onNavigate={() => onPage('media')} /></section>
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
function Stat({ label, value, icon: Icon, linkLabel, onNavigate }: { label: string; value: number; icon: typeof BookOpen; linkLabel: string; onNavigate: () => void }) { return <div className="flex h-full flex-col rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[20px] lg:p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold lg:text-3xl">{value.toLocaleString()}</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-600"><Icon size={19} /></span></div><button onClick={onNavigate} className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold text-indigo-600">{linkLabel}<ArrowRight size={13} /></button></div> }
function FieldSummary({ fields }: { fields: Field[] }) { const shown = fields.slice(0, 4); return <div className="flex h-full flex-col rounded-[20px] border border-slate-200/70 bg-white p-5 shadow-card"><p className="text-xs font-semibold text-slate-400">필드 목록</p><div className="mt-3 flex flex-wrap gap-1.5">{shown.map((field) => <span key={field.order} title={field.name} className="max-w-[120px] truncate rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">{field.name}</span>)}{fields.length > shown.length && <span className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-600">외 {fields.length - shown.length}개</span>}</div><button onClick={() => window.dispatchEvent(new CustomEvent('ankihelper:navigate', { detail: 'fields' }))} className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold text-indigo-600">필드 관리에서 전체 보기<ArrowRight size={13} /></button></div> }
function Quick({ label, icon: Icon, onClick }: { label: string; icon: typeof Table2; onClick: () => void }) { const descriptions: Record<string, string> = { '카드 데이터': '불러온 필드와 노트를 확인합니다', '필드 관리': '필드 이름과 구성을 편집합니다', '미디어 관리': '음성과 이미지를 확인하고 저장합니다', '카드 디자인': 'HTML과 CSS 템플릿을 편집합니다' }; return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-3 text-left hover:bg-indigo-50"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-slate-600 shadow-sm"><Icon size={17} /></span><span><b className="block text-sm text-slate-700">{label}</b><small className="mt-0.5 block text-xs text-slate-400">{descriptions[label]}</small></span><ArrowRight className="ml-auto text-slate-300" size={15} /></button> }

