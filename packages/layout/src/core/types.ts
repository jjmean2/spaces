export type PaneId = string
export type NodeId = string
export type WindowId = string

export type Orientation = 'row' | 'column'
export type Edge = 'left' | 'right' | 'top' | 'bottom'
export const EDGES: readonly Edge[] = ['left', 'right', 'top', 'bottom']

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A leaf of the tiled tree: an ordered list of panes shown one at a time.
 *
 * `panes` lists every pane whose home is this group, including panes that are
 * currently docked to an edge, floating, or hidden. Those stay in the list so
 * that they return to the same slot. Use `presentPanes` to get the panes that
 * are actually shown here.
 */
export interface GroupNode {
  type: 'group'
  id: NodeId
  /** Share of the parent split, relative to its siblings. Any positive number. */
  weight: number
  panes: PaneId[]
  active: PaneId | null
}

export interface SplitNode {
  type: 'split'
  id: NodeId
  weight: number
  orientation: Orientation
  children: LayoutNode[]
}

export type LayoutNode = GroupNode | SplitNode

/** A region attached to one edge of the layout, outside the tiled tree. */
export interface EdgeDock {
  panes: PaneId[]
  active: PaneId | null
  open: boolean
  /** Extent in pixels along the axis perpendicular to the edge. */
  size: number
  /** `pinned` takes space from the tiled tree; `overlay` is drawn above it. */
  mode: 'pinned' | 'overlay'
}

export interface FloatingWindow {
  id: WindowId
  panes: PaneId[]
  active: PaneId | null
  rect: Rect
}

export type Placement =
  | { type: 'tiled' }
  | { type: 'edge'; edge: Edge }
  | { type: 'floating'; windowId: WindowId }

export interface PaneState {
  placement: Placement
  /** Hidden panes keep their placement and come back to it when shown. */
  hidden: boolean
  /** Last floating geometry, reused the next time the pane floats. */
  floatingRect?: Rect
}

export interface LayoutState {
  version: 1
  root: LayoutNode | null
  edges: Record<Edge, EdgeDock>
  /** Back to front: the last window is on top. */
  floating: FloatingWindow[]
  panes: Record<PaneId, PaneState>
  /** Counter for generated node and window ids. */
  nextId: number
}

export type ContainerRef =
  | { type: 'group'; id: NodeId }
  | { type: 'edge'; edge: Edge }
  | { type: 'floating'; id: WindowId }

export interface Container {
  panes: PaneId[]
  active: PaneId | null
}

/** Where `addPane` and `movePane` put a pane. */
export type Target =
  /** Into an existing group as a tab. `index` counts the panes shown in the group. */
  | { type: 'group'; groupId: NodeId; index?: number }
  /** Into a new group created beside an existing one. */
  | { type: 'split'; groupId: NodeId; side: Edge }
  /** Into a new group spanning one side of the whole tiled tree. */
  | { type: 'root'; side: Edge }
  | { type: 'edge'; edge: Edge; index?: number }
  /** Into an existing floating window, or a new one when `windowId` is omitted. */
  | { type: 'floating'; windowId?: WindowId; rect?: Rect }
