import { describe, expect, test } from 'vitest'
import {
  addPane,
  column,
  clampWindowRect,
  createLayout,
  findGroup,
  findHomeGroup,
  focusPane,
  focusedPane,
  group,
  groups,
  hiddenPanes,
  hidePane,
  isNodeVacant,
  isSameArrangement,
  isPaneVisible,
  loadLayout,
  movePane,
  nodeLimits,
  presentPanes,
  raiseWindow,
  removePane,
  resizePair,
  resizeWindowRect,
  restorePane,
  row,
  setGroupSize,
  setWeights,
  setWindowRect,
  showPane,
  updateEdge,
  validateLayout,
} from './index.ts'
import type { LayoutNode, LayoutState } from './index.ts'

/** Compact picture of the tiled tree: `row(a*|b, col(c, d))`. `*` marks the active tab. */
function shape(state: LayoutState): string {
  const draw = (node: LayoutNode): string => {
    if (node.type === 'group') {
      return node.panes.map((id) => (id === node.active ? `${id}*` : id)).join('|')
    }
    return `${node.orientation === 'row' ? 'row' : 'col'}(${node.children.map(draw).join(', ')})`
  }
  return state.root ? draw(state.root) : '(empty)'
}

function valid(state: LayoutState): LayoutState {
  expect(validateLayout(state)).toEqual([])
  return state
}

const groupOf = (state: LayoutState, paneId: string) => findHomeGroup(state.root, paneId)!

describe('createLayout', () => {
  test('builds a tree and registers every pane', () => {
    const state = valid(createLayout({ root: row(group(['a', 'b']), column(group(['c']), group(['d']))) }))
    expect(shape(state)).toBe('row(a*|b, col(c*, d*))')
    expect(Object.keys(state.panes)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('merges nested splits of the same orientation, keeping proportions', () => {
    const state = valid(createLayout({ root: row(group(['a']), row(group(['b']), group(['c']))) }))
    expect(shape(state)).toBe('row(a*, b*, c*)')
    const weights = (state.root as { children: LayoutNode[] }).children.map((c) => c.weight)
    expect(weights).toEqual([1, 0.5, 0.5])
  })

  test('rejects a pane listed twice', () => {
    expect(() => createLayout({ root: row(group(['a']), group(['a'])) })).toThrow(/more than once/)
  })

  test('places panes on edges', () => {
    const state = valid(createLayout({ root: group(['a']), edges: { left: { panes: ['files'], size: 300 } } }))
    expect(state.edges.left).toMatchObject({ panes: ['files'], active: 'files', open: true, size: 300 })
    expect(state.panes.files!.placement).toEqual({ type: 'edge', edge: 'left' })
  })
})

describe('movePane within the tiled tree', () => {
  const base = () => createLayout({ root: row(group(['a', 'b']), group(['c'])) })

  test('moves a tab into another group and activates it', () => {
    const state = valid(movePane(base(), 'a', { type: 'group', groupId: groupOf(base(), 'c').id }))
    expect(shape(state)).toBe('row(b*, c|a*)')
  })

  test('inserts at an index', () => {
    const s = base()
    const state = valid(movePane(s, 'a', { type: 'group', groupId: groupOf(s, 'c').id, index: 0 }))
    expect(shape(state)).toBe('row(b*, a*|c)')
  })

  test('reorders within a group', () => {
    const s = base()
    const state = valid(movePane(s, 'a', { type: 'group', groupId: groupOf(s, 'a').id }))
    expect(shape(state)).toBe('row(b|a*, c*)')
  })

  test('removes the group it empties and collapses the split', () => {
    const s = base()
    const state = valid(movePane(s, 'c', { type: 'group', groupId: groupOf(s, 'a').id }))
    expect(shape(state)).toBe('a|b|c*')
  })

  test('splits along the parent axis as a sibling taking half the share', () => {
    const s = base()
    const state = valid(movePane(s, 'b', { type: 'split', groupId: groupOf(s, 'c').id, side: 'right' }))
    expect(shape(state)).toBe('row(a*, c*, b*)')
    const weights = (state.root as { children: LayoutNode[] }).children.map((c) => c.weight)
    expect(weights).toEqual([1, 0.5, 0.5])
  })

  test('splits across the parent axis by wrapping the target', () => {
    const s = base()
    const state = valid(movePane(s, 'b', { type: 'split', groupId: groupOf(s, 'c').id, side: 'top' }))
    expect(shape(state)).toBe('row(a*, col(b*, c*))')
  })

  test('splitting a group around its only pane changes nothing', () => {
    const s = base()
    // Only the focus history records the move; the tree is the same object.
    const moved = movePane(s, 'c', { type: 'split', groupId: groupOf(s, 'c').id, side: 'left' })
    expect(moved.root).toBe(s.root)
    expect(isSameArrangement(moved, s)).toBe(true)
  })

  test('adds a group along the whole tree', () => {
    const state = valid(movePane(base(), 'b', { type: 'root', side: 'bottom' }))
    expect(shape(state)).toBe('col(row(a*, c*), b*)')
  })

  test('moving the only pane to the root keeps a single group', () => {
    const s = createLayout({ root: group(['a']) })
    expect(shape(valid(movePane(s, 'a', { type: 'root', side: 'left' })))).toBe('a*')
  })

  test('picks the next tab when the active one leaves', () => {
    const s = createLayout({ root: row(group(['a', 'b', 'c'], { active: 'b' }), group(['d'])) })
    const state = valid(movePane(s, 'b', { type: 'group', groupId: groupOf(s, 'd').id }))
    expect(shape(state)).toBe('row(a|c*, d|b*)')
  })

  test('throws for unknown ids', () => {
    expect(() => movePane(base(), 'nope', { type: 'root', side: 'left' })).toThrow(/Unknown pane/)
    expect(() => movePane(base(), 'a', { type: 'group', groupId: 'nope' })).toThrow(/Unknown group/)
  })
})

describe('leaving the tiled tree and coming back', () => {
  const base = () => createLayout({ root: row(group(['a']), group(['b'], { weight: 3 }), group(['c'])) })

  test('a floated pane keeps its slot, which takes no space meanwhile', () => {
    const s = base()
    const home = groupOf(s, 'b')
    const floated = valid(movePane(s, 'b', { type: 'floating' }))
    expect(floated.panes.b!.placement.type).toBe('floating')
    expect(findGroup(floated.root, home.id)).toMatchObject({ panes: ['b'], active: null, weight: 3 })
    expect(isNodeVacant(floated, findGroup(floated.root, home.id)!)).toBe(true)
    expect(presentPanes(floated, { type: 'group', id: home.id })).toEqual([])
    expect(floated.floating).toHaveLength(1)
  })

  test('restorePane returns it to the same slot with the same share', () => {
    const s = base()
    const restored = valid(restorePane(movePane(s, 'b', { type: 'floating' }), 'b'))
    expect(restored.root).toEqual(s.root)
    expect(restored.floating).toEqual([])
    expect(restored.panes.b!.placement).toEqual({ type: 'tiled' })
  })

  test('the slot survives the tree being restructured in between', () => {
    let s = base()
    s = movePane(s, 'b', { type: 'edge', edge: 'left' })
    s = movePane(s, 'c', { type: 'split', groupId: groupOf(s, 'a').id, side: 'bottom' })
    s = valid(addPane(s, 'd', { type: 'root', side: 'right' }))
    expect(shape(s)).toBe('row(col(a*, c*), b, d*)')
    s = valid(restorePane(s, 'b'))
    expect(shape(s)).toBe('row(col(a*, c*), b*, d*)')
    expect(groupOf(s, 'b').weight).toBe(3)
    expect(s.edges.left.panes).toEqual([])
  })

  test('a tab that leaves returns to its position among the other tabs', () => {
    let s = createLayout({ root: group(['a', 'b', 'c'], { active: 'b' }) })
    s = valid(movePane(s, 'b', { type: 'floating' }))
    expect(presentPanes(s, { type: 'group', id: groupOf(s, 'a').id })).toEqual(['a', 'c'])
    expect(groupOf(s, 'a').active).toBe('c')
    s = valid(restorePane(s, 'b'))
    expect(shape(s)).toBe('a|b*|c')
  })

  test('moving to a tiled target gives up the old slot', () => {
    let s = base()
    s = movePane(s, 'b', { type: 'floating' })
    s = valid(movePane(s, 'b', { type: 'group', groupId: groupOf(s, 'a').id }))
    expect(shape(s)).toBe('row(a|b*, c*)')
  })

  test('a pane that never had a slot joins the first shown group', () => {
    let s = createLayout({ root: row(group(['a']), group(['b'])), edges: { left: { panes: ['files'] } } })
    s = valid(restorePane(s, 'files'))
    expect(shape(s)).toBe('row(a|files*, b*)')
  })

  test('restoring into an empty tree creates the first group', () => {
    let s = createLayout({ edges: { left: { panes: ['files'] } } })
    s = valid(restorePane(s, 'files'))
    expect(shape(s)).toBe('files*')
  })

  test('removing a pane that is away also removes its empty slot', () => {
    let s = base()
    s = movePane(s, 'b', { type: 'floating' })
    s = valid(removePane(s, 'b'))
    expect(shape(s)).toBe('row(a*, c*)')
    expect(s.floating).toEqual([])
    expect(s.panes.b).toBeUndefined()
  })
})

describe('edge docks', () => {
  test('docking opens the edge and activates the pane', () => {
    let s = createLayout({ root: group(['a', 'b']) })
    s = valid(updateEdge(s, 'right', { open: false, mode: 'overlay' }))
    s = valid(movePane(s, 'b', { type: 'edge', edge: 'right' }))
    expect(s.edges.right).toMatchObject({ panes: ['b'], active: 'b', open: true, mode: 'overlay' })
    expect(isPaneVisible(s, 'b')).toBe(true)
  })

  test('a closed edge keeps its panes but does not show them', () => {
    let s = createLayout({ root: group(['a']), edges: { left: { panes: ['files'] } } })
    s = valid(updateEdge(s, 'left', { open: false }))
    expect(isPaneVisible(s, 'files')).toBe(false)
    expect(s.edges.left.active).toBe('files')
    s = valid(showPane(s, 'files'))
    expect(isPaneVisible(s, 'files')).toBe(true)
  })

  test('moves between edges', () => {
    let s = createLayout({ root: group(['a']), edges: { left: { panes: ['x', 'y'] } } })
    s = valid(movePane(s, 'x', { type: 'edge', edge: 'bottom' }))
    expect(s.edges.left).toMatchObject({ panes: ['y'], active: 'y' })
    expect(s.edges.bottom).toMatchObject({ panes: ['x'], active: 'x' })
  })
})

describe('floating windows', () => {
  test('remembers the last floating geometry of a pane', () => {
    let s = createLayout({ root: group(['a', 'b']) })
    const rect = { x: 10, y: 20, width: 300, height: 200 }
    s = movePane(s, 'b', { type: 'floating', rect })
    s = restorePane(s, 'b')
    s = valid(movePane(s, 'b', { type: 'floating' }))
    expect(s.floating[0]!.rect).toEqual(rect)
  })

  test('joins an existing window as a tab and raises it', () => {
    let s = createLayout({ root: group(['a', 'b', 'c']) })
    s = movePane(s, 'a', { type: 'floating' })
    s = movePane(s, 'b', { type: 'floating' })
    const first = s.floating[0]!.id
    s = valid(movePane(s, 'c', { type: 'floating', windowId: first }))
    expect(s.floating.map((w) => w.panes)).toEqual([['b'], ['a', 'c']])
    expect(s.floating[1]!.active).toBe('c')
  })

  test('raiseWindow brings a window to the front', () => {
    let s = createLayout({ root: group(['a', 'b', 'c']) })
    s = movePane(s, 'a', { type: 'floating' })
    s = movePane(s, 'b', { type: 'floating' })
    s = valid(raiseWindow(s, s.floating[0]!.id))
    expect(s.floating.map((w) => w.panes[0])).toEqual(['b', 'a'])
  })

  test('removes a window when its last pane leaves', () => {
    let s = createLayout({ root: group(['a', 'b']) })
    s = movePane(s, 'b', { type: 'floating' })
    s = valid(movePane(s, 'b', { type: 'edge', edge: 'left' }))
    expect(s.floating).toEqual([])
    expect(shape(valid(restorePane(s, 'b')))).toBe('a|b*')
  })
})

describe('hiding', () => {
  test('a hidden pane keeps its placement and returns to it', () => {
    let s = createLayout({ root: row(group(['a']), group(['b'])) })
    s = valid(hidePane(s, 'b'))
    expect(hiddenPanes(s)).toEqual(['b'])
    expect(isNodeVacant(s, groupOf(s, 'b'))).toBe(true)
    s = valid(showPane(s, 'b'))
    expect(shape(s)).toBe('row(a*, b*)')
    expect(hiddenPanes(s)).toEqual([])
  })

  test('hides and shows a floating pane in place', () => {
    let s = createLayout({ root: group(['a', 'b']) })
    s = movePane(s, 'b', { type: 'floating' })
    const rect = s.floating[0]!.rect
    s = valid(hidePane(s, 'b'))
    expect(s.floating[0]).toMatchObject({ panes: ['b'], active: null })
    s = valid(showPane(s, 'b'))
    expect(s.floating[0]).toMatchObject({ panes: ['b'], active: 'b', rect })
  })
})

describe('tab positions', () => {
  const tabs = (s: LayoutState, id: string) => presentPanes(s, { type: 'group', id: groupOf(s, id).id })

  test('an index counts the other tabs, so a tab can move right within its own group', () => {
    const s = createLayout({ root: group(['a', 'b', 'c', 'd']) })
    const groupId = groupOf(s, 'a').id
    expect(tabs(valid(movePane(s, 'a', { type: 'group', groupId, index: 2 })), 'a')).toEqual(['b', 'c', 'a', 'd'])
    expect(tabs(valid(movePane(s, 'd', { type: 'group', groupId, index: 0 })), 'a')).toEqual(['d', 'a', 'b', 'c'])
    expect(movePane(s, 'a', { type: 'group', groupId, index: 0 }).root).toBe(s.root)
  })

  test('an index skips tabs that are away', () => {
    let s = createLayout({ root: row(group(['a', 'b', 'c']), group(['x'])) })
    s = movePane(s, 'b', { type: 'floating' })
    s = valid(movePane(s, 'x', { type: 'group', groupId: groupOf(s, 'a').id, index: 1 }))
    expect(tabs(s, 'a')).toEqual(['a', 'x', 'c'])
    expect(tabs(valid(restorePane(s, 'b')), 'a')).toEqual(['a', 'b', 'x', 'c'])
  })

  test('a pane joins a floating window at an index', () => {
    let s = createLayout({ root: group(['a', 'b', 'c', 'd']) })
    s = movePane(s, 'a', { type: 'floating' })
    const windowId = s.floating[0]!.id
    s = movePane(s, 'b', { type: 'floating', windowId })
    s = valid(movePane(s, 'c', { type: 'floating', windowId, index: 0 }))
    expect(s.floating[0]!.panes).toEqual(['c', 'a', 'b'])
    s = valid(movePane(s, 'c', { type: 'floating', windowId, index: 1 }))
    expect(s.floating[0]!.panes).toEqual(['a', 'c', 'b'])
  })
})

describe('isSameArrangement', () => {
  const base = () => createLayout({ root: row(group(['a', 'b']), group(['c'])) })

  test('ignores generated ids', () => {
    const s = base()
    // c is already alone on the right of the other group, so this only replaces its group with a new one.
    const moved = movePane(s, 'c', { type: 'split', groupId: groupOf(s, 'a').id, side: 'right' })
    expect(moved).not.toBe(s)
    expect(groupOf(moved, 'c').id).not.toBe(groupOf(s, 'c').id)
    expect(isSameArrangement(s, moved)).toBe(true)
    expect(isSameArrangement(s, movePane(s, 'c', { type: 'root', side: 'right' }))).toBe(true)
  })

  test('sees real changes', () => {
    const s = base()
    expect(isSameArrangement(s, movePane(s, 'c', { type: 'root', side: 'left' }))).toBe(false)
    expect(isSameArrangement(s, movePane(s, 'b', { type: 'group', groupId: groupOf(s, 'a').id, index: 0 }))).toBe(false)
    expect(isSameArrangement(s, hidePane(s, 'c'))).toBe(false)
    expect(isSameArrangement(s, setWeights(s, { [groupOf(s, 'c').id]: 2 }))).toBe(false)
  })
})

describe('weights', () => {
  test('setWeights ignores invalid values', () => {
    const s = createLayout({ root: row(group(['a']), group(['b'])) })
    const [a, b] = [...groups(s.root)]
    const next = valid(setWeights(s, { [a!.id]: 2, [b!.id]: 0 }))
    expect([...groups(next.root)].map((g) => g.weight)).toEqual([2, 1])
  })

  test('resizePair moves the divider and keeps the combined weight', () => {
    expect(resizePair({ weights: [1, 1], sizes: [200, 200], delta: 100 })).toEqual([1.5, 0.5])
  })

  test('resizePair respects minimum sizes', () => {
    expect(resizePair({ weights: [1, 1], sizes: [200, 200], delta: 500, min: 50 })).toEqual([1.75, 0.25])
    expect(resizePair({ weights: [1, 1], sizes: [40, 40], delta: 10, min: 50 })).toEqual([1, 1])
  })
})

describe('size limits', () => {
  test('a split takes its limits from the children it shows', () => {
    let s = createLayout({
      root: row(
        group(['nav'], { size: { minWidth: 200, maxWidth: 200 } }),
        column(group(['head'], { size: { minHeight: 48, maxHeight: 48, minWidth: 300 } }), group(['main'], { size: { minHeight: 100 } })),
      ),
    })
    expect(nodeLimits(s, s.root!, 4)).toEqual({ minWidth: 504, maxWidth: Infinity, minHeight: 152, maxHeight: Infinity })
    // A hidden child and its divider no longer count.
    s = hidePane(s, 'nav')
    expect(nodeLimits(s, s.root!, 4)).toMatchObject({ minWidth: 300, minHeight: 152 })
  })

  test('setGroupSize sets and clears limits, and rejects impossible ones', () => {
    const s = createLayout({ root: row(group(['a']), group(['b'])) })
    const id = groupOf(s, 'a').id
    const limited = valid(setGroupSize(s, id, { minWidth: 120 }))
    expect(groupOf(limited, 'a').size).toEqual({ minWidth: 120 })
    expect(isSameArrangement(s, limited)).toBe(false)
    expect(groupOf(valid(setGroupSize(limited, id, undefined)), 'a').size).toBeUndefined()
    expect(validateLayout(setGroupSize(s, id, { minWidth: 300, maxWidth: 100 }))).toEqual([
      `group "${id}" has a minimum size above its maximum`,
    ])
  })

  test('limits survive a save and a group being wrapped in a split', () => {
    let s = createLayout({ root: row(group(['a', 'b'], { size: { minWidth: 120 } }), group(['c'])) })
    s = valid(movePane(s, 'c', { type: 'split', groupId: groupOf(s, 'a').id, side: 'bottom' }))
    expect(groupOf(s, 'a').size).toEqual({ minWidth: 120 })
    expect(loadLayout(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  test('resizePair respects maximum sizes', () => {
    expect(resizePair({ weights: [1, 1], sizes: [200, 200], delta: 150, max: [250, Infinity] })).toEqual([1.25, 0.75])
    // The second side may not grow past its maximum, which holds the first side up.
    expect(resizePair({ weights: [1, 1], sizes: [200, 200], delta: -150, max: [Infinity, 260] })).toEqual([0.7, 1.3])
    expect(resizePair({ weights: [1, 1], sizes: [200, 200], delta: 50, min: 190, max: 195 })).toEqual([1, 1])
  })
})

describe('focus history', () => {
  test('moving, showing and focusing a pane put it first', () => {
    let s = createLayout({ root: row(group(['a', 'b']), group(['c'])) })
    expect(focusedPane(s)).toBeUndefined()
    s = valid(focusPane(s, 'c'))
    s = valid(showPane(s, 'b'))
    s = valid(movePane(s, 'a', { type: 'floating' }))
    expect(s.focus).toEqual(['a', 'b', 'c'])
    expect(focusPane(s, 'a')).toBe(s)
  })

  test('the focused pane is the most recent one still on screen', () => {
    let s = createLayout({ root: row(group(['a', 'b'], { active: 'b' }), group(['c'])) })
    s = focusPane(focusPane(s, 'c'), 'b')
    expect(focusedPane(s)).toBe('b')
    s = valid(hidePane(s, 'b'))
    expect(focusedPane(s)).toBe('c')
    s = valid(removePane(s, 'c'))
    expect(s.focus).toEqual(['b'])
    expect(focusedPane(s)).toBeUndefined()
  })

  test('focus is not part of the arrangement', () => {
    const s = createLayout({ root: row(group(['a']), group(['b'])) })
    expect(isSameArrangement(s, focusPane(s, 'b'))).toBe(true)
  })

  test('a pane with no slot is restored beside the most recently focused tiled pane', () => {
    let s = createLayout({ root: row(group(['a']), group(['b'])), edges: { left: { panes: ['x', 'y'] } } })
    s = valid(restorePane(focusPane(s, 'b'), 'x'))
    expect(shape(s)).toBe('row(a*, b|x*)')
    // The dock pane y was focused last, but it is not tiled: the choice falls to x, which is.
    s = valid(restorePane(focusPane(focusPane(s, 'a'), 'x'), 'y'))
    expect(shape(s)).toBe('row(a*, b|x|y*)')
  })

  test('a layout saved before focus history existed still loads', () => {
    const { focus: _focus, ...saved } = focusPane(createLayout({ root: group(['a']) }), 'a')
    expect(validateLayout(loadLayout(JSON.parse(JSON.stringify(saved))))).toEqual([])
  })
})

describe('floating window geometry', () => {
  const rect = { x: 100, y: 100, width: 300, height: 200 }
  const min = { width: 160, height: 100 }

  test('dragging an edge keeps the opposite edge in place', () => {
    expect(resizeWindowRect(rect, { right: true, bottom: true }, 50, -20, min)).toEqual({ x: 100, y: 100, width: 350, height: 180 })
    expect(resizeWindowRect(rect, { left: true, top: true }, 50, -20, min)).toEqual({ x: 150, y: 80, width: 250, height: 220 })
  })

  test('it stops at the minimum size without moving the opposite edge', () => {
    expect(resizeWindowRect(rect, { left: true }, 500, 0, min)).toEqual({ x: 240, y: 100, width: 160, height: 200 })
    expect(resizeWindowRect(rect, { bottom: true }, 0, -500, min)).toEqual({ x: 100, y: 100, width: 300, height: 100 })
  })

  test('a window is drawn where its top strip can still be reached', () => {
    const bounds = { width: 800, height: 600 }
    expect(clampWindowRect(rect, bounds)).toEqual(rect)
    expect(clampWindowRect({ ...rect, x: 900, y: 700 }, bounds)).toEqual({ ...rect, x: 752, y: 552 })
    expect(clampWindowRect({ ...rect, x: -500, y: -50 }, bounds)).toEqual({ ...rect, x: -252, y: 0 })
  })
})

describe('identity and persistence', () => {
  test('unchanged parts of the state keep their identity', () => {
    const s = createLayout({ root: row(group(['a', 'b']), column(group(['c']), group(['d']))) })
    const next = movePane(s, 'a', { type: 'edge', edge: 'left' })
    const [, right] = (s.root as { children: LayoutNode[] }).children
    expect((next.root as { children: LayoutNode[] }).children[1]).toBe(right)
    expect(next.edges.right).toBe(s.edges.right)
    const shown = showPane(s, 'a')
    expect(shown.root).toBe(s.root)
    expect(showPane(shown, 'a')).toBe(shown)
  })

  test('a state survives a JSON round trip', () => {
    let s = createLayout({ root: row(group(['a', 'b']), group(['c'])), edges: { left: { panes: ['x'] } } })
    s = movePane(s, 'b', { type: 'floating' })
    s = hidePane(s, 'c')
    expect(loadLayout(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  test('loadLayout rejects broken input', () => {
    expect(() => loadLayout({ version: 2 })).toThrow(/unsupported version/)
    expect(() => loadLayout({ version: 1 })).toThrow(/Not a saved layout/)
    const s = createLayout({ root: group(['a']) })
    expect(() => loadLayout({ ...s, panes: {} })).toThrow(/Invalid layout/)
  })
})

describe('random action sequences keep every invariant', () => {
  function mulberry32(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  test.each([1, 2, 3, 4, 5])('seed %i', (seed) => {
    const random = mulberry32(seed)
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
    const sides = ['left', 'right', 'top', 'bottom'] as const
    let state = createLayout({ root: row(group(['p0', 'p1']), group(['p2'])) })
    let created = 3

    const target = () => {
      const all = [...groups(state.root)]
      const kind = pick(['group', 'split', 'root', 'edge', 'floating', 'window'] as const)
      if ((kind === 'group' || kind === 'split') && all.length > 0) {
        const groupId = pick(all).id
        return kind === 'group'
          ? ({ type: 'group', groupId, index: Math.floor(random() * 4) } as const)
          : ({ type: 'split', groupId, side: pick(sides) } as const)
      }
      if (kind === 'window' && state.floating.length > 0) {
        return { type: 'floating', windowId: pick(state.floating).id } as const
      }
      if (kind === 'edge') return { type: 'edge', edge: pick(sides) } as const
      if (kind === 'floating') return { type: 'floating' } as const
      return { type: 'root', side: pick(sides) } as const
    }

    for (let step = 0; step < 600; step++) {
      const ids = Object.keys(state.panes)
      const op = pick([
        'move', 'move', 'move', 'restore', 'hide', 'show', 'remove', 'add', 'edge', 'focus', 'size', 'rect',
      ] as const)
      const before = state
      if (op === 'add' || ids.length === 0) state = addPane(state, `p${created++}`, target())
      else if (op === 'move') state = movePane(state, pick(ids), target())
      else if (op === 'restore') state = restorePane(state, pick(ids))
      else if (op === 'hide') state = hidePane(state, pick(ids))
      else if (op === 'show') state = showPane(state, pick(ids))
      else if (op === 'remove') state = removePane(state, pick(ids))
      else if (op === 'focus') state = focusPane(state, pick(ids))
      else if (op === 'size') {
        const all = [...groups(state.root)]
        if (all.length > 0) {
          state = setGroupSize(state, pick(all).id, random() > 0.3 ? { minWidth: 50, maxHeight: 400 } : undefined)
        }
      } else if (op === 'rect') {
        if (state.floating.length > 0) {
          state = setWindowRect(state, pick(state.floating).id, { x: random() * 500, y: random() * 300, width: 200, height: 150 })
        }
      } else state = updateEdge(state, pick(sides), { open: random() > 0.5 })

      const errors = validateLayout(state)
      if (errors.length > 0) {
        throw new Error(`step ${step} (${op}) broke: ${errors.join('; ')}\nbefore: ${JSON.stringify(before)}`)
      }
      expect(loadLayout(JSON.parse(JSON.stringify(state)))).toEqual(state)
    }
  })
})
