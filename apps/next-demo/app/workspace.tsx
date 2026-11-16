'use client'

import {
  EDGES,
  Layout,
  PaneSlot,
  addPane,
  createLayoutStore,
  groups,
  hiddenPanes,
  hidePane,
  movePane,
  removePane,
  restorePane,
  showPane,
  updateEdge,
  useLayoutState,
  useLayoutStore,
  usePaneId,
  useWindowDrag,
} from '@spaces/layout'
import type { ContainerRenderProps, Edge, LayoutState, WindowId } from '@spaces/layout'
import { useEffect, useState } from 'react'
import { LAYOUT_COOKIE, LAYOUT_COOKIE_MAX_LENGTH } from './layout-cookie'

export function Workspace({ initial, restored }: { initial: LayoutState; restored: boolean }) {
  // One store per mounted workspace. A store at module scope would be shared by every request on the server.
  const [store] = useState(() => createLayoutStore(initial))
  const state = useLayoutState(store)

  useEffect(
    () =>
      store.subscribe(() => {
        const value = encodeURIComponent(JSON.stringify(store.getState()))
        // Too large to save: drop the cookie, so a reload does not restore an older arrangement.
        const fits = value.length <= LAYOUT_COOKIE_MAX_LENGTH
        document.cookie = fits
          ? `${LAYOUT_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`
          : `${LAYOUT_COOKIE}=; path=/; max-age=0`
      }),
    [store],
  )

  const add = () => {
    const taken = Object.keys(state.panes)
    let n = 1
    while (taken.includes(`pane-${n}`)) n++
    const first = [...groups(state.root)][0]
    store.update((s) =>
      addPane(s, `pane-${n}`, first ? { type: 'group', groupId: first.id } : { type: 'root', side: 'right' }),
    )
  }

  const reset = () => {
    document.cookie = `${LAYOUT_COOKIE}=; path=/; max-age=0`
    window.location.reload()
  }

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Spaces — Next.js demo</strong>
        <span className="label">{restored ? 'Restored from cookie on the server' : 'Default layout'}</span>
        <button type="button" onClick={add}>
          Add pane
        </button>
        <button type="button" onClick={reset}>
          Reset layout
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
      <Layout store={store} className="layout" renderPane={renderPane} renderContainer={renderContainer} />
    </div>
  )
}

// Defined once, so dragging a divider does not re-render every pane.
const renderPane = () => <DemoPane />
const renderContainer = (props: ContainerRenderProps) => <Chrome {...props} />

const DOCK_TARGETS: Edge[] = ['left', 'bottom', 'right']

function Chrome({ container, panes, active }: ContainerRenderProps) {
  const store = useLayoutStore()
  const state = useLayoutState(store)
  const act = (fn: (s: LayoutState) => LayoutState) => () => store.update(fn)
  const dock = container.type === 'edge' ? state.edges[container.edge] : null

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
            {container.type !== 'group' && (
              <button type="button" onClick={act((s) => restorePane(s, active))}>
                Restore
              </button>
            )}
            {container.type === 'group' && panes.length > 1 && (
              <button
                type="button"
                onClick={act((s) => movePane(s, active, { type: 'split', groupId: container.id, side: 'right' }))}
              >
                Split
              </button>
            )}
            {DOCK_TARGETS.filter((edge) => !(container.type === 'edge' && container.edge === edge)).map((edge) => (
              <button key={edge} type="button" onClick={act((s) => movePane(s, active, { type: 'edge', edge }))}>
                Dock {edge}
              </button>
            ))}
            {container.type !== 'floating' && (
              <button type="button" onClick={act((s) => movePane(s, active, { type: 'floating' }))}>
                Float
              </button>
            )}
            <button type="button" onClick={act((s) => hidePane(s, active))}>
              Hide
            </button>
            <button type="button" onClick={act((s) => removePane(s, active))}>
              Close
            </button>
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
