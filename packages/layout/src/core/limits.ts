import { isNodeVacant } from './selectors.ts'
import type { LayoutNode, LayoutState } from './types.ts'

/** Size limits of a node in pixels. A maximum of `Infinity` means none. */
export interface Limits {
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}

/**
 * The size limits of a node. A group's are its own. A split's follow from the
 * children it shows: along its axis they add up, with `sashSize` for each
 * divider between them; across it the tightest child decides.
 */
export function nodeLimits(state: LayoutState, node: LayoutNode, sashSize: number): Limits {
  if (node.type === 'group') {
    const { minWidth = 0, maxWidth = Infinity, minHeight = 0, maxHeight = Infinity } = node.size ?? {}
    return { minWidth, maxWidth, minHeight, maxHeight }
  }
  const shown = node.children
    .filter((child) => !isNodeVacant(state, child))
    .map((child) => nodeLimits(state, child, sashSize))
  if (shown.length === 0) return { minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity }

  const sashes = (shown.length - 1) * sashSize
  const sum = (key: keyof Limits) => shown.reduce((total, limits) => total + limits[key], sashes)
  const tightestMin = (key: keyof Limits) => Math.max(...shown.map((limits) => limits[key]))
  const tightestMax = (key: keyof Limits) => Math.min(...shown.map((limits) => limits[key]))
  return node.orientation === 'row'
    ? {
        minWidth: sum('minWidth'),
        maxWidth: sum('maxWidth'),
        minHeight: tightestMin('minHeight'),
        maxHeight: Math.max(tightestMax('maxHeight'), tightestMin('minHeight')),
      }
    : {
        minWidth: tightestMin('minWidth'),
        maxWidth: Math.max(tightestMax('maxWidth'), tightestMin('minWidth')),
        minHeight: sum('minHeight'),
        maxHeight: sum('maxHeight'),
      }
}
