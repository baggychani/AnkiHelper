import { useEffect } from 'react'
import { AlertTriangle, ArrowUpRight, Check, Download, LogOut, Save, Sparkles, X } from 'lucide-react'

export type AvailableUpdate = { version: string; url: string }

export function ExitConfirmModal({ dirty, onCancel, onConfirm }: { dirty: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onCancel}>
    <div role="dialog" aria-modal="true" aria-labelledby="exit-title" aria-describedby="exit-description" className="w-full max-w-md rounded-[24px] border border-white/75 bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,.32)]" onClick={(event) => event.stopPropagation()}>
      <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-[#151d31] text-white shadow-[0_10px_24px_rgba(15,23,42,.16)]"><LogOut size={20} /></div>
      <h3 id="exit-title" className="text-lg font-semibold tracking-[-.015em] text-slate-900">Anki Helper를 종료할까요?</h3>
      <p id="exit-description" className="mt-2 text-sm leading-6 text-slate-500">
        {dirty ? '저장되지 않은 변경 사항을 확인해 주세요.' : '창을 닫으면 프로그램이 종료됩니다.'}
      </p>
      {dirty && <div role="alert" className="mt-4 flex gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/75 px-4 py-3.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/80 text-amber-700 shadow-sm ring-1 ring-amber-200/70"><AlertTriangle size={15} strokeWidth={2.2} /></span>
        <div>
          <p className="text-[13px] font-semibold text-amber-950">변경 내용이 저장되지 않았습니다</p>
          <p className="mt-1 text-xs leading-5 text-amber-900/70">지금 종료하면 마지막 저장 이후의 변경 내용은 복구할 수 없습니다.</p>
        </div>
      </div>}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">취소</button>
        <button onClick={onConfirm} className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition ${dirty ? 'bg-slate-800 hover:bg-slate-900' : 'bg-[#151d31] hover:bg-[#202b45]'}`}>{dirty ? '저장하지 않고 종료' : '종료'}</button>
      </div>
    </div>
  </div>
}

export function UpdateAvailableModal({ update, onDismiss, onOpen }: { update: AvailableUpdate; onDismiss: () => void; onOpen: () => void | Promise<void> }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return <div className="fixed inset-0 z-[160] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-md" onClick={onDismiss}>
    <section role="dialog" aria-modal="true" aria-labelledby="update-title" className="relative w-full max-w-[470px] overflow-hidden rounded-[28px] border border-white/15 bg-[#111a32] p-6 text-white shadow-[0_32px_90px_rgba(15,23,42,.55)] sm:p-8" onClick={(event) => event.stopPropagation()}>
      <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-indigo-500/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-52 w-52 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-6">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/15 bg-gradient-to-br from-indigo-400 to-cyan-300 text-[#10192f] shadow-lg shadow-indigo-950/30"><Sparkles size={25} /></div>
          <button aria-label="업데이트 알림 닫기" onClick={onDismiss} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={19} /></button>
        </div>
        <p className="mt-7 text-[11px] font-extrabold tracking-[.18em] text-cyan-200">NEW VERSION AVAILABLE</p>
        <h2 id="update-title" className="mt-3 text-2xl font-bold tracking-tight sm:text-[28px]">더 나은 Anki Helper가<br /><span className="bg-gradient-to-r from-indigo-200 via-violet-200 to-cyan-200 bg-clip-text text-transparent">준비되어 있어요.</span></h2>
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.07] px-4 py-3.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-cyan-200"><Download size={17} /></span>
          <div><p className="text-xs font-medium text-slate-300">새 버전</p><p className="mt-0.5 text-sm font-bold text-white">Anki Helper {update.version}</p></div>
        </div>
        <div className="mt-7 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button onClick={onDismiss} className="rounded-xl px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white">나중에</button>
          <button onClick={() => void onOpen()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-950/40 transition hover:-translate-y-0.5 hover:from-indigo-400 hover:to-violet-400 focus:outline-none focus:ring-2 focus:ring-cyan-200/80">업데이트 받기 <ArrowUpRight size={17} /></button>
        </div>
      </div>
    </section>
  </div>
}

export function UnsavedWorkModal({ onCancel, onSave, onDiscard }: { onCancel: () => void; onSave: () => void; onDiscard: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return <div className="fixed inset-0 z-[210] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onCancel}><div role="dialog" aria-modal="true" aria-label="새 작업 시작" className="w-full max-w-md rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700"><Save size={20} /></div><h3 className="text-lg font-semibold text-slate-900">저장하지 않은 변경이 있습니다</h3><p className="mt-2 text-sm leading-6 text-slate-500">현재 작업을 저장한 뒤 새 작업을 시작하거나, 저장하지 않고 계속할 수 있습니다.</p><div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button><button onClick={onDiscard} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">저장하지 않고 계속</button><button onClick={onSave} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">저장 후 계속</button></div></div></div>
}

export function Modal({ title, description, tone = 'normal', confirmLabel, onCancel, onConfirm }: { title: string; description: string; tone?: 'normal' | 'danger'; confirmLabel: string; onCancel?: () => void; onConfirm: () => void | Promise<void> }) {
  useEffect(() => {
    if (!onCancel) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl"><div className={`mb-4 grid h-11 w-11 place-items-center rounded-xl ${tone === 'danger' ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'}`}>{tone === 'danger' ? <X size={20} /> : <Check size={20} />}</div><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p><div className="mt-6 flex justify-end gap-2">{onCancel && <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button>}<button onClick={onConfirm} className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${tone === 'danger' ? 'bg-rose-600' : 'bg-indigo-600'}`}>{confirmLabel}</button></div></div></div>
}
