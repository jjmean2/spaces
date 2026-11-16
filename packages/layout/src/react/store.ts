import { useSyncExternalStore } from 'react'
import type { LayoutState } from '../core/index.ts'

export interface LayoutStore {
  getState(): LayoutState
  /** Replace the state with the result of `updater`, e.g. `store.update((s) => movePane(s, id, target))`. */
  update(updater: (state: LayoutState) => LayoutState): void
  subscribe(listener: () => void): () => void
}

export function createLayoutStore(initial: LayoutState): LayoutStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    update(updater) {
      const next = updater(state)
      if (next === state) return
      state = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useLayoutState(store: LayoutStore): LayoutState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
