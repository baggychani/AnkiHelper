import { useState } from 'react'
import { ArrowLeft, ArrowRight, Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import type { NoteType } from '../api'
import { initialPreviewState, type PreviewSide } from '../previewLifecycle'
import { buildPreviewDocument, type PreviewPlatform } from '../previewAudio'

export function PreviewPage({ noteType, templateIndex, previewState, previewKey, previewHtml, onSide, onNavigate }: {
  noteType?: NoteType
  templateIndex: number
  previewState: typeof initialPreviewState
  previewKey: string
  previewHtml: string | null
  onSide: (side: PreviewSide) => void
  onNavigate: (delta: -1 | 1) => void
}) {
  const [platform, setPlatform] = useState<PreviewPlatform>('desktop')
  const [nightMode, setNightMode] = useState(false)
  if (!noteType) return null
  const total = Math.max(noteType.notes.length, 1)
  const { noteIndex, side } = previewState
  const doc = previewHtml === null ? null : buildPreviewDocument(previewHtml, { templateIndex, platform, nightMode })
  const deviceLabel = platform === 'ankidroid' ? 'ANKIDROID' : 'ANKI PC'
  return <div className="mx-auto grid h-full min-h-[480px] max-w-[1420px] gap-3 lg:min-h-[620px] lg:grid-cols-[minmax(0,1fr)_230px] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_250px]">
    <section className="grid min-h-0 place-items-center rounded-[20px] bg-[#172033] p-3 lg:rounded-[26px] lg:p-5">
      <div className={`flex h-[min(72vh,710px)] max-h-full w-full flex-col overflow-hidden border-[#0a0f1d] bg-white shadow-2xl transition-[max-width,border-radius,border-width] duration-300 ${platform === 'ankidroid' ? 'max-w-[430px] rounded-[30px] border-[8px]' : 'max-w-[820px] rounded-[24px] border-[6px] lg:rounded-[28px] lg:border-[7px]'}`}>
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-5 text-[11px] text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-400" /><b>{deviceLabel} 미리보기</b><span>{noteIndex + 1} / {total}</span></div>
        {doc === null ? <div role="status" className="grid h-full place-items-center text-xs font-medium text-slate-400">카드를 불러오는 중…</div> : <iframe key={`${previewKey}:${platform}:${nightMode ? 'night' : 'day'}`} title="카드 미리보기" sandbox="allow-scripts allow-same-origin" srcDoc={doc} className="h-full w-full border-0" />}
      </div>
    </section>
    <aside className="flex min-h-[170px] flex-col rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[22px] lg:p-5">
      <h2 className="text-lg font-semibold">실시간 미리보기</h2>
      <div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 lg:mt-6"><button disabled={doc === null} onClick={() => onSide('front')} className={`rounded-lg py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-50 ${side === 'front' ? 'bg-white shadow-sm' : 'text-slate-400'}`}>앞면</button><button disabled={doc === null} onClick={() => onSide('back')} className={`rounded-lg py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-50 ${side === 'back' ? 'bg-white shadow-sm' : 'text-slate-400'}`}>뒷면</button></div>
      <div className="mt-5">
        <p className="mb-2 text-[11px] font-semibold text-slate-400">표시 환경</p>
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button type="button" aria-pressed={platform === 'desktop'} onClick={() => setPlatform('desktop')} className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition ${platform === 'desktop' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}><Monitor size={14} />PC</button>
          <button type="button" aria-pressed={platform === 'ankidroid'} onClick={() => setPlatform('ankidroid')} className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition ${platform === 'ankidroid' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}><Smartphone size={14} />AnkiDroid</button>
        </div>
      </div>
      <button type="button" aria-pressed={nightMode} onClick={() => setNightMode((enabled) => !enabled)} className="mt-3 inline-flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"><span className="inline-flex items-center gap-2">{nightMode ? <Moon size={14} /> : <Sun size={14} />}야간 모드</span><span className={`h-4 w-7 rounded-full p-0.5 transition ${nightMode ? 'bg-indigo-600' : 'bg-slate-200'}`}><span className={`block h-3 w-3 rounded-full bg-white shadow-sm transition ${nightMode ? 'translate-x-3' : ''}`} /></span></button>
      <div className="mt-auto grid grid-cols-2 gap-2"><button disabled={doc === null} onClick={() => onNavigate(-1)} className="inline-flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-semibold disabled:cursor-wait disabled:opacity-50"><ArrowLeft size={15} />이전</button><button disabled={doc === null} onClick={() => onNavigate(1)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#151d31] py-2.5 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-50">다음<ArrowRight size={15} /></button></div>
    </aside>
  </div>
}
