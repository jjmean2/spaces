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
 * Limits on the size of a group, in pixels. A dimension whose minimum equals its
 * maximum is fixed: it gets no divider and keeps its size when the layout
 * resizes, which is how a header bar or a sidebar of set width is described.
 */
export interface SizeConstraints {
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
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
  size?: SizeConstraints
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
  /** Panes in the order they were last focused, most recent first. */
  focus?: PaneId[]
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

/**
 * Where `addPane` and `movePane` put a pane.
 *
 * An `index` is a position among the panes shown in the container, counted
 * without the pane being moved. So moving a tab within its own container to
 * `index: 2` makes it the third tab. Omit it to add the pane at the end.
 */
export type Target =
  /** Into an existing group as a tab. */
  | { type: 'group'; groupId: NodeId; index?: number }
  /** Into a new group created beside an existing one. */
  | { type: 'split'; groupId: NodeId; side: Edge }
  /** Into a new group spanning one side of the whole tiled tree. */
  | { type: 'root'; side: Edge }
  | { type: 'edge'; edge: Edge; index?: number }
  /** Into an existing floating window, or a new one when `windowId` is omitted. */
  | { type: 'floating'; windowId?: WindowId; index?: number; rect?: Rect }
