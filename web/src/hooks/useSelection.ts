import { useState, useCallback } from 'react'

export interface UseSelectionReturn {
  selected: Set<string>
  isSelectMode: boolean
  toggle: (id: string) => void
  selectAll: (ids: string[]) => void
  clearAll: () => void
  enterSelectMode: () => void
  exitSelectMode: () => void
}

export function useSelection(): UseSelectionReturn {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids))
  }, [])

  const clearAll = useCallback(() => {
    setSelected(new Set())
  }, [])

  const enterSelectMode = useCallback(() => {
    setIsSelectMode(true)
  }, [])

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false)
    setSelected(new Set())
  }, [])

  return { selected, isSelectMode, toggle, selectAll, clearAll, enterSelectMode, exitSelectMode }
}
