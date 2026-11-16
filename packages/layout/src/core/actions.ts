import { share } from './share.ts'
import { getContainer, paneContainerRef, presentPanes } from './selectors.ts'
import {
  findGroup,
  findHomeGroup,
  groups,
  insertAtRoot,
  insertBeside,
  normalizeTree,
  walk,
} from './tree.ts'
import { EDGES } from './types.ts'
import type {
  Container,
  ContainerRef,
  Edge,
  EdgeDock,
  GroupNode,
  LayoutState,
  NodeId,
  PaneId,
  Rect,
  Target,
  WindowId,
} from './types.ts'

const DEFAULT_FLOATING_RECT: Rect = { x: 80, y: 80, width: 480, height: 320 }

/**
 * Run a mutation on a private copy of the state, restore the invariants, and
 * share unchanged subtrees with the previous state.
 */
function produce(state: LayoutState, recipe: (draft: LayoutState) => void): LayoutState {
  const draft = structuredClone(state)
  recipe(draft)
  normalize(draft)
  return share(state, draft)
}

function normalize(draft: LayoutState): void {
  draft.root = normalizeTree(draft.root)
  draft.floating = draft.floating.filter((w) => w.panes.length > 0)

  const refs: ContainerRef[] = [
    ...[...groups(draft.root)].map((g): ContainerRef => ({ type: 'group', id: g.id })),
    ...EDGES.map((edge): ContainerRef => ({ type: 'edge', edge })),
    ...draft.floating.map((w): ContainerRef => ({ type: 'floating', id: w.id })),
  ]
  for (const ref of refs) {
    const container = getContainer(draft, ref)!
    const present = presentPanes(draft, ref)
    if (container.active !== null && present.includes(container.active)) continue
    container.active = nextActive(container, present)
  }
}

/** The shown pane closest after the old active tab, else closest before it. */
function nextActive(container: Container, present: PaneId[]): PaneId | null {
  if (present.length === 0) return null
  const from = container.active === null ? -1 : container.panes.indexOf(container.active)
  if (from === -1) return present[0]!
  const after = container.panes.slice(from + 1).find((id) => present.includes(id))
  if (after) return after
  return container.panes.slice(0, from).findLast((id) => present.includes(id)) ?? null
}

function newId(draft: LayoutState, prefix: string): string {
  return `${prefix}${draft.nextId++}`
}

function requirePane(state: LayoutState, paneId: PaneId) {
  const pane = state.panes[paneId]
  if (!pane) throw new Error(`Unknown pane "${paneId}"`)
  return pane
}

function requireGroup(state: LayoutState, groupId: NodeId): GroupNode {
  const group = findGroup(state.root, groupId)
  if (!group) throw new Error(`Unknown group "${groupId}"`)
  return group
}

function removeFromList(container: Container, paneId: PaneId): void {
  const index = container.panes.indexOf(paneId)
  if (index === -1) return
  if (container.active === paneId) {
    // Point at the tab that will take this one's place, so normalize can keep it or move on.
    container.active = container.panes[index + 1] ?? container.panes[index - 1] ?? null
  }
  container.panes.splice(index, 1)
}

/**
 * Take the pane out of the edge dock or floating window it is placed in. A
 * tiled pane stays listed in its home group so it can return there.
 */
function leavePlacement(draft: LayoutState, paneId: PaneId): void {
  const pane = draft.panes[paneId]!
  const p = pane.placement
  if (p.type === 'edge') {
    removeFromList(draft.edges[p.edge], paneId)
  } else if (p.type === 'floating') {
    const win = draft.floating.find((w) => w.id === p.windowId)
    if (win) {
      pane.floatingRect = win.rect
      removeFromList(win, paneId)
    }
  }
}

function leaveHome(draft: LayoutState, paneId: PaneId): void {
  const home = findHomeGroup(draft.root, paneId)
  if (home) removeFromList(home, paneId)
}

/** Translate an index among the shown panes into an index in the full list. */
function listIndex(draft: LayoutState, ref: ContainerRef, index: number | undefined): number {
  const container = getContainer(draft, ref)!
  const present = presentPanes(draft, ref)
  if (index === undefined || index >= present.length) return container.panes.length
  return container.panes.indexOf(present[Math.max(0, index)]!)
}

function place(draft: LayoutState, paneId: PaneId, target: Target): void {
  const pane = draft.panes[paneId]!

  switch (target.type) {
    case 'group': {
      requireGroup(draft, target.groupId)
      leavePlacement(draft, paneId)
      leaveHome(draft, paneId)
      const group = requireGroup(draft, target.groupId)
      const ref: ContainerRef = { type: 'group', id: group.id }
      pane.placement = { type: 'tiled' }
      pane.hidden = false
      group.panes.splice(listIndex(draft, ref, target.index), 0, paneId)
      group.active = paneId
      return
    }
    case 'split': {
      const anchor = requireGroup(draft, target.groupId)
      if (anchor.panes.length === 1 && anchor.panes[0] === paneId) {
        // Splitting a group around its only pane leaves the tree as it is.
        leavePlacement(draft, paneId)
        pane.placement = { type: 'tiled' }
        pane.hidden = false
        anchor.active = paneId
        return
      }
      leavePlacement(draft, paneId)
      leaveHome(draft, paneId)
      pane.placement = { type: 'tiled' }
      pane.hidden = false
      const group: GroupNode = {
        type: 'group',
        id: newId(draft, 'g'),
        weight: 1,
        panes: [paneId],
        active: paneId,
      }
      draft.root = insertBeside(draft.root!, anchor.id, target.side, group, () => newId(draft, 's'))
      return
    }
    case 'root': {
      leavePlacement(draft, paneId)
      leaveHome(draft, paneId)
      pane.placement = { type: 'tiled' }
      pane.hidden = false
      // Drop groups emptied by the move first, so the new group is not merged into a stale root.
      draft.root = normalizeTree(draft.root)
      const group: GroupNode = {
        type: 'group',
        id: newId(draft, 'g'),
        weight: 1,
        panes: [paneId],
        active: paneId,
      }
      draft.root = insertAtRoot(draft.root, target.side, group, () => newId(draft, 's'))
      return
    }
    case 'edge': {
      leavePlacement(draft, paneId)
      const dock = draft.edges[target.edge]
      const ref: ContainerRef = { type: 'edge', edge: target.edge }
      pane.placement = { type: 'edge', edge: target.edge }
      pane.hidden = false
      dock.panes.splice(listIndex(draft, ref, target.index), 0, paneId)
      dock.active = paneId
      dock.open = true
      return
    }
    case 'floating': {
      if (target.windowId !== undefined) {
        const exists = draft.floating.some((w) => w.id === target.windowId)
        if (!exists) throw new Error(`Unknown window "${target.windowId}"`)
      }
      leavePlacement(draft, paneId)
      // The pane may have been the last one in the window it is joining.
      let win = draft.floating.find((w) => w.id === target.windowId)
      if (win) {
        draft.floating.splice(draft.floating.indexOf(win), 1)
        if (target.rect) win.rect = target.rect
      } else {
        win = {
          id: target.windowId ?? newId(draft, 'w'),
          panes: [],
          active: null,
          rect: target.rect ?? pane.floatingRect ?? DEFAULT_FLOATING_RECT,
        }
      }
      win.panes.push(paneId)
      win.active = paneId
      draft.floating.push(win)
      pane.placement = { type: 'floating', windowId: win.id }
      pane.hidden = false
      return
    }
  }
}

/** Add a new pane at the target. Throws if the id is already in use. */
export function addPane(state: LayoutState, paneId: PaneId, target: Target): LayoutState {
  if (state.panes[paneId]) throw new Error(`Pane "${paneId}" already exists`)
  return produce(state, (draft) => {
    draft.panes[paneId] = { placement: { type: 'tiled' }, hidden: false }
    place(draft, paneId, target)
  })
}

/**
 * Move a pane to the target and show it there.
 *
 * Moving a tiled pane to an edge or a floating window keeps its slot in the
 * tiled tree, so `restorePane` puts it back. Moving to a tiled target makes
 * that target its new home.
 */
export function movePane(state: LayoutState, paneId: PaneId, target: Target): LayoutState {
  requirePane(state, paneId)
  return produce(state, (draft) => place(draft, paneId, target))
}

/**
 * Return a docked, floating or hidden pane to the tiled tree. It goes back to
 * the group it left. A pane that never had one, or whose group has since been
 * removed, joins the first group that shows a pane, or becomes the tree's
 * first group.
 */
export function restorePane(state: LayoutState, paneId: PaneId): LayoutState {
  requirePane(state, paneId)
  return produce(state, (draft) => {
    const pane = draft.panes[paneId]!
    const home = findHomeGroup(draft.root, paneId)
    if (home) {
      leavePlacement(draft, paneId)
      pane.placement = { type: 'tiled' }
      pane.hidden = false
      home.active = paneId
      return
    }
    const fallback = [...groups(draft.root)].find(
      (g) => presentPanes(draft, { type: 'group', id: g.id }).length > 0,
    )
    place(
      draft,
      paneId,
      fallback ? { type: 'group', groupId: fallback.id } : { type: 'root', side: 'right' },
    )
  })
}

/** Remove a pane from the layout entirely. */
export function removePane(state: LayoutState, paneId: PaneId): LayoutState {
  requirePane(state, paneId)
  return produce(state, (draft) => {
    leavePlacement(draft, paneId)
    leaveHome(draft, paneId)
    delete draft.panes[paneId]
  })
}

/** Hide a pane without changing where it is placed. */
export function hidePane(state: LayoutState, paneId: PaneId): LayoutState {
  requirePane(state, paneId)
  return produce(state, (draft) => {
    draft.panes[paneId]!.hidden = true
  })
}

/** Show a pane where it is placed: unhide it, make it the active tab, open or raise its container. */
export function showPane(state: LayoutState, paneId: PaneId): LayoutState {
  requirePane(state, paneId)
  return produce(state, (draft) => {
    const pane = draft.panes[paneId]!
    pane.hidden = false
    const ref = paneContainerRef(draft, paneId)
    if (!ref) return
    getContainer(draft, ref)!.active = paneId
    if (ref.type === 'edge') draft.edges[ref.edge].open = true
    if (ref.type === 'floating') raise(draft, ref.id)
  })
}

function raise(draft: LayoutState, windowId: WindowId): void {
  const index = draft.floating.findIndex((w) => w.id === windowId)
  if (index === -1) throw new Error(`Unknown window "${windowId}"`)
  draft.floating.push(...draft.floating.splice(index, 1))
}

/** Bring a floating window to the front. */
export function raiseWindow(state: LayoutState, windowId: WindowId): LayoutState {
  return produce(state, (draft) => raise(draft, windowId))
}

/** Move or resize a floating window. */
export function setWindowRect(state: LayoutState, windowId: WindowId, rect: Rect): LayoutState {
  return produce(state, (draft) => {
    const win = draft.floating.find((w) => w.id === windowId)
    if (!win) throw new Error(`Unknown window "${windowId}"`)
    win.rect = rect
  })
}

/** Change an edge dock's size, mode, or whether it is open. */
export function updateEdge(
  state: LayoutState,
  edge: Edge,
  patch: Partial<Pick<EdgeDock, 'open' | 'size' | 'mode'>>,
): LayoutState {
  return produce(state, (draft) => {
    Object.assign(draft.edges[edge], patch)
  })
}

/** Set the weights of tiled nodes by id. Non-positive and non-finite values are ignored. */
export function setWeights(state: LayoutState, weights: Record<NodeId, number>): LayoutState {
  return produce(state, (draft) => {
    for (const node of walk(draft.root)) {
      const weight = weights[node.id]
      if (weight !== undefined && Number.isFinite(weight) && weight > 0) node.weight = weight
    }
  })
}
