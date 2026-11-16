import { useEffect } from 'react'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import {
  Layout,
  PaneSlot,
  addPane,
  column,
  createLayout,
  createLayoutStore,
  findHomeGroup,
  group,
  hidePane,
  movePane,
  removePane,
  restorePane,
  row,
  showPane,
  updateEdge,
  usePaneId,
} from '../index.ts'
import type { ContainerRef, LayoutStore } from '../index.ts'

const mounts: Record<string, number> = {}
const unmounts: Record<string, number> = {}

function Probe() {
  const id = usePaneId()
  useEffect(() => {
    mounts[id] = (mounts[id] ?? 0) + 1
    return () => {
      unmounts[id] = (unmounts[id] ?? 0) + 1
    }
  }, [id])
  return (
    <div data-testid={`scroll-${id}`} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: 2000 }}>
        {/* Block-level, so a change of width never reflows the content and shifts the scroll offset. */}
        <input data-testid={`input-${id}`} style={{ display: 'block' }} />
        <iframe data-testid={`frame-${id}`} srcDoc="<p>frame</p>" style={{ display: 'block' }} />
      </div>
    </div>
  )
}

const keyOf = (ref: ContainerRef) => (ref.type === 'edge' ? `edge:${ref.edge}` : `${ref.type}:${ref.id}`)

function Harness({ store }: { store: LayoutStore }) {
  return (
    <Layout
      store={store}
      style={{ width: 900, height: 600 }}
      renderPane={() => <Probe />}
      renderContainer={({ container, panes, active }) => (
        <div
          data-testid={`chrome-${keyOf(container)}`}
          style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0, minHeight: 0 }}
        >
          <div style={{ height: 24 }}>{panes.map((id) => (id === active ? `[${id}]` : id)).join(' ')}</div>
          <PaneSlot />
        </div>
      )}
    />
  )
}

/** Two frames: ResizeObserver callbacks run after the first frame's animation callbacks. */
const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))))
const host = (id: string) => document.querySelector<HTMLElement>(`[data-spaces-pane="${id}"]`)!
const q = <T extends HTMLElement>(testId: string) => document.querySelector<T>(`[data-testid="${testId}"]`)!

/** The host must sit exactly over the slot of the container that shows the pane. */
function expectAligned(id: string, chromeKey: string) {
  const slot = q(`chrome-${chromeKey}`).querySelector('[data-spaces-slot]')!.getBoundingClientRect()
  const rect = host(id).getBoundingClientRect()
  expect(host(id).style.visibility).toBe('visible')
  for (const side of ['left', 'top', 'width', 'height'] as const) {
    expect(Math.abs(rect[side] - slot[side])).toBeLessThan(0.5)
  }
  expect(slot.width).toBeGreaterThan(50)
  expect(slot.height).toBeGreaterThan(50)
}

async function loaded(iframe: HTMLIFrameElement) {
  await expect.poll(() => iframe.contentDocument?.body?.textContent).toBe('frame')
}

test('a pane keeps its DOM, scroll, iframe and focus through every placement', async () => {
  const store = createLayoutStore(
    createLayout({ root: row(group(['a', 'b']), column(group(['c']), group(['d']))) }),
  )
  await render(<Harness store={store} />)
  const groupOf = (id: string) => findHomeGroup(store.getState().root, id)!.id

  const element = host('a')
  // Records every node added to or removed from the layout root, to prove the host is never one of them.
  const moved: Node[] = []
  const watcher = new MutationObserver((records) => {
    for (const record of records) moved.push(...record.addedNodes, ...record.removedNodes)
  })
  watcher.observe(element.parentElement!, { childList: true })
  const scroller = q('scroll-a')
  const input = q<HTMLInputElement>('input-a')
  const iframe = q<HTMLIFrameElement>('frame-a')
  await loaded(iframe)
  ;(iframe.contentWindow as unknown as { marker: string }).marker = 'alive'
  input.value = 'typed'
  // Focusing would scroll the input into view, so focus first and scroll after.
  input.focus({ preventScroll: true })
  scroller.scrollTop = 120
  expectAligned('a', `group:${groupOf('a')}`)

  const check = async (chromeKey: string) => {
    await frame()
    expectAligned('a', chromeKey)
    expect(host('a')).toBe(element)
    expect(moved.includes(element)).toBe(false)
    expect(mounts.a).toBe(1)
    expect(unmounts.a).toBeUndefined()
    expect(scroller.scrollTop).toBe(120)
    expect((iframe.contentWindow as unknown as { marker?: string }).marker).toBe('alive')
    expect(input.value).toBe('typed')
    expect(document.activeElement).toBe(input)
  }

  // Into another group, as a tab.
  store.update((s) => movePane(s, 'a', { type: 'group', groupId: groupOf('c') }))
  await check(`group:${groupOf('c')}`)

  // Into a new group split off beside another.
  store.update((s) => movePane(s, 'a', { type: 'split', groupId: groupOf('d'), side: 'right' }))
  await check(`group:${groupOf('a')}`)

  // To a pinned edge, then the same edge as an overlay.
  store.update((s) => movePane(s, 'a', { type: 'edge', edge: 'left' }))
  await check('edge:left')
  store.update((s) => updateEdge(s, 'left', { mode: 'overlay' }))
  await check('edge:left')

  // Into a floating window.
  store.update((s) => movePane(s, 'a', { type: 'floating', rect: { x: 200, y: 100, width: 400, height: 300 } }))
  await check(`floating:${store.getState().floating[0]!.id}`)

  // Back to the slot it left.
  const home = groupOf('a')
  store.update((s) => restorePane(s, 'a'))
  await check(`group:${home}`)
})

test('adding and removing other panes leaves a pane untouched', async () => {
  const store = createLayoutStore(createLayout({ root: row(group(['before', 'keep', 'after'], { active: 'keep' }), group(['other'])) }))
  await render(<Harness store={store} />)
  const element = host('keep')
  const scroller = q('scroll-keep')
  const input = q<HTMLInputElement>('input-keep')
  const iframe = q<HTMLIFrameElement>('frame-keep')
  await loaded(iframe)
  ;(iframe.contentWindow as unknown as { marker: string }).marker = 'alive'
  input.focus({ preventScroll: true })
  scroller.scrollTop = 90

  const moved: Node[] = []
  const watcher = new MutationObserver((records) => {
    for (const record of records) moved.push(...record.addedNodes, ...record.removedNodes)
  })
  watcher.observe(element.parentElement!, { childList: true })

  const groupId = findHomeGroup(store.getState().root, 'keep')!.id
  store.update((s) => removePane(s, 'before'))
  store.update((s) => addPane(s, 'new-1', { type: 'group', groupId, index: 0 }))
  store.update((s) => removePane(s, 'after'))
  store.update((s) => addPane(s, 'new-2', { type: 'floating' }))
  store.update((s) => removePane(s, 'other'))
  store.update((s) => showPane(s, 'keep'))
  await frame()

  expect(moved.length).toBeGreaterThan(0)
  expect(moved.includes(element)).toBe(false)
  expect(mounts.keep).toBe(1)
  expect(scroller.scrollTop).toBe(90)
  expect((iframe.contentWindow as unknown as { marker?: string }).marker).toBe('alive')
  expect(document.activeElement).toBe(input)
  expectAligned('keep', `group:${groupId}`)
})

test('hidden and inactive panes stay mounted but are not shown', async () => {
  const store = createLayoutStore(createLayout({ root: row(group(['x', 'y']), group(['z'])) }))
  await render(<Harness store={store} />)
  const scroller = q('scroll-z')
  scroller.scrollTop = 80

  expect(host('y').style.visibility).toBe('hidden')
  expect(host('y').inert).toBe(true)
  expect(mounts.y).toBe(1)

  store.update((s) => hidePane(s, 'z'))
  await frame()
  expect(host('z').style.visibility).toBe('hidden')
  expect(document.querySelectorAll('[data-spaces-group]')).toHaveLength(1)

  store.update((s) => showPane(s, 'z'))
  await frame()
  expect(host('z').style.visibility).toBe('visible')
  expect(scroller.scrollTop).toBe(80)
  expect(mounts.z).toBe(1)
})

test('a divider resizes its two neighbours with the pointer and the keyboard', async () => {
  const store = createLayoutStore(createLayout({ root: row(group(['l']), group(['r'])) }))
  await render(<Harness store={store} />)
  const sash = document.querySelector<HTMLElement>('[data-spaces-sash="split"]')!
  const widths = () =>
    [...document.querySelectorAll<HTMLElement>('[data-spaces-group]')].map((el) => el.getBoundingClientRect().width)
  const [left, right] = widths()
  expect(Math.abs(left! - right!)).toBeLessThan(1)

  sash.focus()
  sash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await frame()
  expect(widths()[0]! - left!).toBeCloseTo(16, 0)
  expect(widths()[0]! + widths()[1]!).toBeCloseTo(left! + right!, 0)

  const y = sash.getBoundingClientRect().top + 10
  const x = sash.getBoundingClientRect().left + 2
  const pointer = (type: string, clientX: number) =>
    sash.dispatchEvent(new PointerEvent(type, { clientX, clientY: y, button: 0, pointerId: 1, bubbles: true }))
  pointer('pointerdown', x)
  pointer('pointermove', x - 100)
  pointer('pointerup', x - 100)
  await frame()
  expect(widths()[0]! - left!).toBeCloseTo(16 - 100, 0)
  expectAligned('l', `group:${findHomeGroup(store.getState().root, 'l')!.id}`)

  // The minimum size stops the divider.
  pointer('pointerdown', x - 100)
  pointer('pointermove', x - 2000)
  pointer('pointerup', x - 2000)
  await frame()
  expect(widths()[0]).toBeCloseTo(48, 0)
})

test('a layout nested in a pane has its own panes and dividers', async () => {
  const inner = createLayoutStore(createLayout({ root: column(group(['i1']), group(['i2'])) }))
  const outer = createLayoutStore(createLayout({ root: row(group(['o1']), group(['o2'])) }))
  await render(
    <Layout
      store={outer}
      style={{ width: 800, height: 500 }}
      renderContainer={() => <PaneSlot />}
      renderPane={(id) =>
        id === 'o2' ? (
          <Layout
            store={inner}
            style={{ width: '100%', height: '100%' }}
            renderContainer={() => <PaneSlot />}
            renderPane={(innerId) => <div data-testid={`inner-${innerId}`}>{innerId}</div>}
          />
        ) : (
          <div>{id}</div>
        )
      }
    />,
  )
  await frame()
  const innerHost = q('inner-i1').parentElement!
  const outerHost = host('o2')
  expect(outerHost.contains(innerHost)).toBe(true)
  const before = innerHost.getBoundingClientRect()
  expect(before.width).toBeGreaterThan(300)

  // Resizing the outer layout moves the inner panes with it; the inner state is untouched.
  const innerState = inner.getState()
  const [first, second] = [...document.querySelectorAll<HTMLElement>('[data-spaces-group]')]
  outer.update((s) => movePane(s, 'o1', { type: 'edge', edge: 'bottom' }))
  await frame()
  expect(first && second).toBeTruthy()
  expect(q('inner-i1').parentElement!.getBoundingClientRect().width).toBeGreaterThan(before.width + 100)
  expect(inner.getState()).toBe(innerState)
})
