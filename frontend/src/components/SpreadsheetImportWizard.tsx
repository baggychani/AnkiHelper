import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowRightLeft, FileSpreadsheet, Sparkles, X } from 'lucide-react'
import { api, type SourceNoteType, type TablePreview } from '../api'

export function SpreadsheetImportWizard({ initial, onCancel, onSheetChange, onCreate }: {
  initial: TablePreview
  onCancel: () => void
  onSheetChange: (sheet: string) => Promise<TablePreview>
  onCreate: (payload: { sheetName?: string; firstRowIsHeader: boolean; fieldNames: string[]; deckName: string; noteTypeName: string; frontField: number; backField: number; templateSourcePath?: string; templateNoteTypeId?: string; fieldMapping?: Record<number, number>; includedColumns?: number[] }) => Promise<void>
}) {
  const [preview, setPreview] = useState(initial)
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(false)
  const [fieldNames, setFieldNames] = useState(() => initial.sample_rows[0]?.map((_, index) => `필드 ${index + 1}`) ?? [])
  const [columnIncluded, setColumnIncluded] = useState(() => Array.from({ length: initial.column_count }, () => true))
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
  const includedColumnList = columns.filter((column) => columnIncluded[column])
  const invalidNames = templateType
    ? false
    : includedColumnList.length === 0
      || includedColumnList.some((column) => !(fieldNames[column] ?? '').trim())
      || new Set(includedColumnList.map((column) => (fieldNames[column] ?? '').trim().toLowerCase())).size !== includedColumnList.length
  const toggleColumn = (column: number) => setColumnIncluded((current) => current.map((included, index) => index === column ? !included : included))
  const submit = () => {
    if (templateType) {
      void onCreate({ sheetName: preview.selected_sheet, firstRowIsHeader, fieldNames, deckName, noteTypeName, frontField, backField, templateSourcePath, templateNoteTypeId: templateType.id, fieldMapping: templateMapping })
      return
    }
    const kept = includedColumnList
    const remap = (column: number) => { const position = kept.indexOf(column); return position === -1 ? 0 : position }
    void onCreate({
      sheetName: preview.selected_sheet,
      firstRowIsHeader,
      fieldNames: kept.map((column) => fieldNames[column]),
      deckName,
      noteTypeName,
      frontField: remap(frontField),
      backField: remap(backField),
      includedColumns: kept,
    })
  }
  const changeSheet = async (sheet: string) => {
    if (sheet === preview.selected_sheet) return
    setSwitchingSheet(true)
    try {
      const next = await onSheetChange(sheet)
      setPreview(next)
      setFirstRowIsHeader(false)
      setFieldNames(Array.from({ length: next.column_count }, (_, index) => `필드 ${index + 1}`))
      setColumnIncluded(Array.from({ length: next.column_count }, () => true))
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
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,.7fr)] lg:grid-rows-[minmax(0,1fr)]">
        <section className="min-w-0 overflow-hidden border-b border-slate-200/80 p-5 lg:border-b-0 lg:border-r lg:p-7">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3"><div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-6 gap-y-3"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">원본 데이터</p><p title={preview.source_name} className="mt-0.5 max-w-[360px] truncate text-xs text-slate-500">{preview.source_name} · {preview.row_count.toLocaleString()}행 · {preview.column_count}열</p></div>{templateType && <div className="min-w-[235px] border-l border-slate-200 pl-5"><p className="text-sm font-semibold text-slate-800">불러온 노트 유형</p><p className="mt-0.5 text-xs text-slate-500">{templateType.name} · {templateType.fields.length}개 필드 · 카드 {templateType.template_count}개</p>{templateTypes.length > 1 && <select value={templateTypeId} onChange={(event) => { const next = templateTypes.find((item) => item.id === event.target.value); setTemplateTypeId(event.target.value); if (next) autoMap(next) }} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-indigo-400">{templateTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</div>}</div>{preview.sheet_names.length > 1 && <label className="shrink-0 text-xs font-semibold text-slate-500">시트 <select value={preview.selected_sheet} disabled={switchingSheet} onChange={(event) => void changeSheet(event.target.value)} className="ml-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-700 outline-none focus:border-indigo-400">{preview.sheet_names.map((sheet) => <option key={sheet}>{sheet}</option>)}</select></label>}</div>
          <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm text-slate-700 transition hover:border-indigo-200"><input type="checkbox" checked={firstRowIsHeader} onChange={(event) => setHeaderMode(event.target.checked)} className="h-4 w-4 accent-indigo-600" /><span><b className="font-semibold">첫 행을 필드명 후보로 사용</b><span className="ml-1.5 text-slate-500">아래에서 언제든 직접 수정할 수 있습니다.</span></span></label>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="min-w-full border-collapse text-left text-xs"><thead className="bg-slate-50 text-slate-400"><tr>{columns.map((index) => <th key={index} className={`min-w-[120px] border-b border-slate-200 px-3 py-2.5 font-semibold transition ${!templateType && !columnIncluded[index] ? 'text-slate-300 line-through decoration-slate-300' : ''}`}>열 {String.fromCharCode(65 + index)}</th>)}</tr></thead><tbody>{shownRows.length ? shownRows.slice(0, 10).map((row, rowIndex) => <tr key={rowIndex} className="border-b border-slate-100 last:border-0">{columns.map((column) => <td key={column} className={`max-w-[210px] truncate px-3 py-2.5 transition ${!templateType && !columnIncluded[column] ? 'text-slate-300' : 'text-slate-600'}`} title={row[column] ?? ''}>{row[column] || <span className="text-slate-300">—</span>}</td>)}</tr>) : <tr><td colSpan={Math.max(columns.length, 1)} className="px-4 py-8 text-center text-slate-400">표시할 데이터 행이 없습니다.</td></tr>}</tbody></table></div></div>
          <p className="mt-3 text-xs leading-5 text-slate-400">미리보기는 처음 10행만 표시합니다. 빈 행은 새 덱을 만들 때 제외됩니다.{preview.omitted_empty_columns > 0 && ` 완전히 빈 열 ${preview.omitted_empty_columns}개는 건너뛰며, 필요하면 가져온 뒤 필드 관리에서 추가할 수 있습니다.`}</p>
        </section>
        <section className="min-h-0 overflow-y-auto p-5 lg:p-7">
          <div className="mb-5 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-xs font-bold text-white">1</span><h3 className="font-semibold text-slate-800">덱과 필드 확인</h3></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><label className="text-xs font-semibold text-slate-500">덱 이름<input value={deckName} onChange={(event) => setDeckName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>{!templateType && <label className="text-xs font-semibold text-slate-500">새 노트 유형 이름<input value={noteTypeName} onChange={(event) => setNoteTypeName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" /></label>}</div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">{templateType ? <button type="button" onClick={() => { setMappingBeforeOpen(templateMapping); setMappingOpen(true) }} className="flex w-full items-center justify-between text-left"><span><b className="block text-sm text-slate-800">엑셀 열 연결</b><small className="mt-0.5 block text-xs text-slate-500">{Object.keys(templateMapping).length}개 필드 연결됨</small></span><ArrowRightLeft size={18} className="text-indigo-500" /></button> : <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">기존 노트 유형 사용 <span className="font-normal text-slate-400">(선택)</span></p></div><button type="button" onClick={() => void chooseTemplateSource()} disabled={loadingTemplate} className="shrink-0 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50">{loadingTemplate ? '불러오는 중…' : '노트 유형 불러오기'}</button></div>}</div>
          <div className="mt-5"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-slate-500">{templateType ? '엑셀 열' : 'Anki 필드명'}</p>{!templateType && <p className="text-[11px] font-medium text-slate-400">{includedColumnList.length} / {columns.length}개 열 사용</p>}</div><div className="space-y-2">{columns.map((column) => { const included = templateType ? true : columnIncluded[column]; return <div key={column} className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition ${included ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>{!templateType && <button type="button" role="switch" aria-checked={included} aria-label={included ? `열 ${String.fromCharCode(65 + column)} 사용함, 클릭하면 제외` : `열 ${String.fromCharCode(65 + column)} 사용 안 함, 클릭하면 포함`} onClick={() => toggleColumn(column)} className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${included ? 'bg-indigo-600' : 'bg-slate-200'}`}><span className={`block h-4 w-4 rounded-full bg-white shadow-sm transition ${included ? 'translate-x-4' : 'translate-x-0'}`} /></button>}<span className={`w-8 shrink-0 text-center text-xs font-bold transition ${included ? 'text-indigo-500' : 'text-slate-300'}`}>{String.fromCharCode(65 + column)}</span>{templateType ? <span className="min-w-0 flex-1 py-2.5 text-sm font-medium text-slate-600">{fieldNames[column] || `열 ${column + 1}`}</span> : <input value={fieldNames[column] ?? ''} disabled={!included} onChange={(event) => setFieldNames((names) => names.map((name, index) => index === column ? event.target.value : name))} placeholder={included ? `필드 ${column + 1}` : '이 열은 사용하지 않습니다'} className={`min-w-0 flex-1 bg-transparent py-2.5 text-sm font-medium outline-none transition ${included ? 'text-slate-800' : 'text-slate-300 placeholder:text-slate-300'}`} />}</div> })}</div>{!templateType && invalidNames && <p className="mt-2 text-xs font-medium text-rose-600">{includedColumnList.length === 0 ? '하나 이상의 열을 사용으로 설정해 주세요.' : '비어 있거나 중복된 필드명이 있습니다.'}</p>}</div>
        </section>
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-slate-200/80 bg-white px-5 py-4 sm:px-7"><p className="hidden text-xs text-slate-400 sm:block">저장 위치는 다음 단계에서 선택합니다.</p><div className="ml-auto flex gap-2"><button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">취소</button><button disabled={invalidNames || !deckName.trim() || !noteTypeName.trim() || !preview.column_count || (!!templateType && Object.keys(templateMapping).length === 0)} onClick={submit} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"><Sparkles size={16} />새 덱 초안 만들기</button></div></div>
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

