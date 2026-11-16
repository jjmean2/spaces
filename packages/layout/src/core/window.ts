import type { Rect } from './types.ts'

/** Which edges of a floating window a resize drags. A corner is two of them. */
export interface ResizeEdges {
  left?: boolean
  right?: boolean
  top?: boolean
  bottom?: boolean
}

/**
 * The rectangle of a floating window after dragging some of its edges by
 * (`dx`, `dy`). The opposite edges stay where they are, and the window does not
 * shrink below `min`.
 */
export function resizeWindowRect(
  rect: Rect,
  edges: ResizeEdges,
  dx: number,
  dy: number,
  min: { width: number; height: number },
): Rect {
  let { x, y, width, height } = rect
  if (edges.right) width = Math.max(min.width, rect.width + dx)
  if (edges.bottom) height = Math.max(min.height, rect.height + dy)
  if (edges.left) {
    width = Math.max(min.width, rect.width - dx)
    x = rect.x + rect.width - width
  }
  if (edges.top) {
    height = Math.max(min.height, rect.height - dy)
    y = rect.y + rect.height - height
  }
  return { x, y, width, height }
}

/**
 * Where to draw a floating window so that it can always be reached. Its size is
 * kept. It is moved only as far as needed for `reach` pixels of its top strip to
 * stay inside `bounds`, so it can be dragged back. The stored rectangle is left
 * alone: when the layout grows again the window is back where the user put it.
 */
export function clampWindowRect(rect: Rect, bounds: { width: number; height: number }, reach = 48): Rect {
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high))
  const visible = Math.min(reach, rect.width)
  return {
    ...rect,
    x: clamp(rect.x, visible - rect.width, bounds.width - visible),
    y: clamp(rect.y, 0, bounds.height - Math.min(reach, rect.height)),
  }
}
