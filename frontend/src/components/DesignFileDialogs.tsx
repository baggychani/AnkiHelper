import { Dialog } from './Dialog'

export function DesignExportMissingDialog({ names, onCancel, onContinue }: {
  names: string[]
  onCancel: () => void
  onContinue: () => void
}) {
  return <Dialog label="패키지에 없는 미디어" onDismiss={onCancel}>
    <div className="w-full max-w-md rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl">
      <h3 className="text-lg font-semibold text-slate-900">패키지에 없는 미디어</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">코드에 적혀 있지만 패키지에 없는 파일입니다. 이 파일은 빼고 내보냅니다.</p>
      <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{names.map((name) => <li key={name} className="truncate">{name}</li>)}</ul>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button>
        <button onClick={onContinue} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">계속 내보내기</button>
      </div>
    </div>
  </Dialog>
}

export function DesignMediaConflictDialog({ names, onCancel, onKeep, onOverwrite }: {
  names: string[]
  onCancel: () => void
  onKeep: () => void
  onOverwrite: () => void
}) {
  return <Dialog label="같은 이름의 미디어" onDismiss={onCancel}>
    <div className="w-full max-w-md rounded-[22px] border border-white/70 bg-white p-6 shadow-2xl">
      <h3 className="text-lg font-semibold text-slate-900">같은 이름의 미디어가 있습니다</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">덱에 같은 이름의 파일이 있고 내용이 다릅니다. 덮어쓰면 덱에 있던 파일이 바뀝니다.</p>
      <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{names.map((name) => <li key={name} className="truncate">{name}</li>)}</ul>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">취소</button>
        <button onClick={onKeep} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">기존 파일 유지</button>
        <button onClick={onOverwrite} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">덮어쓰기</button>
      </div>
    </div>
  </Dialog>
}
