import { share } from './share.ts'
import { normalizeTree } from './tree.ts'
import { validateLayout } from './validate.ts'
import { EDGES } from './types.ts'
import type {
  Edge,
  EdgeDock,
  LayoutNode,
  LayoutState,
  Orientation,
  PaneId,
  PaneState,
  SizeConstraints,
} from './types.ts'

export type NodeSpec =
  | { type: 'group'; panes: PaneId[]; active?: PaneId; weight?: number; size?: SizeConstraints }
  | { type: 'split'; orientation: Orientation; children: NodeSpec[]; weight?: number }

export interface LayoutSpec {
  root?: NodeSpec
  edges?: Partial<Record<Edge, Partial<Omit<EdgeDock, 'panes'>> & { panes: PaneId[] }>>
}

export function group(
  panes: PaneId[],
  options: { active?: PaneId; weight?: number; size?: SizeConstraints } = {},
): NodeSpec {
  return { type: 'group', panes, ...options }
}

export function row(...children: NodeSpec[]): NodeSpec {
  return { type: 'split', orientation: 'row', children }
}

export function column(...children: NodeSpec[]): NodeSpec {
  return { type: 'split', orientation: 'column', children }
}

const DEFAULT_EDGE_SIZE: Record<Edge, number> = { left: 260, right: 260, top: 200, bottom: 200 }

/** Build a layout state from a declarative description. */
export function createLayout(spec: LayoutSpec = {}): LayoutState {
  let nextId = 1
  const panes: Record<PaneId, PaneState> = {}

  const register = (id: PaneId, pane: PaneState) => {
    if (panes[id]) throw new Error(`Pane "${id}" appears more than once`)
    panes[id] = pane
  }

  const build = (node: NodeSpec): LayoutNode => {
    const weight = node.weight ?? 1
    if (node.type === 'group') {
      for (const id of node.panes) register(id, { placement: { type: 'tiled' }, hidden: false })
      return {
        type: 'group',
        id: `g${nextId++}`,
        weight,
        panes: [...node.panes],
        active: node.active ?? node.panes[0] ?? null,
        ...(node.size ? { size: node.size } : {}),
      }
    }
    const id = `s${nextId++}`
    return { type: 'split', id, weight, orientation: node.orientation, children: node.children.map(build) }
  }

  const root = spec.root ? normalizeTree(build(spec.root)) : null

  const edges = {} as Record<Edge, EdgeDock>
  for (const edge of EDGES) {
    const given = spec.edges?.[edge]
    const ids = given?.panes ?? []
    for (const id of ids) register(id, { placement: { type: 'edge', edge }, hidden: false })
    edges[edge] = {
      panes: [...ids],
      active: given?.active ?? ids[0] ?? null,
      open: given?.open ?? ids.length > 0,
      size: given?.size ?? DEFAULT_EDGE_SIZE[edge],
      mode: given?.mode ?? 'pinned',
    }
  }

  return assertValid({ version: 1, root, edges, floating: [], panes, nextId })
}

function assertValid(state: LayoutState): LayoutState {
  const errors = validateLayout(state)
  if (errors.length > 0) throw new Error(`Invalid layout: ${errors.join('; ')}`)
  return state
}

/**
 * Check a layout that was saved earlier, for example one read back from
 * storage, and return it ready to use. Throws if it is not a valid layout.
 */
export function loadLayout(saved: unknown): LayoutState {
  const state = saved as LayoutState
  if (typeof state !== 'object' || state === null || state.version !== 1) {
    throw new Error('Not a saved layout, or saved by an unsupported version')
  }
  try {
    const normalized = { ...state, root: normalizeTree(state.root) }
    return assertValid(share(state, normalized))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid layout')) throw error
    throw new Error('Not a saved layout: its structure could not be read', { cause: error })
  }
}
