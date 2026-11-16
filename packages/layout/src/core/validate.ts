import { groups, walk } from './tree.ts'
import { getContainer, presentPanes } from './selectors.ts'
import { EDGES } from './types.ts'
import type { ContainerRef, LayoutState, PaneId } from './types.ts'

/** Returns a description of every broken invariant. An empty array means the state is valid. */
export function validateLayout(state: LayoutState): string[] {
  const errors: string[] = []
  const nodeIds = new Set<string>()
  const homeOf = new Map<PaneId, string>()

  for (const node of walk(state.root)) {
    if (nodeIds.has(node.id)) errors.push(`duplicate node id "${node.id}"`)
    nodeIds.add(node.id)
    if (!(Number.isFinite(node.weight) && node.weight > 0)) {
      errors.push(`node "${node.id}" has invalid weight ${node.weight}`)
    }
    if (node.type === 'split') {
      if (node.children.length < 2) errors.push(`split "${node.id}" has fewer than two children`)
      for (const child of node.children) {
        if (child.type === 'split' && child.orientation === node.orientation) {
          errors.push(`split "${child.id}" repeats the orientation of its parent`)
        }
      }
    } else {
      if (node.panes.length === 0) errors.push(`group "${node.id}" is empty`)
      const size = node.size ?? {}
      for (const value of Object.values(size)) {
        if (!(Number.isFinite(value) && value >= 0)) errors.push(`group "${node.id}" has an invalid size limit`)
      }
      if ((size.minWidth ?? 0) > (size.maxWidth ?? Infinity) || (size.minHeight ?? 0) > (size.maxHeight ?? Infinity)) {
        errors.push(`group "${node.id}" has a minimum size above its maximum`)
      }
      for (const id of node.panes) {
        if (homeOf.has(id)) errors.push(`pane "${id}" is in more than one group`)
        homeOf.set(id, node.id)
      }
    }
  }

  const windowIds = new Set<string>()
  for (const win of state.floating) {
    if (windowIds.has(win.id)) errors.push(`duplicate window id "${win.id}"`)
    windowIds.add(win.id)
    if (win.panes.length === 0) errors.push(`window "${win.id}" is empty`)
  }

  const refs: ContainerRef[] = [
    ...[...groups(state.root)].map((g): ContainerRef => ({ type: 'group', id: g.id })),
    ...EDGES.map((edge): ContainerRef => ({ type: 'edge', edge })),
    ...state.floating.map((w): ContainerRef => ({ type: 'floating', id: w.id })),
  ]
  for (const ref of refs) {
    const container = getContainer(state, ref)!
    const label = ref.type === 'edge' ? `edge "${ref.edge}"` : `${ref.type} "${ref.id}"`
    if (new Set(container.panes).size !== container.panes.length) {
      errors.push(`${label} lists a pane twice`)
    }
    for (const id of container.panes) {
      if (!state.panes[id]) errors.push(`${label} lists unknown pane "${id}"`)
    }
    const present = presentPanes(state, ref)
    if (container.active === null) {
      if (present.length > 0) errors.push(`${label} shows panes but has no active pane`)
    } else if (!present.includes(container.active)) {
      errors.push(`${label} has active pane "${container.active}" that is not shown there`)
    }
  }

  for (const [id, pane] of Object.entries(state.panes)) {
    const p = pane.placement
    if (p.type === 'tiled') {
      if (!homeOf.has(id)) errors.push(`tiled pane "${id}" is in no group`)
    } else if (p.type === 'edge') {
      if (!state.edges[p.edge].panes.includes(id)) {
        errors.push(`pane "${id}" is placed on edge "${p.edge}" but not listed there`)
      }
    } else {
      const win = state.floating.find((w) => w.id === p.windowId)
      if (!win?.panes.includes(id)) {
        errors.push(`pane "${id}" is placed in window "${p.windowId}" but not listed there`)
      }
    }
    for (const edge of EDGES) {
      const listed = state.edges[edge].panes.includes(id)
      if (listed && !(p.type === 'edge' && p.edge === edge)) {
        errors.push(`pane "${id}" is listed on edge "${edge}" but placed elsewhere`)
      }
    }
    for (const win of state.floating) {
      if (win.panes.includes(id) && !(p.type === 'floating' && p.windowId === win.id)) {
        errors.push(`pane "${id}" is listed in window "${win.id}" but placed elsewhere`)
      }
    }
  }

  const focus = state.focus ?? []
  if (new Set(focus).size !== focus.length) errors.push('the focus history lists a pane twice')
  for (const id of focus) {
    if (!state.panes[id]) errors.push(`the focus history lists unknown pane "${id}"`)
  }

  return errors
}
