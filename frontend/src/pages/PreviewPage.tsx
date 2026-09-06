import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import type { NoteType } from '../api'
import { initialPreviewState, type PreviewSide } from '../previewLifecycle'
import { buildPreviewDocument, PREVIEW_SCREEN, type PreviewLiveMessage, type PreviewPlatform } from '../previewAudio'

const TITLE_BAR_HEIGHT = 44
const FRAME_BEZEL: Record<PreviewPlatform, number> = { desktop: 7, ankidroid: 10 }
const FRAME_RADIUS: Record<PreviewPlatform, number> = { desktop: 28, ankidroid: 38 }

function frameSize(platform: PreviewPlatform) {
  const screen = PREVIEW_SCREEN[platform]
  const bezel = FRAME_BEZEL[platform]
  return {
    screen,
    bezel,
    width: screen.width + bezel * 2,
    height: TITLE_BAR_HEIGHT + screen.height + bezel * 2,
  }
}

export function PreviewPage({ noteType, templateIndex, previewState, previewHtml, onSide, onNavigate, clozeCards, onCloze }: {
  noteType?: NoteType
  templateIndex: number
  previewState: typeof initialPreviewState
  previewHtml: string | null
  onSide: (side: PreviewSide) => void
  onNavigate: (delta: -1 | 1) => void
  clozeCards: { ordinals: number[]; active: number }
  onCloze: (ordinal: number) => void
}) {
  const [platform, setPlatform] = useState<PreviewPlatform>('desktop')
  const [nightMode, setNightMode] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [stageSize, setStageSize] = useState({ width: 1000, height: 700 })
  const appliedAppearanceRef = useRef({ platform, nightMode })
  // The iframe is never reloaded just because the note/side/cloze/template
  // changed (see the effect below), so `postMessage` can otherwise race a
  // still-loading document: queue messages sent before `onLoad` fires and
  // flush them once the listener inside the iframe is actually attached.
  const iframeReadyRef = useRef(false)
  const pendingMessagesRef = useRef<PreviewLiveMessage[]>([])
  const [doc, setDoc] = useState<{ noteTypeId: string; html: string } | null>(null)

  const postToIframe = useCallback((message: PreviewLiveMessage) => {
    if (iframeReadyRef.current) iframeRef.current?.contentWindow?.postMessage(message, '*')
    else pendingMessagesRef.current.push(message)
  }, [])

  const handleIframeLoad = useCallback(() => {
    iframeReadyRef.current = true
    const queued = pendingMessagesRef.current
    pendingMessagesRef.current = []
    queued.forEach((message) => iframeRef.current?.contentWindow?.postMessage(message, '*'))
  }, [])

  useLayoutEffect(() => {
    if (previewHtml === null || !noteType) return
    setDoc((current) => {
      if (current && current.noteTypeId === noteType.id) {
        // Same card/session as before: push the new front/back/note/cloze
        // content into the *live* document instead of reloading the iframe,
        // so any state a card script saved to session/localStorage (e.g. a
        // randomly picked mascot that must match on both card sides) survives.
        postToIframe({ type: 'ankihelper:content', html: previewHtml, templateIndex })
        return current
      }
      // A genuinely different note type is a different CSS/script world, so
      // starting it over with a fresh iframe (and thus fresh storage) is correct.
      iframeReadyRef.current = false
      pendingMessagesRef.current = []
      appliedAppearanceRef.current = { platform, nightMode }
      return { noteTypeId: noteType.id, html: buildPreviewDocument(previewHtml, { templateIndex, platform, nightMode }) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- platform/nightMode intentionally excluded: they're only baked in for a brand-new doc above, and pushed live by the effect below otherwise
  }, [previewHtml, noteType?.id, templateIndex, postToIframe])

  useLayoutEffect(() => {
    if (appliedAppearanceRef.current.platform === platform && appliedAppearanceRef.current.nightMode === nightMode) return
    appliedAppearanceRef.current = { platform, nightMode }
    postToIframe({ type: 'ankihelper:appearance', platform, nightMode })
  }, [platform, nightMode, postToIframe])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const recompute = () => {
      // clientWidth/Height exclude borders and scrollbars but still include
      // padding, so subtract the *actual* computed padding (which varies by
      // breakpoint, e.g. p-3 vs lg:p-5) rather than a fixed guess - otherwise
      // the device mockup overflows its box and gets clipped on one side.
      const style = getComputedStyle(stage)
      const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      if (width < 1 || height < 1) return
      setStageSize((current) => current.width === width && current.height === height ? current : { width, height })
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
  const frame = frameSize(platform)
  const scale = Math.max(0.05, Math.min(stageSize.width / frame.width, stageSize.height / frame.height, 1))

  return <div className="mx-auto grid h-full min-h-[480px] min-w-0 max-w-[1420px] gap-3 lg:min-h-[620px] lg:grid-cols-[minmax(0,1fr)_230px] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_250px]">
    <section ref={stageRef} className="grid h-full min-h-0 min-w-0 place-items-center overflow-hidden rounded-[20px] bg-[#172033] p-3 lg:rounded-[26px] lg:p-5">
      {doc === null ? <div role="status" className="grid h-full min-h-40 place-items-center text-xs font-medium text-slate-400">카드를 불러오는 중…</div> : (
        // The frame morphs between PC and AnkiDroid shapes via a single `transform: scale`
        // around its own center - never top-left - so its on-screen center point stays put
        // no matter how much the width/height ratio changes. This wrapper only exists to
        // give the (potentially much larger than available space) frame a safe, fixed-size
        // home to center within and clip against, so it can never distort the grid track.
        <div className="relative flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden">
          <div
            data-testid="preview-device-shell"
            className="flex shrink-0 flex-col overflow-hidden border-[#0a0f1d] bg-white shadow-2xl"
            style={{ width: frame.width, height: frame.height, transform: `scale(${scale})`, transformOrigin: 'center', borderStyle: 'solid', borderWidth: frame.bezel, borderRadius: FRAME_RADIUS[platform], boxSizing: 'border-box', transition: 'width 500ms ease-out, height 500ms ease-out, transform 500ms ease-out, border-width 500ms ease-out, border-radius 500ms ease-out' }}
          >
            <div className="flex h-11 shrink-0 items-center justify-between border-b px-5 text-[11px] text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-400" /><b>{deviceLabel} 미리보기</b><span>{noteIndex + 1} / {total}</span></div>
            <iframe
              ref={iframeRef}
              key={doc.noteTypeId}
              title="카드 미리보기"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={doc.html}
              onLoad={handleIframeLoad}
              style={{ width: frame.screen.width, height: frame.screen.height, border: 0, display: 'block' }}
            />
          </div>
        </div>
      )}
    </section>
    <aside className="flex min-h-[170px] flex-col rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[22px] lg:p-5">
      <h2 className="text-lg font-semibold">실시간 미리보기</h2>
      <div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 lg:mt-6"><button disabled={doc === null} onClick={() => onSide('front')} className={`rounded-lg py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-50 ${side === 'front' ? 'bg-white shadow-sm' : 'text-slate-400'}`}>앞면</button><button disabled={doc === null} onClick={() => onSide('back')} className={`rounded-lg py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-50 ${side === 'back' ? 'bg-white shadow-sm' : 'text-slate-400'}`}>뒷면</button></div>
      {clozeCards.ordinals.length > 1 && <div className="mt-5" data-testid="preview-cloze-picker">
        <p className="mb-2 text-[11px] font-semibold text-slate-400">빈칸 카드</p>
        <div className="flex flex-wrap gap-1.5">
          {clozeCards.ordinals.map((ordinal) => <button
            key={ordinal}
            type="button"
            aria-pressed={ordinal === clozeCards.active}
            onClick={() => onCloze(ordinal)}
            className={`min-w-[38px] rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${ordinal === clozeCards.active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >c{ordinal}</button>)}
        </div>
      </div>}
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
