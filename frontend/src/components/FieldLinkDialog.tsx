import { useState } from 'react'
import { Dialog } from './Dialog'

export function FieldLinkDialog({ sources, destinations, onCancel, onApply }: {
  sources: string[]
  destinations: string[]
  onCancel: () => void
  onApply: (mapping: Record<string, string>) => void
}) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => Object.fromEntries(
    sources.filter((name) => destinations.includes(name)).map((name) => [name, name]),
  ))
  const [active, setActive] = useState<string | null>(null)
  const sourceAnchors = sources.map((_, index) => 28 + index * 56 + 20)
  const destinationAnchors = destinations.map((_, index) => 28 + index * 56 + 20)
  const connect = (destination: string) => {
    if (active === null) return
    setMapping((current) => ({ ...current, [active]: destination }))
    setActive(null)
  }
  return <Dialog label="디자인 필드 연결" onDismiss={onCancel}>
    <div className="flex max-h-[calc(100vh-32px)] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] border border-white/70 bg-white shadow-2xl">
      <div className="border-b border-slate-100 p-6">
        <h3 className="text-lg font-semibold text-slate-900">디자인 필드를 현재 필드에 연결하세요</h3>
        <p className="mt-1 text-sm text-slate-500">왼쪽 이름을 누른 뒤 오른쪽 필드를 누르면 연결됩니다. 연결하지 않은 이름은 코드에 그대로 둡니다.</p>
      </div>
      <div className="min-h-0 overflow-y-auto p-6">
        <div className="relative grid grid-cols-[1fr_72px_1fr] gap-3">
          <div className="space-y-2">{sources.map((name) => {
            const linked = mapping[name] !== undefined
            return <button key={name} type="button" onClick={() => { setActive(name); if (linked) setMapping((current) => { const next = { ...current }; delete next[name]; return next }) }} className={`flex h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ${active === name ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : linked ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}>
              <span className="truncate">{name}</span><span className="h-3 w-3 rounded-full bg-indigo-500" />
            </button>
          })}</div>
          <div className="relative">
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 72 ${Math.max(sources.length, destinations.length, 1) * 56}`} preserveAspectRatio="none">
              {sources.map((name, index) => {
                const destination = mapping[name]
                const destinationIndex = destinations.indexOf(destination ?? '')
                if (destinationIndex < 0) return null
                return <path key={name} d={`M 8 ${sourceAnchors[index]} C 36 ${sourceAnchors[index]}, 36 ${destinationAnchors[destinationIndex]}, 64 ${destinationAnchors[destinationIndex]}`} fill="none" stroke="#6366f1" strokeWidth="2.5" />
              })}
            </svg>
          </div>
          <div className="space-y-2">{destinations.map((name) => {
            const taken = Object.values(mapping).includes(name)
            return <button key={name} type="button" onClick={() => connect(name)} className={`flex h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ${taken ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : active !== null ? 'border-indigo-200 bg-indigo-50/40 text-slate-700' : 'border-slate-200 bg-white text-slate-700'}`}>
              <span className="h-3 w-3 rounded-full bg-indigo-500" /><span className="truncate">{name}</span>
            </button>
          })}</div>
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 p-5">
        <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button>
        <button onClick={() => onApply(mapping)} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">이 연결로 가져오기</button>
      </div>
    </div>
  </Dialog>
}
