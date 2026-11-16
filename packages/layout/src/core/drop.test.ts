import { describe, expect, test } from 'vitest'
import { resolveDrop } from './drop.ts'
import type { DropInput, DropRegion } from './drop.ts'

// A 1000x600 tiled area holding two groups side by side, each with a 30px tab strip.
const tiled = { x: 0, y: 0, width: 1000, height: 600 }
const tab = (paneId: string, x: number, y = 0) => ({ paneId, rect: { x, y, width: 80, height: 30 } })
const left: DropRegion = {
  container: { type: 'group', id: 'g1' },
  rect: { x: 0, y: 0, width: 500, height: 600 },
  tabs: [tab('a', 0), tab('b', 80), tab('c', 160)],
  raised: false,
}
const right: DropRegion = {
  container: { type: 'group', id: 'g2' },
  rect: { x: 500, y: 0, width: 500, height: 600 },
  tabs: [tab('d', 500)],
  raised: false,
}
const drop = (x: number, y: number, extra: Partial<DropInput> = {}) =>
  resolveDrop({ point: { x, y }, dragged: 'a', regions: [left, right], tiled, ...extra })

describe('group body', () => {
  test('the middle adds the pane as the last tab', () => {
    expect(drop(750, 300)).toEqual({
      target: { type: 'group', groupId: 'g2' },
      indicator: right.rect,
      zone: 'center',
    })
  })

  test('within a quarter of an edge splits the group, previewing the half it would take', () => {
    expect(drop(880, 300)).toMatchObject({
      target: { type: 'split', groupId: 'g2', side: 'right' },
      indicator: { x: 750, y: 0, width: 250, height: 600 },
      zone: 'right',
    })
    expect(drop(750, 560)?.target).toEqual({ type: 'split', groupId: 'g2', side: 'bottom' })
    expect(drop(520, 300)?.target).toEqual({ type: 'split', groupId: 'g2', side: 'left' })
  })

  test('in a corner the edge that is proportionally nearer wins', () => {
    expect(drop(560, 500)?.target).toMatchObject({ side: 'left' })
    expect(drop(600, 580)?.target).toMatchObject({ side: 'bottom' })
  })
})

describe('tab strip', () => {
  test('gives the position among the other tabs, split at each tab midpoint', () => {
    // Dragging a from the left group over the right group's strip.
    expect(drop(510, 10)).toMatchObject({ target: { type: 'group', groupId: 'g2', index: 0 }, zone: 'tab' })
    expect(drop(570, 10)?.target).toEqual({ type: 'group', groupId: 'g2', index: 1 })
  })

  test('the empty space beside the last tab appends', () => {
    expect(drop(900, 10)?.target).toEqual({ type: 'group', groupId: 'g2', index: 1 })
  })

  test('within its own strip, positions do not count the dragged tab', () => {
    // a | b | c: over the right half of b means "after b", which is position 1 without a.
    expect(drop(150, 10)?.target).toEqual({ type: 'group', groupId: 'g1', index: 1 })
    expect(drop(230, 10)?.target).toEqual({ type: 'group', groupId: 'g1', index: 2 })
    // Over itself, or the left half of b: stays first.
    expect(drop(20, 10)?.target).toEqual({ type: 'group', groupId: 'g1', index: 0 })
    expect(drop(100, 10)?.target).toEqual({ type: 'group', groupId: 'g1', index: 0 })
  })

  test('draws an insertion line at the boundary', () => {
    expect(drop(570, 10)?.indicator).toEqual({ x: 579, y: 0, width: 2, height: 30 })
    expect(drop(510, 10)?.indicator).toEqual({ x: 499, y: 0, width: 2, height: 30 })
  })

  test('handles tabs wrapped onto a second row', () => {
    const wrapped: DropRegion = { ...right, tabs: [tab('d', 500), tab('e', 580), tab('f', 500, 30)] }
    const at = (x: number, y: number) =>
      resolveDrop({ point: { x, y }, dragged: 'a', regions: [left, wrapped], tiled })?.target
    expect(at(650, 10)).toEqual({ type: 'group', groupId: 'g2', index: 2 })
    expect(at(510, 40)).toEqual({ type: 'group', groupId: 'g2', index: 2 })
    expect(at(700, 40)).toEqual({ type: 'group', groupId: 'g2', index: 3 })
  })

  test('handles a vertical strip', () => {
    const dock: DropRegion = {
      container: { type: 'edge', edge: 'left' },
      rect: { x: 0, y: 0, width: 200, height: 600 },
      tabs: [
        { paneId: 'x', rect: { x: 0, y: 0, width: 40, height: 60 } },
        { paneId: 'y', rect: { x: 0, y: 60, width: 40, height: 60 } },
      ],
      raised: true,
    }
    const at = (y: number) => resolveDrop({ point: { x: 20, y }, dragged: 'a', regions: [dock], tiled })
    expect(at(20)?.target).toEqual({ type: 'edge', edge: 'left', index: 0 })
    expect(at(70)?.target).toEqual({ type: 'edge', edge: 'left', index: 1 })
    expect(at(110)).toMatchObject({ target: { index: 2 }, indicator: { x: 0, y: 119, width: 40, height: 2 } })
  })
})

describe('precedence', () => {
  test('a band along the tiled area splits the whole tree, except over a tab strip', () => {
    expect(drop(995, 300)).toMatchObject({
      target: { type: 'root', side: 'right' },
      indicator: { x: 750, y: 0, width: 250, height: 600 },
      zone: 'root-right',
    })
    expect(drop(300, 595)?.target).toEqual({ type: 'root', side: 'bottom' })
    // The top band lies over the tab strips, which keep their meaning.
    expect(drop(700, 5)?.zone).toBe('tab')
  })

  test('floating windows and overlay docks come before what is under them, and only take tabs', () => {
    const win: DropRegion = {
      container: { type: 'floating', id: 'w1' },
      rect: { x: 900, y: 200, width: 100, height: 200 },
      tabs: [{ paneId: 'p', rect: { x: 900, y: 200, width: 50, height: 20 } }],
      raised: true,
    }
    const at = (x: number, y: number) =>
      resolveDrop({ point: { x, y }, dragged: 'a', regions: [win, left, right], tiled })
    // On the window's right edge, which is also inside the root band.
    expect(at(995, 300)).toMatchObject({ target: { type: 'floating', windowId: 'w1' }, zone: 'center' })
    expect(at(910, 210)?.target).toEqual({ type: 'floating', windowId: 'w1', index: 0 })
    expect(at(995, 500)?.zone).toBe('root-right')
  })

  test('an empty tiled area takes the pane as its first group', () => {
    expect(resolveDrop({ point: { x: 400, y: 300 }, dragged: 'a', regions: [], tiled })).toEqual({
      target: { type: 'root', side: 'right' },
      indicator: tiled,
      zone: 'center',
    })
  })

  test('outside every region there is no drop', () => {
    expect(drop(1200, 300)).toBeNull()
    expect(resolveDrop({ point: { x: 10, y: 10 }, dragged: 'a', regions: [], tiled: null })).toBeNull()
  })
})

describe('floating', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 600 }

  test('a requested window hangs from the pointer by its title bar', () => {
    expect(drop(500, 300, { float: { width: 400, height: 300, bounds } })).toEqual({
      target: { type: 'floating', rect: { x: 300, y: 284, width: 400, height: 300 } },
      indicator: { x: 300, y: 284, width: 400, height: 300 },
      zone: 'float',
    })
  })

  test('it stays inside the layout', () => {
    expect(drop(990, 590, { float: { width: 400, height: 300, bounds } })?.indicator).toEqual({
      x: 600,
      y: 300,
      width: 400,
      height: 300,
    })
    expect(drop(5, 5, { float: { width: 2000, height: 300, bounds } })?.indicator).toMatchObject({ x: 0, y: 0, width: 1000 })
  })
})

test('thresholds can be changed', () => {
  const input: DropInput = { point: { x: 880, y: 300 }, dragged: 'a', regions: [left, right], tiled }
  expect(resolveDrop(input, { edgeFraction: 0.1 })?.zone).toBe('center')
  expect(resolveDrop({ ...input, point: { x: 960, y: 300 } }, { rootBand: 50 })?.zone).toBe('root-right')
})
