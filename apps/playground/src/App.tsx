import { useMemo, useState } from 'react'
import {
  EDGES,
  Layout,
  PaneSlot,
  addPane,
  column,
  createLayout,
  createLayoutStore,
  group,
  hiddenPanes,
  hidePane,
  movePane,
  removePane,
  restorePane,
  row,
  showPane,
  updateEdge,
  useLayoutState,
  useLayoutStore,
  usePaneId,
  useWindowDrag,
} from '@spaces/layout'
import type { ContainerRenderProps, Edge, LayoutState, WindowId } from '@spaces/layout'
import './app.css'

const initial = () =>
  createLayout({
    root: row(group(['editor-1', 'editor-2'], { weight: 2 }), column(group(['preview']), group(['terminal']))),
    edges: { left: { panes: ['files', 'search'], size: 220 } },
  })

export function App() {
  const store = useMemo(() => createLayoutStore(initial()), [])
  const state = useLayoutState(store)
  const [count, setCount] = useState(1)
  const firstGroup = state.root && findFirstGroup(state)

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Spaces playground</strong>
        <button
          type="button"
          onClick={() => {
            const id = `pane-${count}`
            setCount(count + 1)
            store.update((s) =>
              addPane(s, id, firstGroup ? { type: 'group', groupId: firstGroup } : { type: 'root', side: 'right' }),
            )
          }}
        >
          Add pane
        </button>
        <span className="label">Closed docks:</span>
        {EDGES.filter((edge) => state.edges[edge].panes.length > 0 && !state.edges[edge].open).map((edge) => (
          <button key={edge} type="button" onClick={() => store.update((s) => updateEdge(s, edge, { open: true }))}>
            {edge} ({state.edges[edge].panes.length})
          </button>
        ))}
        <span className="label">Hidden:</span>
        {hiddenPanes(state).map((id) => (
          <button key={id} type="button" onClick={() => store.update((s) => showPane(s, id))}>
            {id}
          </button>
        ))}
      </header>
      <Layout
        store={store}
        className="layout"
        renderPane={() => <DemoPane />}
        renderContainer={(props) => <Chrome {...props} />}
      />
    </div>
  )
}

function findFirstGroup(state: LayoutState): string | null {
  const visit = (node: NonNullable<LayoutState['root']>): string => (node.type === 'group' ? node.id : visit(node.children[0]!))
  return state.root ? visit(state.root) : null
}

function Chrome({ container, panes, active }: ContainerRenderProps) {
  const store = useLayoutStore()
  const state = useLayoutState(store)
  const act = (fn: (s: LayoutState) => LayoutState) => () => store.update(fn)
  const dock = container.type === 'edge' ? state.edges[container.edge] : null
  const tiled = container.type === 'group'

  return (
    <section className="chrome" data-kind={container.type}>
      <div className="tabs" role="tablist">
        {container.type === 'floating' && <WindowGrip id={container.id} />}
        {panes.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === active}
            className="tab"
            onClick={act((s) => showPane(s, id))}
          >
            {id}
          </button>
        ))}
        {active && (
          <span className="actions">
            {!tiled && <button type="button" onClick={act((s) => restorePane(s, active))}>Restore</button>}
            {tiled && panes.length > 1 && (
              <button
                type="button"
                onClick={act((s) => movePane(s, active, { type: 'split', groupId: container.id, side: 'right' }))}
              >
                Split
              </button>
            )}
            {(['left', 'bottom', 'right'] satisfies Edge[]).map(
              (edge) =>
                !(container.type === 'edge' && container.edge === edge) && (
                  <button key={edge} type="button" onClick={act((s) => movePane(s, active, { type: 'edge', edge }))}>
                    Dock {edge}
                  </button>
                ),
            )}
            {container.type !== 'floating' && (
              <button type="button" onClick={act((s) => movePane(s, active, { type: 'floating' }))}>Float</button>
            )}
            <button type="button" onClick={act((s) => hidePane(s, active))}>Hide</button>
            <button type="button" onClick={act((s) => removePane(s, active))}>Close</button>
            {dock && container.type === 'edge' && (
              <>
                <button
                  type="button"
                  onClick={act((s) =>
                    updateEdge(s, container.edge, { mode: dock.mode === 'pinned' ? 'overlay' : 'pinned' }),
                  )}
                >
                  {dock.mode === 'pinned' ? 'Overlay' : 'Pin'}
                </button>
                <button type="button" onClick={act((s) => updateEdge(s, container.edge, { open: false }))}>
                  Collapse
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <PaneSlot />
    </section>
  )
}

function WindowGrip({ id }: { id: WindowId }) {
  const drag = useWindowDrag(id)
  return (
    <span className="grip" {...drag} title="Drag to move">
      ⠿
    </span>
  )
}

/** Holds state of its own, so it is easy to see that moving the pane does not reset it. */
function DemoPane() {
  const id = usePaneId()
  const [clicks, setClicks] = useState(0)
  return (
    <div className="pane">
      <h2>{id}</h2>
      <p>
        <button type="button" onClick={() => setClicks(clicks + 1)}>
          Clicked {clicks} times
        </button>{' '}
        <input placeholder="Type here, then move the pane" />
      </p>
      <ol>
        {Array.from({ length: 60 }, (_, i) => (
          <li key={i}>Row {i + 1} — scroll, then move the pane</li>
        ))}
      </ol>
    </div>
  )
}
