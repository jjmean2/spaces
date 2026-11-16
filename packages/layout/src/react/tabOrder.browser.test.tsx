import { useState } from 'react'
import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import {
  Layout,
  PaneSlot,
  addPane,
  createLayout,
  createLayoutStore,
  group,
  movePane,
  row,
  showPane,
  useLayoutStore,
  useTabDrag,
} from '../index.ts'
import type { ContainerRenderProps, LayoutStore, PaneId } from '../index.ts'

function Tab({ id }: { id: PaneId }) {
  const store = useLayoutStore()
  return (
    <button type="button" {...useTabDrag(id)} data-testid={`tab-${id}`} onClick={() => store.update((s) => showPane(s, id))}>
      {id}
    </button>
  )
}

const chrome = ({ panes }: ContainerRenderProps) => (
  <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0, minHeight: 0 }}>
    <div style={{ display: 'flex', height: 24 }}>
      {panes.map((id) => (
        <Tab key={id} id={id} />
      ))}
    </div>
    <PaneSlot />
  </div>
)

let addExtra: (() => void) | undefined

function Content({ id }: { id: PaneId }) {
  const [extra, setExtra] = useState(false)
  if (id === 'a') addExtra = () => setExtra(true)
  return (
    <div>
      <button type="button" data-testid={`${id}-1`}>
        {id} one
      </button>
      <button type="button" data-testid={`${id}-2`}>
        {id} two
      </button>
      {extra && (
        <button type="button" data-testid={`${id}-3`}>
          {id} three
        </button>
      )}
    </div>
  )
}
const content = (id: PaneId) => <Content id={id} />

function Page({ store, children }: { store: LayoutStore; children?: (id: PaneId) => React.ReactNode }) {
  return (
    <div>
      <button type="button" data-testid="before">
        before
      </button>
      <Layout store={store} style={{ width: 900, height: 400 }} renderContainer={chrome} renderPane={children ?? content} />
      <button type="button" data-testid="after">
        after
      </button>
    </div>
  )
}

const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))))
const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
/** What has focus: a test id, or `sash` for a divider, which is a stop of its own for resizing by keyboard. */
const focused = () => {
  const element = document.activeElement as HTMLElement | null
  if (element?.hasAttribute('data-spaces-sash')) return 'sash'
  return element?.dataset.testid ?? element?.tagName
}

/** Press Tab (or Shift+Tab) `count` times with the real keyboard and list where focus went. */
async function walk(count: number, backward = false): Promise<(string | undefined)[]> {
  const seen: (string | undefined)[] = []
  for (let i = 0; i < count; i++) {
    await commands.pointer(backward ? [['keydown', 'Shift'], ['press', 'Tab'], ['keyup', 'Shift']] : [['press', 'Tab']])
    seen.push(focused())
  }
  return seen
}

/**
 * Pane b is created first and a's group is added to its left afterwards, so the DOM holds b's
 * content before a's while the screen shows a first. DOM order would visit them the wrong way round.
 */
function reversed() {
  const store = createLayoutStore(createLayout({ root: group(['b']) }))
  store.update((s) => addPane(s, 'a', { type: 'root', side: 'left' }))
  store.update((s) => addPane(s, 'a2', { type: 'group', groupId: findGroupOf(s, 'a') }))
  store.update((s) => showPane(s, 'a'))
  return store
}
const findGroupOf = (s: ReturnType<LayoutStore['getState']>, paneId: string) => {
  const visit = (node: NonNullable<typeof s.root>): string | undefined =>
    node.type === 'group' ? (node.panes.includes(paneId) ? node.id : undefined) : node.children.map(visit).find(Boolean)
  return visit(s.root!)!
}

const FORWARD = ['tab-a', 'tab-a2', 'a-1', 'a-2', 'sash', 'tab-b', 'b-1', 'b-2', 'after']

test('Tab goes through each container and its pane in the order on screen', async () => {
  const store = reversed()
  await render(<Page store={store} />)
  await frame()
  const hosts = [...document.querySelectorAll('[data-spaces-pane]')].map((h) => h.getAttribute('data-spaces-pane'))
  expect(hosts).toEqual(['b', 'a', 'a2'])

  q('before').focus()
  expect(await walk(FORWARD.length)).toEqual(FORWARD)
})

test('Shift+Tab goes back the same way, and enters the layout at its last stop', async () => {
  const store = reversed()
  await render(<Page store={store} />)
  await frame()
  q('after').focus()
  expect(await walk(FORWARD.length, true)).toEqual([...FORWARD.slice(0, -1).reverse(), 'before'])
})

test('a hidden tab’s content is skipped, and content added later takes its place in the order', async () => {
  const store = reversed()
  await render(<Page store={store} />)
  await frame()
  q('tab-a').focus()
  // a2 is not the active tab: its content is not on screen.
  expect(await walk(3)).toEqual(['tab-a2', 'a-1', 'a-2'])

  q('after').focus()
  addExtra!()
  await frame()
  q('a-2').focus()
  expect(await walk(3)).toEqual(['a-3', 'sash', 'tab-b'])
})

test('Tab continues from a pane that was pressed, not from the start', async () => {
  const store = reversed()
  await render(<Page store={store} />)
  await frame()
  // A press on the empty part of pane b.
  const host = document.querySelector('[data-spaces-pane="b"]')!.getBoundingClientRect()
  await commands.pointer([['move', host.left + host.width / 2, host.bottom - 20], ['down'], ['up']])
  expect(await walk(2)).toEqual(['b-1', 'b-2'])
})

test('a floating window comes after the tiled groups', async () => {
  const store = reversed()
  store.update((s) => movePane(s, 'a2', { type: 'floating', rect: { x: 300, y: 100, width: 300, height: 200 } }))
  await render(<Page store={store} />)
  await frame()
  q('b-2').focus()
  expect(await walk(4)).toEqual(['tab-a2', 'a2-1', 'a2-2', 'after'])
  expect(await walk(3, true)).toEqual(['a2-2', 'a2-1', 'tab-a2'])
})

test('a nested layout is walked at the place of the pane that holds it', async () => {
  const inner = createLayoutStore(createLayout({ root: group(['y']) }))
  inner.update((s) => addPane(s, 'x', { type: 'root', side: 'left' }))
  const outer = createLayoutStore(createLayout({ root: row(group(['a']), group(['nest']), group(['b'])) }))
  await render(
    <Page store={outer}>
      {(id) =>
        id === 'nest' ? (
          <Layout store={inner} style={{ width: '100%', height: '100%' }} renderContainer={chrome} renderPane={content} />
        ) : (
          content(id)
        )
      }
    </Page>,
  )
  await frame()
  const order = [
    'tab-a', 'a-1', 'a-2', 'sash',
    'tab-nest', 'tab-x', 'x-1', 'x-2', 'sash', 'tab-y', 'y-1', 'y-2', 'sash',
    'tab-b', 'b-1', 'b-2',
    'after',
  ]
  q('before').focus()
  expect(await walk(order.length)).toEqual(order)
  expect(await walk(order.length, true)).toEqual([...order.slice(0, -1).reverse(), 'before'])
})

test('tabs and panes are tied together for assistive technology', async () => {
  const store = reversed()
  await render(<Page store={store} />)
  await frame()
  const host = document.querySelector<HTMLElement>('[data-spaces-pane="a"]')!
  const tab = q('tab-a')
  expect(host.getAttribute('role')).toBe('tabpanel')
  expect(tab.getAttribute('aria-controls')).toBe(host.id)
  expect(host.getAttribute('aria-labelledby')).toBe(tab.id)
  const slot = tab.closest('[data-spaces-group]')!.querySelector('[data-spaces-slot]')!
  expect(slot.getAttribute('aria-owns')).toBe(host.id)
})

test('leaving an iframe continues in the order on screen', async () => {
  // Pane a holds an iframe and is shown first, but its content is last in the DOM.
  const store = createLayoutStore(createLayout({ root: group(['b']) }))
  store.update((s) => addPane(s, 'a', { type: 'root', side: 'left' }))
  const withFrame = (id: PaneId) =>
    id === 'a' ? (
      <div>
        <iframe data-testid="frame" srcDoc="<button id=in1>one</button><button id=in2>two</button>" style={{ width: 200, height: 60 }} />
      </div>
    ) : (
      content(id)
    )
  await render(<Page store={store}>{withFrame}</Page>)
  const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="frame"]')!
  await expect.poll(() => iframe.contentDocument?.getElementById('in2')).toBeTruthy()
  await frame()
  const where = () =>
    document.activeElement === iframe ? `frame:${iframe.contentDocument!.activeElement?.id || 'body'}` : focused()
  const step = async (backward = false) => {
    await commands.pointer(backward ? [['keydown', 'Shift'], ['press', 'Tab'], ['keyup', 'Shift']] : [['press', 'Tab']])
    return where()
  }

  // Forward: out of the iframe to the divider and the next group, not to the end of the layout.
  q('tab-a').focus()
  const forward: (string | undefined)[] = []
  for (let i = 0; i < 6; i++) forward.push(await step())
  expect(forward.slice(-3)).toEqual(['sash', 'tab-b', 'b-1'])
  expect(forward).toContain('frame:in2')

  // Backward: the iframe is the first thing in its pane, so the browser would go to pane b.
  q('tab-b').focus()
  const backward: (string | undefined)[] = []
  for (let i = 0; i < 6; i++) backward.push(await step(true))
  expect(backward[0]).toBe('sash')
  // Out of the iframe's first element to the tab above it, then out of the layout.
  expect(backward.slice(backward.indexOf('frame:in1'))).toEqual(['frame:in1', 'tab-a', 'before'])
})
