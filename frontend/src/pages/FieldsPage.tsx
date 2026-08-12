import { useEffect, useState } from 'react'
import { ArrowRight, ArrowRightLeft, ChevronDown, ChevronUp, Music2, Plus, Trash2, Type } from 'lucide-react'
import { api, type Field, type NoteType } from '../api'
import { Card } from '../components/Card'
import { Modal } from '../components/Modal'

export function FieldsPage({ noteType, onRename, onAdd, onDelete, onReorder, onMove, onClone }: {
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

