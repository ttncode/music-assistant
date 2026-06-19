import { ArrowCircleDown, X, StopCircle } from '@phosphor-icons/react'

interface Props {
  selected: Set<string>
  isSelectMode: boolean
  isRunning: boolean
  progress: { current: number; total: number } | null
  filteredUndownloadedIds: string[]
  onDownloadSelected: () => void
  onSelectAllUndownloaded: () => void
  onClearAll: () => void
  onCancel: () => void
  onCancelDownload: () => void
}

export function SelectionBar({
  selected,
  isSelectMode,
  isRunning,
  progress,
  filteredUndownloadedIds,
  onDownloadSelected,
  onSelectAllUndownloaded,
  onClearAll,
  onCancel,
  onCancelDownload,
}: Props) {
  // Visible when desktop has a selection, or mobile is in select mode
  if (selected.size === 0 && !isSelectMode) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 max-w-2xl mx-auto px-4 py-3 flex-wrap">
        {isRunning && progress ? (
          <>
            <span className="flex-1 text-sm text-[var(--color-text-secondary)]">
              Downloading {progress.current} of {progress.total}...
            </span>
            <button
              onClick={onCancelDownload}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:border-[var(--color-error)] transition-colors"
            >
              <StopCircle size={14} />
              Cancel
            </button>
          </>
        ) : selected.size > 0 ? (
          <button
            onClick={onDownloadSelected}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] text-white px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <ArrowCircleDown size={15} />
            Download {selected.size} song{selected.size !== 1 ? 's' : ''}
          </button>
        ) : null}

        {!isRunning && filteredUndownloadedIds.length > 0 && (
          <button
            onClick={onSelectAllUndownloaded}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            {selected.size > 0 ? 'Select All' : 'Select All Undownloaded'}
          </button>
        )}

        {selected.size > 0 && !isRunning && (
          <button
            onClick={onClearAll}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Clear
          </button>
        )}

        {/* Mobile-only cancel button — exits select mode and clears selection */}
        <button
          onClick={onCancel}
          className="md:hidden ml-auto p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          aria-label="Cancel selection"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
