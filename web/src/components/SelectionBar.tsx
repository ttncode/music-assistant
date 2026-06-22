import { ArrowCircleDown, X, StopCircle, CircleNotch } from '@phosphor-icons/react'

interface Props {
  selected: Set<string>
  isSelectMode: boolean
  isRunning: boolean
  progress: { current: number; total: number } | null
  filteredUndownloadedIds: string[]
  awaitingGesture: boolean
  onDownloadSelected: () => void
  onSelectAllUndownloaded: () => void
  onClearAll: () => void
  onCancel: () => void
  onCancelDownload: () => void
  downloadNext: () => void
}

export function SelectionBar({
  selected,
  isSelectMode,
  isRunning,
  progress,
  filteredUndownloadedIds,
  awaitingGesture,
  onDownloadSelected,
  onSelectAllUndownloaded,
  onClearAll,
  onCancel,
  onCancelDownload,
  downloadNext,
}: Props) {
  if (selected.size === 0 && !isSelectMode) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 max-w-2xl mx-auto px-4 py-3 flex-wrap">
        {awaitingGesture && progress ? (
          <>
            <button
              onClick={downloadNext}
              className="flex-1 flex items-center justify-center gap-1.5 cursor-pointer rounded-lg bg-[var(--color-accent)] text-white px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <ArrowCircleDown size={15} />
              Tap to download ({progress.current + 1} of {progress.total})
            </button>
            <button
              onClick={onCancelDownload}
              className="flex items-center gap-1.5 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:border-[var(--color-error)] transition-colors"
            >
              <StopCircle size={14} />
              Cancel
            </button>
          </>
        ) : isRunning && progress ? (
          <>
            <span className="flex-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              {progress.current === 0 && (
                <CircleNotch size={15} className="animate-spin shrink-0" />
              )}
              {progress.current === 0
                ? `Preparing ${progress.total} song${progress.total !== 1 ? 's' : ''}…`
                : `Downloading ${progress.current} of ${progress.total}…`}
            </span>
            <button
              onClick={onCancelDownload}
              className="flex items-center gap-1.5 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:border-[var(--color-error)] transition-colors"
            >
              <StopCircle size={14} />
              Cancel
            </button>
          </>
        ) : selected.size > 0 ? (
          <button
            onClick={onDownloadSelected}
            className="flex items-center gap-1.5 cursor-pointer rounded-lg bg-[var(--color-accent)] text-white px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <ArrowCircleDown size={15} />
            Download {selected.size} song{selected.size !== 1 ? 's' : ''}
          </button>
        ) : null}

        {!isRunning && !awaitingGesture && filteredUndownloadedIds.length > 0 && (
          <button
            onClick={onSelectAllUndownloaded}
            className="cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            {selected.size > 0 ? 'Select All' : 'Select All Undownloaded'}
          </button>
        )}

        {selected.size > 0 && !isRunning && !awaitingGesture && (
          <button
            onClick={onClearAll}
            className="cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Clear
          </button>
        )}

        {/* Mobile-only cancel button — exits select mode and clears selection */}
        <button
          onClick={onCancel}
          className="md:hidden ml-auto cursor-pointer p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          aria-label="Cancel selection"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
