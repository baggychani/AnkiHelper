import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import type { NoteType } from '../api'
import { initialPreviewState, type PreviewSide } from '../previewLifecycle'
import { buildPreviewDocument, type PreviewPlatform } from '../previewAudio'

// The card renders inside the iframe at a real device resolution (so text
// wrapping, font sizes, and layout all come out exactly as they would on an
// actual PC browser window or an actual phone) and the whole thing is then
// visually scaled down with `transform: scale()` to fit a modest on-screen
// mockup. Resizing the mockup box alone (without this) would just cram real
// desktop-width content into a shrunken box instead of showing a phone-sized
// layout.
const DEVICE_VIEWPORT: Record<PreviewPlatform, { width: number; height: number }> = {
  desktop: { width: 1040, height: 640 },
  ankidroid: { width: 400, height: 868 },
}
// On-screen footprint ceilings - deliberately modest; the phone mockup is
// meant to look smaller on screen than the PC mockup, not fill the panel.
const DISPLAY_BUDGET: Record<PreviewPlatform, { maxWidth: number; maxHeight: number }> = {
  desktop: { maxWidth: 640, maxHeight: 400 },
  ankidroid: { maxWidth: 280, maxHeight: 608 },
}
const STAGE_PADDING = 24
const TITLE_BAR_HEIGHT = 44

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
  const stageRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [stageSize, setStageSize] = useState({ width: 1000, height: 700 })

  // Rebuilding the iframe document (and reloading it) only when the underlying
  // card content changes - not on every platform/night-mode toggle - is what
  // keeps those toggles from flashing blank white like a page refresh.
  const loadedKeyRef = useRef<string | null>(null)
  const appliedAppearanceRef = useRef({ platform, nightMode })
  const [doc, setDoc] = useState<string | null>(null)
  const effectiveKey = previewHtml === null ? null : previewKey
  if (loadedKeyRef.current !== effectiveKey) {
    loadedKeyRef.current = effectiveKey
    setDoc(previewHtml === null ? null : buildPreviewDocument(previewHtml, { templateIndex, platform, nightMode }))
  }

  useEffect(() => {
    // A fresh document already bakes in the platform/night-mode it was built
    // with, so treat it as already applied and skip a redundant postMessage.
    appliedAppearanceRef.current = { platform, nightMode }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally tracks `doc`, not the live platform/nightMode values
  }, [doc])

  useEffect(() => {
    if (appliedAppearanceRef.current.platform === platform && appliedAppearanceRef.current.nightMode === nightMode) return
    appliedAppearanceRef.current = { platform, nightMode }
    iframeRef.current?.contentWindow?.postMessage({ type: 'ankihelper:appearance', platform, nightMode }, '*')
  }, [platform, nightMode])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const recompute = () => {
      const rect = stage.getBoundingClientRect()
      setStageSize((current) => current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height })
    }
    recompute()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(recompute)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  if (!noteType) return null
  const total = Math.max(noteType.notes.length, 1)
  const { noteIndex, side } = previewState
  const deviceLabel = platform === 'ankidroid' ? 'ANKIDROID' : 'ANKI PC'

  // Derived fresh every render from the *current* platform, so a platform
  // switch never shows one frame of mismatched device size vs. scale.
  const device = DEVICE_VIEWPORT[platform]
  const budget = DISPLAY_BUDGET[platform]
  const availableWidth = Math.max(0, stageSize.width - STAGE_PADDING)
  const availableHeight = Math.max(0, stageSize.height - STAGE_PADDING - TITLE_BAR_HEIGHT)
  const maxWidth = Math.min(budget.maxWidth, availableWidth || budget.maxWidth)
  const maxHeight = Math.min(budget.maxHeight, availableHeight || budget.maxHeight)
  const scale = Math.max(0.05, Math.min(maxWidth / device.width, maxHeight / device.height))
  const displayWidth = device.width * scale
  const displayHeight = device.height * scale

  return <div className="mx-auto grid h-full min-h-[480px] max-w-[1420px] gap-3 lg:min-h-[620px] lg:grid-cols-[minmax(0,1fr)_230px] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_250px]">
    <section ref={stageRef} className="grid min-h-0 place-items-center rounded-[20px] bg-[#172033] p-3 lg:rounded-[26px] lg:p-5">
      <div
        style={{ width: displayWidth, height: TITLE_BAR_HEIGHT + displayHeight }}
        className={`flex flex-col overflow-hidden border-[#0a0f1d] bg-white shadow-2xl transition-[width,height,border-radius,border-width] duration-500 ease-out ${platform === 'ankidroid' ? 'rounded-[38px] border-[10px]' : 'rounded-[24px] border-[6px] lg:rounded-[28px] lg:border-[7px]'}`}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-5 text-[11px] text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-400" /><b>{deviceLabel} 미리보기</b><span>{noteIndex + 1} / {total}</span></div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {doc === null ? <div role="status" className="grid h-full place-items-center text-xs font-medium text-slate-400">카드를 불러오는 중…</div> : (
            <div style={{ width: device.width, height: device.height, transform: `scale(${scale})`, transformOrigin: 'top left', transition: 'transform 500ms ease-out' }}>
              <iframe ref={iframeRef} key={previewKey} title="카드 미리보기" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={doc} style={{ width: device.width, height: device.height, border: 0 }} />
            </div>
          )}
        </div>
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
