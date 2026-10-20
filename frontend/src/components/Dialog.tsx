import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The browser top layer owns stacking, background inertness and focus restoration. */
export function Dialog({ label, labelledBy, describedBy, onDismiss, dismissOnBackdrop = false, className, children }: {
  label?: string
  labelledBy?: string
  describedBy?: string
  onDismiss?: () => void
  dismissOnBackdrop?: boolean
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => { dialog.close() }
  }, [])

  return createPortal(
    <dialog ref={ref} aria-modal="true" aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 text-slate-900 outline-none backdrop:bg-transparent"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onDismiss?.() }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key !== 'Tab') return
        // Native dialogs can tab into browser chrome. Keep keyboard navigation
        // within the app dialog and exclude hidden/disabled controls.
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"], video[controls], audio[controls]',
        )).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled')
          && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
          event.preventDefault(); first.focus()
        }
      }}
    >
      <div className={className ?? 'fixed inset-0 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm'}
        onClick={(event) => { if (dismissOnBackdrop && event.target === event.currentTarget) onDismiss?.() }}>
        {children}
      </div>
    </dialog>, document.body,
  )
}
