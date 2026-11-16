import { findHomeGroup, groups } from './tree.ts'
import type {
  Container,
  ContainerRef,
  GroupNode,
  LayoutNode,
  LayoutState,
  PaneId,
} from './types.ts'

export function getContainer(state: LayoutState, ref: ContainerRef): Container | undefined {
  switch (ref.type) {
    case 'group':
      for (const g of groups(state.root)) if (g.id === ref.id) return g
      return undefined
    case 'edge':
      return state.edges[ref.edge]
    case 'floating':
      return state.floating.find((w) => w.id === ref.id)
  }
}

/** The container the pane is placed in right now, or `undefined` for a tiled pane with no group. */
export function paneContainerRef(state: LayoutState, paneId: PaneId): ContainerRef | undefined {
  const pane = state.panes[paneId]
  if (!pane) return undefined
  switch (pane.placement.type) {
    case 'tiled': {
      const home = findHomeGroup(state.root, paneId)
      return home ? { type: 'group', id: home.id } : undefined
    }
    case 'edge':
      return { type: 'edge', edge: pane.placement.edge }
    case 'floating':
      return { type: 'floating', id: pane.placement.windowId }
  }
}

function isPresentIn(state: LayoutState, paneId: PaneId, ref: ContainerRef): boolean {
  const pane = state.panes[paneId]
  if (!pane || pane.hidden) return false
  const p = pane.placement
  switch (ref.type) {
    case 'group':
      return p.type === 'tiled'
    case 'edge':
      return p.type === 'edge' && p.edge === ref.edge
    case 'floating':
      return p.type === 'floating' && p.windowId === ref.id
  }
}

/** The panes actually shown in a container, in tab order. */
export function presentPanes(state: LayoutState, ref: ContainerRef): PaneId[] {
  const container = getContainer(state, ref)
  if (!container) return []
  return container.panes.filter((id) => isPresentIn(state, id, ref))
}

export function isGroupVacant(state: LayoutState, group: GroupNode): boolean {
  return !group.panes.some((id) => isPresentIn(state, id, { type: 'group', id: group.id }))
}

/** A node is vacant when none of its groups shows a pane. Vacant nodes take no space. */
export function isNodeVacant(state: LayoutState, node: LayoutNode): boolean {
  if (node.type === 'group') return isGroupVacant(state, node)
  return node.children.every((child) => isNodeVacant(state, child))
}

/** The pane that last had the user's attention and is still on screen. */
export function focusedPane(state: LayoutState): PaneId | undefined {
  return (state.focus ?? []).find((id) => isPaneVisible(state, id))
}

/** Hidden panes, in the order they were added. */
export function hiddenPanes(state: LayoutState): PaneId[] {
  return Object.keys(state.panes).filter((id) => state.panes[id]!.hidden)
}

/** Whether the pane's content is on screen: placed, not hidden, and the active tab of an open container. */
export function isPaneVisible(state: LayoutState, paneId: PaneId): boolean {
  const pane = state.panes[paneId]
  if (!pane || pane.hidden) return false
  const ref = paneContainerRef(state, paneId)
  if (!ref) return false
  const container = getContainer(state, ref)
  if (!container || container.active !== paneId) return false
  return ref.type !== 'edge' || state.edges[ref.edge].open
}
