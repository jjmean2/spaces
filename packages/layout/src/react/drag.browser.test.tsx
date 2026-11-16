import { useEffect } from 'react'
import { beforeEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { PointerStep } from '../../test/pointer-command.ts'
import {
  Layout,
  PaneSlot,
  column,
  createLayout,
  createLayoutStore,
  findHomeGroup,
  group,
  isSameArrangement,
  presentPanes,
  removePane,
  row,
  showPane,
  updateEdge,
  useLayoutStore,
  usePaneId,
  useTabDrag,
} from '../index.ts'
import type { ContainerRef, ContainerRenderProps, LayoutStore, PaneId } from '../index.ts'

// A press records which pane has the user's attention, so "nothing changed" is checked on the
// arrangement, not on the identity of the state.
const mounts: Record<string, number> = {}
const clicks: string[] = []

beforeEach(() => {
  clicks.length = 0
  for (const key of Object.keys(mounts)) delete mounts[key]
})

function Probe() {
  const id = usePaneId()
  useEffect(() => {
    mounts[id] = (mounts[id] ?? 0) + 1
  }, [id])
  return (
    <div data-testid={`scroll-${id}`} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: 2000 }}>
        <iframe
          data-testid={`frame-${id}`}
          srcDoc="<p>frame</p>"
          style={{ display: 'block', width: '100%', height: 400, border: 0 }}
        />
      </div>
    </div>
  )
}

const keyOf = (ref: ContainerRef) => (ref.type === 'edge' ? `edge:${ref.edge}` : `${ref.type}:${ref.id}`)

function Tab({ id, active }: { id: PaneId; active: boolean }) {
  const store = useLayoutStore()
  return (
    <button
      type="button"
      {...useTabDrag(id)}
      data-testid={`tab-${id}`}
      aria-selected={active}
      style={{ width: 70, height: 24, padding: 0, touchAction: 'none' }}
      onClick={() => {
        clicks.push(id)
        store.update((s) => showPane(s, id))
      }}
    >
      {id}
    </button>
  )
}

function Chrome({ container, panes, active }: ContainerRenderProps) {
  return (
    <div
      data-testid={`chrome-${keyOf(container)}`}
      style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0, minHeight: 0 }}
    >
      <div style={{ display: 'flex', height: 24 }}>
        {panes.map((id) => (
          <Tab key={id} id={id} active={id === active} />
        ))}
      </div>
      <PaneSlot />
    </div>
  )
}

const renderChrome = (props: ContainerRenderProps) => <Chrome {...props} />
const renderProbe = () => <Probe />

function Harness({ store }: { store: LayoutStore }) {
  return (
    <Layout
      store={store}
      style={{ width: 900, height: 600 }}
      renderPane={renderProbe}
      renderContainer={renderChrome}
    />
  )
}

const q = <T extends HTMLElement>(testId: string) => document.querySelector<T>(`[data-testid="${testId}"]`)!
const centre = (element: Element) => {
  const r = element.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }
}
const indicator = () => document.querySelector<HTMLElement>('[data-spaces-drop-indicator]')
const tabsOf = (store: LayoutStore, paneId: string) => {
  const state = store.getState()
  return presentPanes(state, { type: 'group', id: findHomeGroup(state.root, paneId)!.id })
}

/** Press a tab and move it to a point, in two legs so the threshold is crossed before the target is reached. */
const dragTo = (tab: string, x: number, y: number): PointerStep[] => {
  const from = centre(q(`tab-${tab}`))
  return [
    ['move', from.x, from.y],
    ['down'],
    ['move', from.x + 12, from.y + 12],
    ['move', x, y],
  ]
}

function twoGroups() {
  return createLayoutStore(createLayout({ root: row(group(['a', 'b', 'c']), group(['d'])) }))
}

test('dragging a tab onto another group moves the pane without remounting it', async () => {
  const store = twoGroups()
  await render(<Harness store={store} />)
  const host = document.querySelector<HTMLElement>('[data-spaces-pane="a"]')!
  const scroller = q('scroll-a')
  const iframe = q<HTMLIFrameElement>('frame-a')
  await expect.poll(() => iframe.contentDocument?.body?.textContent).toBe('frame')
  ;(iframe.contentWindow as unknown as { marker: string }).marker = 'alive'
  scroller.scrollTop = 130

  const moved: Node[] = []
  new MutationObserver((records) => {
    for (const record of records) moved.push(...record.addedNodes, ...record.removedNodes)
  }).observe(host.parentElement!, { childList: true })

  // The pointer ends over d's iframe. With capture on the tab, moves keep arriving there.
  const target = centre(q('frame-d'))
  await commands.pointer(dragTo('a', target.x, target.y))
  const groupD = findHomeGroup(store.getState().root, 'd')!.id
  expect(document.elementFromPoint(target.x, target.y)?.tagName).toBe('IFRAME')
  expect(indicator()?.dataset.zone).toBe('center')
  const shown = indicator()!.getBoundingClientRect()
  const groupRect = document.querySelector(`[data-spaces-group="${groupD}"]`)!.getBoundingClientRect()
  expect([shown.left, shown.top, shown.width, shown.height]).toEqual([
    groupRect.left,
    groupRect.top,
    groupRect.width,
    groupRect.height,
  ])
  expect(q('tab-a').dataset.dragging).toBe('true')
  // Nothing has moved yet.
  expect(tabsOf(store, 'a')).toEqual(['a', 'b', 'c'])

  await commands.pointer([['up']])
  expect(tabsOf(store, 'd')).toEqual(['d', 'a'])
  expect(indicator()).toBeNull()
  expect(clicks).toEqual([])
  expect(moved.includes(host)).toBe(false)
  expect(mounts.a).toBe(1)
  expect(scroller.scrollTop).toBe(130)
  expect((iframe.contentWindow as unknown as { marker?: string }).marker).toBe('alive')
  expect(document.body.style.userSelect).toBe('')
})

test('a press without movement is still a click', async () => {
  const store = twoGroups()
  await render(<Harness store={store} />)
  const at = centre(q('tab-b'))
  await commands.pointer([['move', at.x, at.y], ['down'], ['move', at.x + 2, at.y + 1], ['up']])
  expect(clicks).toEqual(['b'])
  expect(findHomeGroup(store.getState().root, 'b')!.active).toBe('b')
  expect(tabsOf(store, 'a')).toEqual(['a', 'b', 'c'])
})

test('dropping near an edge of a group splits it', async () => {
  const store = twoGroups()
  await render(<Harness store={store} />)
  const d = document.querySelector(`[data-spaces-group="${findHomeGroup(store.getState().root, 'd')!.id}"]`)!
  const r = d.getBoundingClientRect()
  await commands.pointer(dragTo('b', r.left + r.width / 2, r.bottom - 40))
  expect(indicator()?.dataset.zone).toBe('bottom')
  // The indicator covers the half of the group the new one would take.
  const half = indicator()!.getBoundingClientRect()
  expect([half.left, half.top, half.width, half.height]).toEqual([r.left, r.top + r.height / 2, r.width, r.height / 2])
  await commands.pointer([['up']])
  const root = store.getState().root
  expect(root).toMatchObject({
    type: 'split',
    orientation: 'row',
    children: [{ panes: ['a', 'c'] }, { type: 'split', orientation: 'column', children: [{ panes: ['d'] }, { panes: ['b'] }] }],
  })
})

test('a tab is reordered within its own strip, in both directions', async () => {
  const store = twoGroups()
  await render(<Harness store={store} />)
  const c = centre(q('tab-c'))
  await commands.pointer([...dragTo('a', c.r.right - 8, c.y), ['up']])
  expect(tabsOf(store, 'a')).toEqual(['b', 'c', 'a'])

  const b = centre(q('tab-b'))
  await commands.pointer([...dragTo('a', b.r.left + 8, b.y)])
  expect(indicator()?.dataset.zone).toBe('tab')
  expect(indicator()!.getBoundingClientRect().width).toBe(2)
  await commands.pointer([['up']])
  expect(tabsOf(store, 'a')).toEqual(['a', 'b', 'c'])
})

test('a drop that would change nothing shows no indicator and does nothing', async () => {
  const store = twoGroups()
  await render(<Harness store={store} />)
  const before = store.getState()
  // d is the only pane of its group: its own middle, its own edge, and the tree edge it already fills.
  const r = document.querySelector(`[data-spaces-group="${findHomeGroup(before.root, 'd')!.id}"]`)!.getBoundingClientRect()
  const own = centre(q('tab-d'))
  for (const [x, y] of [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + 30, r.top + r.height / 2],
    [r.right - 4, r.top + r.height / 2],
    // Back on the tab it was pressed on, where the browser would send a click.
    [own.x, own.y],
  ] as const) {
    await commands.pointer(dragTo('d', x, y))
    expect(q('tab-d').dataset.dragging).toBe('true')
    expect(indicator()).toBeNull()
    await commands.pointer([['up']])
    expect(isSameArrangement(store.getState(), before)).toBe(true)
    expect(clicks).toEqual([])
  }
})

test('Escape cancels the drag, and the release that follows is not a click', async () => {
  const store = twoGroups()
  await render(<Harness store={store} />)
  const before = store.getState()
  const target = centre(q('frame-d'))
  await commands.pointer(dragTo('a', target.x, target.y))
  expect(indicator()).not.toBeNull()
  await commands.pointer([['press', 'Escape']])
  expect(indicator()).toBeNull()
  expect(q('tab-a').dataset.dragging).toBeUndefined()
  await commands.pointer([['up']])
  expect(isSameArrangement(store.getState(), before)).toBe(true)
  expect(clicks).toEqual([])

  // The click suppression is gone again.
  const b = centre(q('tab-b'))
  await commands.pointer([['move', b.x, b.y], ['down'], ['up']])
  expect(clicks).toEqual(['b'])
})

test('releasing outside the layout cancels', async () => {
  const store = twoGroups()
  await render(<Harness store={store} />)
  const before = store.getState()
  await commands.pointer([...dragTo('a', 1100, 700)])
  expect(indicator()).toBeNull()
  await commands.pointer([['up']])
  expect(isSameArrangement(store.getState(), before)).toBe(true)
})

test('holding Shift drops the pane as a floating window at the pointer', async () => {
  const store = twoGroups()
  await render(<Harness store={store} />)
  const root = document.querySelector('[data-spaces-layout]')!.getBoundingClientRect()
  await commands.pointer(dragTo('a', root.left + 450, root.top + 200))
  expect(indicator()?.dataset.zone).not.toBe('float')
  await commands.pointer([['keydown', 'Shift']])
  expect(indicator()?.dataset.zone).toBe('float')
  await commands.pointer([['up'], ['keyup', 'Shift']])
  const state = store.getState()
  expect(state.floating).toHaveLength(1)
  expect(state.floating[0]).toMatchObject({ panes: ['a'], rect: { x: 210, y: 184, width: 480, height: 320 } })
  expect(tabsOf(store, 'b')).toEqual(['b', 'c'])
  expect(mounts.a).toBe(1)

  // A tab can then be dropped into the window, which is in front of the groups.
  const win = document.querySelector('[data-spaces-window]')!.getBoundingClientRect()
  await commands.pointer([...dragTo('d', win.left + win.width / 2, win.top + win.height / 2), ['up']])
  expect(store.getState().floating[0]!.panes).toEqual(['a', 'd'])
})

test('a tab can be dropped into an edge dock, and an overlay dock wins over the group under it', async () => {
  const store = createLayoutStore(
    createLayout({ root: row(group(['a', 'b']), group(['c'])), edges: { left: { panes: ['x', 'y'], size: 220 } } }),
  )
  await render(<Harness store={store} />)

  // Pinned: between its two tabs.
  const y = centre(q('tab-y'))
  await commands.pointer(dragTo('a', y.r.left + 6, y.y))
  expect(indicator()?.dataset.zone).toBe('tab')
  await commands.pointer([['up']])
  expect(store.getState().edges.left).toMatchObject({ panes: ['x', 'a', 'y'], active: 'a' })
  expect(store.getState().panes.a!.placement).toEqual({ type: 'edge', edge: 'left' })
  // It kept its slot in the group it left.
  expect(findHomeGroup(store.getState().root, 'a')!.panes).toEqual(['a', 'b'])

  // Overlay: the dock now lies over the left of the first group. A point inside both goes to the dock.
  store.update((s) => updateEdge(s, 'left', { mode: 'overlay' }))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const dock = document.querySelector('[data-spaces-edge="left"]')!.getBoundingClientRect()
  const under = document
    .querySelector(`[data-spaces-group="${findHomeGroup(store.getState().root, 'b')!.id}"]`)!
    .getBoundingClientRect()
  const point = { x: dock.left + 100, y: dock.top + 300 }
  expect(point.x).toBeGreaterThan(under.left)
  expect(point.x).toBeLessThan(under.right)
  await commands.pointer(dragTo('c', point.x, point.y))
  expect(indicator()?.dataset.zone).toBe('center')
  await commands.pointer([['up']])
  expect(store.getState().edges.left.panes).toEqual(['x', 'a', 'y', 'c'])
})

test('a drag ends cleanly when its pane is removed under it', async () => {
  const store = twoGroups()
  await render(<Harness store={store} />)
  const target = centre(q('frame-d'))
  await commands.pointer(dragTo('a', target.x, target.y))
  expect(indicator()).not.toBeNull()
  expect(document.body.style.userSelect).toBe('none')

  store.update((s) => removePane(s, 'a'))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  expect(indicator()).toBeNull()
  expect(document.body.style.userSelect).toBe('')
  const afterRemoval = store.getState()
  await commands.pointer([['up']])
  expect(isSameArrangement(store.getState(), afterRemoval)).toBe(true)

  // The next drag and the next click both work.
  await commands.pointer([...dragTo('b', target.x, target.y), ['up']])
  expect(tabsOf(store, 'd')).toEqual(['d', 'b'])
  const c = centre(q('tab-c'))
  await commands.pointer([['move', c.x, c.y], ['down'], ['up']])
  expect(clicks).toEqual(['c'])
})

test('the band along the tiled area splits the whole tree', async () => {
  const store = createLayoutStore(createLayout({ root: row(group(['a', 'b']), column(group(['c']), group(['d']))) }))
  await render(<Harness store={store} />)
  const root = document.querySelector('[data-spaces-layout]')!.getBoundingClientRect()
  await commands.pointer(dragTo('b', root.left + 450, root.bottom - 6))
  expect(indicator()?.dataset.zone).toBe('root-bottom')
  await commands.pointer([['up']])
  expect(store.getState().root).toMatchObject({
    type: 'split',
    orientation: 'column',
    children: [{ type: 'split', orientation: 'row' }, { type: 'group', panes: ['b'] }],
  })
})

test('dragging a tab in a nested layout does not touch the outer one', async () => {
  const inner = createLayoutStore(createLayout({ root: row(group(['i1', 'i2']), group(['i3'])) }))
  const outer = createLayoutStore(createLayout({ root: row(group(['o1']), group(['o2'])) }))
  await render(
    <Layout
      store={outer}
      style={{ width: 900, height: 600 }}
      renderContainer={renderChrome}
      renderPane={(id) =>
        id === 'o2' ? (
          <Layout
            store={inner}
            style={{ width: '100%', height: '100%' }}
            renderContainer={renderChrome}
            renderPane={(innerId) => <div>{innerId}</div>}
          />
        ) : (
          <div>{id}</div>
        )
      }
    />,
  )
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const outerBefore = outer.getState()
  // Each layout numbers its own groups, so the same id can appear in both. Look inside the right one.
  const [outerRoot, innerRoot] = [...document.querySelectorAll('[data-spaces-layout]')]

  // Released over the outer layout's first group, outside the inner layout: nothing happens anywhere.
  const o1 = centre(outerRoot!.querySelector(`[data-spaces-group="${findHomeGroup(outerBefore.root, 'o1')!.id}"]`)!)
  const innerBefore = inner.getState()
  await commands.pointer([...dragTo('i1', o1.x, o1.y), ['up']])
  expect(isSameArrangement(inner.getState(), innerBefore)).toBe(true)
  expect(isSameArrangement(outer.getState(), outerBefore)).toBe(true)

  // Released over an inner group: only the inner layout changes.
  const i3 = centre(innerRoot!.querySelector(`[data-spaces-group="${findHomeGroup(innerBefore.root, 'i3')!.id}"]`)!)
  await commands.pointer([...dragTo('i1', i3.x, i3.y), ['up']])
  expect(presentPanes(inner.getState(), { type: 'group', id: findHomeGroup(inner.getState().root, 'i3')!.id })).toEqual([
    'i3',
    'i1',
  ])
  expect(isSameArrangement(outer.getState(), outerBefore)).toBe(true)
  expect(document.querySelectorAll('[data-spaces-drop-indicator]')).toHaveLength(0)
})
