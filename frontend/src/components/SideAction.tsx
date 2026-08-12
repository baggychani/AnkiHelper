import type { LucideIcon } from 'lucide-react'

export function SideAction({ label, icon: Icon, compact, disabled, onClick }: {
  label: string
  icon: LucideIcon
  compact: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={label}
      className="flex h-9 w-full items-center rounded-xl px-3 text-[11px] font-medium text-slate-500 transition hover:bg-white/[.055] hover:text-slate-200 disabled:opacity-30"
    >
      <Icon size={16} />
      <span className={`${compact ? 'w-0 opacity-0' : 'ml-3 opacity-100'} whitespace-nowrap transition-all`}>{label}</span>
    </button>
  )
}
