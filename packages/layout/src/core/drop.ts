import type { ContainerRef, Edge, PaneId, Rect, Target } from './types.ts'

export interface Point {
  x: number
  y: number
}

/** A container that can receive a dragged pane, with where it and its tabs are. */
export interface DropRegion {
  container: ContainerRef
  rect: Rect
  /** The tabs shown in the container, in order. May include the dragged pane's own tab. */
  tabs: { paneId: PaneId; rect: Rect }[]
  /** Regions above the tiled area: floating windows and overlay edge docks. */
  raised: boolean
}

export interface DropInput {
  point: Point
  /** The pane being dragged. */
  dragged: PaneId
  /** Every region that can take the pane, front to back. */
  regions: DropRegion[]
  /** The area the tiled tree fills, or `null` when the layout has none. */
  tiled: Rect | null
  /** Set to ask for a new floating window of this size at the pointer. */
  float?: { width: number; height: number; bounds: Rect } | null
}

export type DropZone = 'tab' | 'center' | 'float' | Edge | `root-${Edge}`

export interface Drop {
  target: Target
  /** Where to draw the drop indicator, in the same coordinates as the input. */
  indicator: Rect
  zone: DropZone
}

export interface DropOptions {
  /** Share of a group, from each edge, that splits it instead of adding a tab. */
  edgeFraction?: number
  /** Depth in pixels of the band along the tiled area's edges that splits the whole tree. */
  rootBand?: number
  /** Share of the tiled area the indicator covers for a drop on a root band. */
  rootIndicatorFraction?: number
}

export type DropResolver = (input: DropInput) => Drop | null

const INSERTION_LINE = 2

const contains = (rect: Rect, p: Point) =>
  p.x >= rect.x && p.x < rect.x + rect.width && p.y >= rect.y && p.y < rect.y + rect.height

function nearestEdge(rect: Rect, p: Point): { edge: Edge; distance: number; fraction: number } {
  const candidates: { edge: Edge; distance: number; fraction: number }[] = [
    { edge: 'left', distance: p.x - rect.x, fraction: (p.x - rect.x) / rect.width },
    { edge: 'right', distance: rect.x + rect.width - p.x, fraction: (rect.x + rect.width - p.x) / rect.width },
    { edge: 'top', distance: p.y - rect.y, fraction: (p.y - rect.y) / rect.height },
    { edge: 'bottom', distance: rect.y + rect.height - p.y, fraction: (rect.y + rect.height - p.y) / rect.height },
  ]
  return candidates.reduce((best, c) => (c.fraction < best.fraction ? c : best))
}

function sideRect(rect: Rect, edge: Edge, fraction: number): Rect {
  const width = rect.width * fraction
  const height = rect.height * fraction
  switch (edge) {
    case 'left':
      return { ...rect, width }
    case 'right':
      return { ...rect, x: rect.x + rect.width - width, width }
    case 'top':
      return { ...rect, height }
    case 'bottom':
      return { ...rect, y: rect.y + rect.height - height, height }
  }
}

/**
 * Where among a container's tabs the pointer is, or `null` when it is not over
 * the tab strip. The strip is the band the tabs occupy, across the whole
 * container, so the empty space beside the last tab counts.
 */
function tabDrop(region: DropRegion, point: Point, dragged: PaneId): { index: number; indicator: Rect } | null {
  const tabs = region.tabs
  if (tabs.length === 0) return null
  const xs = tabs.map((t) => t.rect.x + t.rect.width / 2)
  const ys = tabs.map((t) => t.rect.y + t.rect.height / 2)
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  const vertical = tabs.length > 1 && spread(ys) > spread(xs)

  // The tabs on the pointer's line: one row of a horizontal strip, or one column of a vertical one.
  const line = tabs.filter((t) =>
    vertical
      ? point.x >= t.rect.x && point.x < t.rect.x + t.rect.width
      : point.y >= t.rect.y && point.y < t.rect.y + t.rect.height,
  )
  if (line.length === 0) return null

  const start = (r: Rect) => (vertical ? r.y : r.x)
  const size = (r: Rect) => (vertical ? r.height : r.width)
  const at = vertical ? point.y : point.x
  const next = line.find((t) => at < start(t.rect) + size(t.rect) / 2)
  const last = line[line.length - 1]!

  // Positions count the other tabs only, as the Target index does.
  const others = tabs.filter((t) => t.paneId !== dragged)
  const anchor = next ?? tabs[tabs.indexOf(last) + 1]
  const after = anchor ? tabs.slice(tabs.indexOf(anchor)).find((t) => t.paneId !== dragged) : undefined
  const index = after ? others.indexOf(after) : others.length

  const edge = next ? start(next.rect) : start(last.rect) + size(last.rect)
  const reference = next?.rect ?? last.rect
  const indicator: Rect = vertical
    ? { x: reference.x, y: edge - INSERTION_LINE / 2, width: reference.width, height: INSERTION_LINE }
    : { x: edge - INSERTION_LINE / 2, y: reference.y, width: INSERTION_LINE, height: reference.height }
  return { index, indicator }
}

function containerTarget(container: ContainerRef, index?: number): Target {
  const position = index === undefined ? {} : { index }
  switch (container.type) {
    case 'group':
      return { type: 'group', groupId: container.id, ...position }
    case 'edge':
      return { type: 'edge', edge: container.edge, ...position }
    case 'floating':
      return { type: 'floating', windowId: container.id, ...position }
  }
}

/**
 * Decide where a dragged pane would land for a pointer position. Pure geometry:
 * it never looks at the DOM, so content covering a region does not matter.
 *
 * Order of precedence: a requested floating window; then regions front to back
 * (floating windows, overlay docks); then the bands along the tiled area's
 * edges, which split the whole tree; then tiled groups and pinned docks. Inside
 * a region the tab strip gives a tab position, the edges of a group split it,
 * and anywhere else adds the pane as the last tab.
 */
export function resolveDrop(input: DropInput, options: DropOptions = {}): Drop | null {
  const { edgeFraction = 0.25, rootBand = 16, rootIndicatorFraction = 0.25 } = options
  const { point, dragged, regions, tiled, float } = input

  if (float) {
    const { bounds } = float
    const width = Math.min(float.width, bounds.width)
    const height = Math.min(float.height, bounds.height)
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))
    const rect: Rect = {
      // Under the pointer, as if held by the middle of its title bar.
      x: clamp(point.x - width / 2, bounds.x, bounds.x + bounds.width - width),
      y: clamp(point.y - 16, bounds.y, bounds.y + bounds.height - height),
      width,
      height,
    }
    return { target: { type: 'floating', rect }, indicator: rect, zone: 'float' }
  }

  const inRegion = (region: DropRegion): Drop | null => {
    if (!contains(region.rect, point)) return null
    const tab = tabDrop(region, point, dragged)
    if (tab) return { target: containerTarget(region.container, tab.index), indicator: tab.indicator, zone: 'tab' }
    if (region.container.type === 'group') {
      const near = nearestEdge(region.rect, point)
      if (near.fraction < edgeFraction) {
        return {
          target: { type: 'split', groupId: region.container.id, side: near.edge },
          indicator: sideRect(region.rect, near.edge, 0.5),
          zone: near.edge,
        }
      }
    }
    return { target: containerTarget(region.container), indicator: region.rect, zone: 'center' }
  }

  for (const region of regions) {
    if (!region.raised) continue
    const drop = inRegion(region)
    if (drop) return drop
  }

  const base = regions.filter((region) => !region.raised)
  if (tiled && contains(tiled, point)) {
    const overTabs = base.some((region) => contains(region.rect, point) && tabDrop(region, point, dragged))
    const near = nearestEdge(tiled, point)
    if (!overTabs && near.distance < rootBand) {
      return {
        target: { type: 'root', side: near.edge },
        indicator: sideRect(tiled, near.edge, rootIndicatorFraction),
        zone: `root-${near.edge}`,
      }
    }
  }

  for (const region of base) {
    const drop = inRegion(region)
    if (drop) return drop
  }

  // An empty tiled area takes the pane as its first group.
  if (tiled && contains(tiled, point)) {
    return { target: { type: 'root', side: 'right' }, indicator: tiled, zone: 'center' }
  }
  return null
}
