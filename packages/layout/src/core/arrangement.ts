import type { LayoutNode, LayoutState } from './types.ts'

/**
 * Whether two states describe the same arrangement on screen. Generated group,
 * split and window ids are ignored, and weights are compared as shares of
 * their split. So a move that only swaps one group for an identical new one
 * counts as no change.
 */
export function isSameArrangement(a: LayoutState, b: LayoutState): boolean {
  return a === b || canonical(a) === canonical(b)
}

function canonical(state: LayoutState): string {
  const windows = new Map(state.floating.map((win, index) => [win.id, `w${index}`]))

  const tree = (node: LayoutNode, share: number): unknown => {
    const weight = Math.round(share * 1e9) / 1e9
    if (node.type === 'group') return { weight, panes: node.panes, active: node.active }
    const total = node.children.reduce((sum, child) => sum + child.weight, 0)
    return {
      weight,
      orientation: node.orientation,
      children: node.children.map((child) => tree(child, child.weight / total)),
    }
  }

  return JSON.stringify(
    {
      root: state.root && tree(state.root, 1),
      edges: state.edges,
      floating: state.floating.map(({ id: _id, ...win }) => win),
      panes: state.panes,
    },
    (key, value) => (key === 'windowId' ? (windows.get(value) ?? value) : value),
  )
}
