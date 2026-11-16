import { createContext, useContext } from 'react'
import type { ContainerRef, PaneId, Rect, WindowId } from '../core/index.ts'
import type { DragController } from './drag.ts'
import type { LayoutStore } from './store.ts'

export interface LayoutInternals {
  store: LayoutStore
  drag: DragController
  /** Where a floating window is drawn, which can differ from its stored rectangle. */
  windowRect(windowId: WindowId): Rect | undefined
  registerSlot(key: string, element: HTMLElement | null): void
}

export const LayoutContext = createContext<LayoutInternals | null>(null)
export const ContainerContext = createContext<ContainerRef | null>(null)
export const PaneContext = createContext<PaneId | null>(null)

export function containerKey(ref: ContainerRef): string {
  return ref.type === 'edge' ? `edge:${ref.edge}` : `${ref.type}:${ref.id}`
}

export function useInternals(hook: string): LayoutInternals {
  const internals = useContext(LayoutContext)
  if (!internals) throw new Error(`${hook} must be used inside <Layout>`)
  return internals
}

/** The store of the nearest `<Layout>`. Works in pane content and in container chrome. */
export function useLayoutStore(): LayoutStore {
  return useInternals('useLayoutStore').store
}

/** The id of the pane whose content is being rendered. */
export function usePaneId(): PaneId {
  const id = useContext(PaneContext)
  if (id === null) throw new Error('usePaneId must be used inside pane content')
  return id
}

export function useSlotRegistration(): { key: string; register: LayoutInternals['registerSlot'] } {
  const { registerSlot } = useInternals('<PaneSlot>')
  const container = useContext(ContainerContext)
  if (!container) throw new Error('<PaneSlot> must be rendered by renderContainer')
  return { key: containerKey(container), register: registerSlot }
}
