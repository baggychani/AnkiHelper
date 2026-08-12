import { useCallback, useEffect, useRef, type CSSProperties } from 'react'
import { FileSpreadsheet, FolderOpen, LoaderCircle, Sparkles } from 'lucide-react'

const WELCOME_POINTER_TRACKING_ENABLED = false

export function Welcome({ onOpen, busy, dragActive }: { onOpen: () => void; busy: boolean; dragActive: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef({ x: 50, y: 50 })
  const currentRef = useRef({ x: 50, y: 50 })
  const frameRef = useRef<number>()
  const motionEnabledRef = useRef(
    WELCOME_POINTER_TRACKING_ENABLED
      && typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [])

  const animatePointer = useCallback(function tick() {
    const root = rootRef.current
    if (!root || !motionEnabledRef.current) return
    const target = targetRef.current
    const current = currentRef.current
    current.x += (target.x - current.x) * 0.16
    current.y += (target.y - current.y) * 0.16
    root.style.setProperty('--welcome-x', `${current.x}%`)
    root.style.setProperty('--welcome-y', `${current.y}%`)
    root.style.setProperty('--welcome-drift-x', `${(current.x - 50) * 0.035}px`)
    root.style.setProperty('--welcome-drift-y', `${(current.y - 50) * 0.025}px`)
    if (Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.08) {
      frameRef.current = requestAnimationFrame(tick)
    } else {
      frameRef.current = undefined
    }
  }, [])

  const startPointerAnimation = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(animatePointer)
  }, [animatePointer])

  const setPointerTarget = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current
    if (!root || !motionEnabledRef.current) return
    const rect = root.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    targetRef.current = {
      x: Math.min(92, Math.max(8, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.min(90, Math.max(10, ((clientY - rect.top) / rect.height) * 100)),
    }
    startPointerAnimation()
  }, [startPointerAnimation])

  const resetPointer = useCallback(() => {
    targetRef.current = { x: 50, y: 50 }
    startPointerAnimation()
  }, [startPointerAnimation])

  return (
    <div
      ref={rootRef}
      className={`welcome-shell relative grid h-full min-h-0 place-items-center overflow-hidden rounded-[22px] bg-[#0d1425] px-5 transition lg:rounded-[28px] lg:px-6 ${WELCOME_POINTER_TRACKING_ENABLED ? '' : 'welcome-pointer-tracking-off'} ${dragActive ? 'ring-2 ring-cyan-200/80 ring-offset-4 ring-offset-[#eef1f7]' : ''}`}
      style={{ '--welcome-x': '50%', '--welcome-y': '50%', '--welcome-drift-x': '0px', '--welcome-drift-y': '0px' } as CSSProperties}
      onPointerMove={(event) => setPointerTarget(event.clientX, event.clientY)}
      onPointerLeave={resetPointer}
    >
      <div aria-hidden className="welcome-ambient pointer-events-none absolute inset-0" />
      <div aria-hidden className="welcome-aurora-pointer pointer-events-none absolute inset-0" />
      <div aria-hidden className="welcome-glow-orb pointer-events-none absolute" />
      <div aria-hidden className="welcome-mesh pointer-events-none absolute inset-0" />
      <div className={`pointer-events-none absolute inset-4 rounded-[18px] border border-dashed border-cyan-200/0 transition lg:rounded-[24px] ${dragActive ? 'border-cyan-200/70 bg-cyan-200/[.04]' : ''}`} />
      <div className="welcome-content relative max-w-xl text-center">
        <div className="welcome-rise welcome-sparkle-shell mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[19px] bg-white/10 ring-1 ring-white/15 lg:mb-7 lg:h-16 lg:w-16 lg:rounded-[22px]">
          <Sparkles className="text-violet-200" size={29} />
        </div>
        <h2 className="text-[34px] font-semibold leading-[1.2] tracking-[-.045em] text-white sm:text-[38px] lg:text-[42px]">
          <span className="welcome-rise welcome-delay-title block">복잡한 Anki 파일,</span>
          <span className="welcome-rise welcome-delay-subtitle block bg-gradient-to-r from-violet-300 to-cyan-200 bg-clip-text text-transparent">누구보다 쉽게 다루세요.</span>
        </h2>
        <p className="welcome-rise welcome-delay-copy mt-4 text-sm leading-6 text-slate-400">Excel로 새 덱을 만들거나 기존 APKG를 열어 이어서 편집할 수 있습니다.</p>
        <div className="welcome-rise welcome-delay-action mt-6 flex flex-col justify-center gap-2 sm:flex-row lg:mt-7">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('ankihelper:import-table'))}
            disabled={busy}
            className="welcome-action-btn welcome-action-btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-slate-900 lg:h-12"
          >
            <FileSpreadsheet size={18} />
            엑셀로 새 덱 만들기
          </button>
          <button
            type="button"
            onClick={onOpen}
            disabled={busy}
            className="welcome-action-btn welcome-action-btn-secondary inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 text-sm font-semibold text-white lg:h-12"
          >
            {busy ? <LoaderCircle className="animate-spin" size={18} /> : <FolderOpen size={18} />}
            기존 파일 열기
          </button>
        </div>
      </div>
    </div>
  )
}


