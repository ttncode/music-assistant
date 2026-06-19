import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle, XCircle, Info, X } from '@phosphor-icons/react'
import { Toast, ToastType } from '../hooks/useToast'

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={15} weight="fill" className="text-[var(--color-accent)] shrink-0 mt-0.5" />,
  error:   <XCircle    size={15} weight="fill" className="text-[var(--color-error)] shrink-0 mt-0.5" />,
  info:    <Info       size={15} weight="fill" className="text-[var(--color-text-muted)] shrink-0 mt-0.5" />,
}

interface Props {
  toasts: Toast[]
  onRemove: (id: string) => void
}

export function Toaster({ toasts, onRemove }: Props) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-xs w-full">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-auto flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 shadow-lg text-sm"
          >
            {ICONS[t.type]}
            <span className="flex-1 text-[var(--color-text)]">{t.message}</span>
            <button
              onClick={() => onRemove(t.id)}
              className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mt-0.5"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
