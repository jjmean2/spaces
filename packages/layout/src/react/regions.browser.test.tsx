import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import {
  Layout,
  PaneSlot,
  column,
  createLayout,
  createLayoutStore,
  findHomeGroup,
  focusedPane,
  group,
  hidePane,
  movePane,
  row,
  showPane,
  useTabDrag,
  useWindowDrag,
} from '../index.ts'
import type { ContainerRef, ContainerRenderProps, LayoutStore, PaneId, WindowId } from '../index.ts'

const keyOf = (ref: ContainerRef) => (ref.type === 'edge' ? `edge:${ref.edge}` : `${ref.type}:${ref.id}`)

function Tab({ id }: { id: PaneId }) {
  return (
    <button type="button" {...useTabDrag(id)} data-testid={`tab-${id}`} style={{ width: 60, height: 24, padding: 0 }}>
      {id}
    </button>
  )
}

function Grip({ id }: { id: WindowId }) {
  return <span {...useWindowDrag(id)} data-testid="grip" style={{ width: 24, height: 24, touchAction: 'none' }} />
}

/** Chrome with nothing around the slot, so pane content reaches the container's left, right and bottom edges. */
function Chrome({ container, panes, focused }: ContainerRenderProps) {
  return (
    <div
      data-testid={`chrome-${keyOf(container)}`}
      data-focused={focused}
      style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0, minHeight: 0 }}
    >
      <div style={{ display: 'flex', height: 24 }}>
        {container.type === 'floating' && <Grip id={container.id} />}
        {panes.map((id) => (
          <Tab key={id} id={id} />
        ))}
      </div>
      <PaneSlot />
    </div>
  )
}

const chrome = (props: ContainerRenderProps) => <Chrome {...props} />
const content = (id: PaneId) => (
  <button type="button" data-testid={`content-${id}`} style={{ width: '100%', height: '100%' }}>
    {id}
  </button>
)

const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))))
const q = <T extends HTMLElement>(testId: string) => document.querySelector<T>(`[data-testid="${testId}"]`)!
const box = (element: Element) => element.getBoundingClientRect()
const host = (id: string) => document.querySelector<HTMLElement>(`[data-spaces-pane="${id}"]`)!
const groupEl = (store: LayoutStore, paneId: string, root: ParentNode = document) =>
  root.querySelector<HTMLElement>(`[data-spaces-group="${findHomeGroup(store.getState().root, paneId)!.id}"]`)!
const press = (x: number, y: number, toX: number, toY: number) =>
  commands.pointer([['move', x, y], ['down'], ['move', (x + toX) / 2, (y + toY) / 2], ['move', toX, toY], ['up']])

test('a floating window is resized by its edges and corners, even where its content reaches them', async () => {
  const store = createLayoutStore(createLayout({ root: group(['a', 'b']) }))
  store.update((s) => movePane(s, 'b', { type: 'floating', rect: { x: 200, y: 100, width: 300, height: 200 } }))
  await render(<Layout store={store} style={{ width: 900, height: 600 }} renderPane={content} renderContainer={chrome} />)
  await frame()
  const root = box(document.querySelector('[data-spaces-layout]')!)
  const rect = () => store.getState().floating[0]!.rect

  // The pane content covers the window's bottom-right corner; the handle is above it.
  const corner = { x: root.left + 500, y: root.top + 300 }
  expect(document.elementFromPoint(corner.x - 1, corner.y - 1)?.getAttribute('data-spaces-window-resize')).toBe('bottom-right')
  expect(document.elementFromPoint(corner.x - 20, corner.y - 20)?.getAttribute('data-testid')).toBe('content-b')

  await press(corner.x - 1, corner.y - 1, corner.x + 59, corner.y + 39)
  expect(rect()).toEqual({ x: 200, y: 100, width: 360, height: 240 })

  // The left edge moves; the right edge stays.
  await press(root.left + 201, root.top + 220, root.left + 151, root.top + 220)
  expect(rect()).toEqual({ x: 150, y: 100, width: 410, height: 240 })

  // It stops at the minimum size.
  await press(root.left + 151, root.top + 220, root.left + 800, root.top + 220)
  expect(rect()).toEqual({ x: 400, y: 100, width: 160, height: 240 })

  // The content follows the window.
  await frame()
  const slot = box(q(`chrome-floating:${store.getState().floating[0]!.id}`).querySelector('[data-spaces-slot]')!)
  expect([box(host('b')).left, box(host('b')).width]).toEqual([slot.left, slot.width])
})

test('a floating window stays within reach when the layout shrinks, and does not jump when dragged', async () => {
  const store = createLayoutStore(createLayout({ root: group(['a', 'b']) }))
  store.update((s) => movePane(s, 'b', { type: 'floating', rect: { x: 600, y: 300, width: 250, height: 200 } }))
  await render(
    <div data-testid="frame" style={{ width: 900, height: 600 }}>
      <Layout store={store} style={{ width: '100%', height: '100%' }} renderPane={content} renderContainer={chrome} />
    </div>,
  )
  await frame()
  const stored = store.getState().floating[0]!.rect
  const win = () => box(document.querySelector('[data-spaces-window]')!)
  const root = () => box(document.querySelector('[data-spaces-layout]')!)
  expect(win().left - root().left).toBe(600)

  q('frame').style.width = '400px'
  q('frame').style.height = '250px'
  await frame()
  // Drawn where 48px of its top strip are still inside; the stored place is untouched.
  expect([win().left - root().left, win().top - root().top]).toEqual([352, 202])
  expect(store.getState().floating[0]!.rect).toBe(stored)
  expect(box(host('b')).left).toBe(box(q(`chrome-floating:${store.getState().floating[0]!.id}`).querySelector('[data-spaces-slot]')!).left)

  // Dragging starts from where it is drawn.
  const grip = box(q('grip'))
  await press(grip.left + 10, grip.top + 10, grip.left - 90, grip.top - 40)
  expect(store.getState().floating[0]!.rect).toEqual({ x: 252, y: 152, width: 250, height: 200 })
  expect([win().left - root().left, win().top - root().top]).toEqual([252, 152])

  // When the layout grows again a window that was not touched is back where it was put.
  store.update((s) => movePane(s, 'a', { type: 'floating', rect: { x: 700, y: 400, width: 150, height: 120 } }))
  q('frame').style.width = '900px'
  q('frame').style.height = '600px'
  await frame()
  const second = [...document.querySelectorAll('[data-spaces-window]')].map(box).find((r) => r.width === 150)!
  expect([second.left - root().left, second.top - root().top]).toEqual([700, 400])
})

test('an app shell: fixed regions around a docking layout', async () => {
  const shell = createLayoutStore(
    createLayout({
      root: column(
        group(['header'], { size: { minHeight: 48, maxHeight: 48 } }),
        row(group(['sidebar'], { size: { minWidth: 200, maxWidth: 200 } }), group(['main'])),
      ),
    }),
  )
  const docking = createLayoutStore(createLayout({ root: row(group(['one']), group(['two'])) }))
  await render(
    <div data-testid="frame" style={{ width: 900, height: 600 }}>
      <Layout
        store={shell}
        style={{ width: '100%', height: '100%' }}
        renderContainer={() => <PaneSlot />}
        renderPane={(id) =>
          id === 'main' ? (
            <Layout store={docking} style={{ width: '100%', height: '100%' }} renderPane={content} renderContainer={chrome} />
          ) : (
            <div data-testid={`region-${id}`} style={{ height: '100%' }} />
          )
        }
      />
    </div>,
  )
  await frame()
  const [outer, inner] = [...document.querySelectorAll<HTMLElement>('[data-spaces-layout]')]
  const outerSashes = () => [...outer!.querySelectorAll('[data-spaces-sash]')].filter((sash) => !inner!.contains(sash))
  const size = (id: string) => {
    const r = box(host(id))
    return [r.width, r.height]
  }

  // Regions drawn without tabs are not tab panels; panes under tabs are.
  expect(host('header').hasAttribute('role')).toBe(false)
  expect(host('sidebar').hasAttribute('role')).toBe(false)
  expect(host('one').getAttribute('role')).toBe('tabpanel')

  // No divider beside a fixed region; the inner layout keeps its own.
  expect(outerSashes()).toHaveLength(0)
  expect(inner!.querySelectorAll('[data-spaces-sash]')).toHaveLength(1)
  expect(size('header')).toEqual([900, 48])
  expect(size('sidebar')).toEqual([200, 552])
  expect(size('main')).toEqual([700, 552])

  // The fixed sizes hold when the container resizes; the rest takes the difference.
  q('frame').style.width = '640px'
  q('frame').style.height = '400px'
  await frame()
  expect(size('header')).toEqual([640, 48])
  expect(size('sidebar')).toEqual([200, 352])
  expect(size('main')).toEqual([440, 352])
  expect(box(groupEl(docking, 'one', inner!)).width + box(groupEl(docking, 'two', inner!)).width).toBe(436)

  // The sidebar hides and comes back at its width.
  shell.update((s) => hidePane(s, 'sidebar'))
  await frame()
  expect(size('main')).toEqual([640, 352])
  expect(host('sidebar').style.visibility).toBe('hidden')
  shell.update((s) => showPane(s, 'sidebar'))
  await frame()
  expect(size('sidebar')).toEqual([200, 352])
  expect(size('main')).toEqual([440, 352])
})

test('a divider follows the pointer beside a region held at its limit, and stops at limits', async () => {
  const store = createLayoutStore(
    createLayout({
      root: row(group(['a'], { size: { minWidth: 200 } }), group(['b']), group(['c'], { size: { maxWidth: 150 } })),
    }),
  )
  await render(<Layout store={store} style={{ width: 908, height: 400 }} renderPane={content} renderContainer={chrome} />)
  await frame()
  const width = (id: string) => box(groupEl(store, id)).width
  // c would get a third; it is held at 150 and the others share the rest.
  expect([width('a'), width('b'), width('c')]).toEqual([375, 375, 150])

  const sash = box(document.querySelectorAll('[data-spaces-sash]')[0]!)
  const y = sash.top + 50
  await press(sash.left + 2, y, sash.left + 62, y)
  expect([width('a'), width('b'), width('c')]).toEqual([435, 315, 150])

  // a cannot go below its minimum.
  const again = box(document.querySelectorAll('[data-spaces-sash]')[0]!)
  await press(again.left + 2, y, again.left - 600, y)
  expect([width('a'), width('b'), width('c')]).toEqual([200, 550, 150])
})

test('a press or focus records which pane has the attention', async () => {
  const inner = createLayoutStore(createLayout({ root: row(group(['i1']), group(['i2'])) }))
  const outer = createLayoutStore(createLayout({ root: row(group(['o1', 'o3']), group(['o2'])) }))
  await render(
    <Layout
      store={outer}
      style={{ width: 900, height: 500 }}
      renderContainer={chrome}
      renderPane={(id) =>
        id === 'o2' ? (
          <Layout store={inner} style={{ width: '100%', height: '100%' }} renderPane={content} renderContainer={chrome} />
        ) : (
          content(id)
        )
      }
    />,
  )
  await frame()
  const click = async (element: Element) => {
    const r = box(element)
    await commands.pointer([['move', r.left + r.width / 2, r.top + r.height / 2], ['down'], ['up']])
  }
  expect(focusedPane(outer.getState())).toBeUndefined()

  // In pane content.
  await click(q('content-o1'))
  expect(focusedPane(outer.getState())).toBe('o1')
  expect(host('o1').dataset.spacesFocused).toBe('true')
  expect(q(`chrome-group:${findHomeGroup(outer.getState().root, 'o1')!.id}`).dataset.focused).toBe('true')

  // In a nested layout: its own pane, and the outer pane that holds it.
  await click(q('content-i2'))
  expect(focusedPane(inner.getState())).toBe('i2')
  expect(focusedPane(outer.getState())).toBe('o2')
  expect(host('o1').dataset.spacesFocused).toBe('false')

  // On chrome: the container's active pane. An inactive tab's pane is not on screen.
  await click(q('tab-o3'))
  expect(focusedPane(outer.getState())).toBe('o1')

  // By keyboard focus alone.
  q('content-i1').focus()
  expect(focusedPane(inner.getState())).toBe('i1')
  expect(focusedPane(outer.getState())).toBe('o2')
})
