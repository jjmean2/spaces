import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import {
  findNode,
  isNodeVacant,
  isPaneVisible,
  paneContainerRef,
  presentPanes,
  raiseWindow,
  resizePair,
  setWeights,
  setWindowRect,
  updateEdge,
} from '../core/index.ts'
import type {
  ContainerRef,
  Edge,
  LayoutNode,
  LayoutState,
  PaneId,
  WindowId,
} from '../core/index.ts'
import {
  ContainerContext,
  LayoutContext,
  PaneContext,
  containerKey,
  useLayoutStore,
  useSlotRegistration,
} from './context.ts'
import type { LayoutInternals } from './context.ts'
import { Sash } from './Sash.tsx'
import { useLayoutState } from './store.ts'
import type { LayoutStore } from './store.ts'

export interface ContainerRenderProps {
  /** The group, edge dock or floating window being drawn. */
  container: ContainerRef
  /** The panes shown in it, in tab order. */
  panes: PaneId[]
  active: PaneId | null
}

export interface LayoutProps {
  store: LayoutStore
  /** Content of a pane. Rendered once per pane and kept mounted while the pane moves around. */
  renderPane(paneId: PaneId): ReactNode
  /**
   * Chrome of a group, edge dock or floating window: tabs, title, buttons.
   * Render a `<PaneSlot />` where the active pane's content should appear.
   */
  renderContainer(props: ContainerRenderProps): ReactNode
  /** Smallest size in pixels a divider can shrink a region to. */
  minSize?: number
  className?: string
  style?: CSSProperties
}

const FILL: CSSProperties = { display: 'flex', minWidth: 0, minHeight: 0 }

/** Stacking order inside the layout root. Chrome and pane content interleave, so both are set here. */
const Z = {
  tiledPane: 1,
  overlayChrome: 2,
  overlayPane: 3,
  windowChrome: (index: number) => 10 + index * 2,
  windowPane: (index: number) => 11 + index * 2,
}

export function Layout({
  store,
  renderPane,
  renderContainer,
  minSize = 48,
  className,
  style,
}: LayoutProps) {
  const state = useLayoutState(store)
  const rootRef = useRef<HTMLDivElement>(null)
  const slots = useRef(new Map<string, HTMLElement>())
  const hosts = useRef(new Map<PaneId, HTMLElement>())
  const observer = useRef<ResizeObserver | null>(null)

  // Place every pane's host element over the slot of the container that shows it.
  // Hosts are never re-parented or reordered, so nothing inside them is reset by a move.
  const sync = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const current = store.getState()
    const origin = root.getBoundingClientRect()
    const originX = origin.left + root.clientLeft
    const originY = origin.top + root.clientTop

    for (const [paneId, host] of hosts.current) {
      const ref = paneContainerRef(current, paneId)
      const slot = ref && slots.current.get(containerKey(ref))
      const shown = Boolean(slot) && isPaneVisible(current, paneId)
      if (shown && slot && ref) {
        const rect = slot.getBoundingClientRect()
        host.style.left = `${rect.left - originX}px`
        host.style.top = `${rect.top - originY}px`
        host.style.width = `${rect.width}px`
        host.style.height = `${rect.height}px`
        host.style.zIndex = String(paneZ(current, ref))
        host.style.visibility = 'visible'
        host.inert = false
      } else {
        // Keep the last size so hidden content does not reflow.
        host.style.visibility = 'hidden'
        host.inert = true
      }
      host.dataset.spacesVisible = String(shown)
    }
  }, [store])

  const getObserver = useCallback(() => {
    if (!observer.current && typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(() => sync())
    }
    return observer.current
  }, [sync])

  const internals = useMemo<LayoutInternals>(
    () => ({
      store,
      registerSlot(key, element) {
        const previous = slots.current.get(key)
        if (previous && previous !== element) getObserver()?.unobserve(previous)
        if (element) {
          slots.current.set(key, element)
          getObserver()?.observe(element)
        } else {
          slots.current.delete(key)
        }
      },
    }),
    [store, getObserver],
  )

  useLayoutEffect(() => {
    const root = rootRef.current
    if (root) getObserver()?.observe(root)
    // Slots register through refs, which are not attached again when this effect is re-run.
    for (const slot of slots.current.values()) getObserver()?.observe(slot)
    return () => {
      observer.current?.disconnect()
      observer.current = null
    }
  }, [getObserver])

  // After every commit: the tree, an edge or a window may have moved a slot without resizing it.
  useLayoutEffect(sync)

  // Panes are listed in the order they were first seen and never reordered.
  const order = useRef<PaneId[]>([])
  order.current = [
    ...order.current.filter((id) => id in state.panes),
    ...Object.keys(state.panes).filter((id) => !order.current.includes(id)),
  ]

  const registerHost = useCallback((paneId: PaneId, element: HTMLElement | null) => {
    if (element) hosts.current.set(paneId, element)
    else hosts.current.delete(paneId)
  }, [])

  const renderChrome = (ref: ContainerRef) => (
    <ContainerContext.Provider value={ref}>
      {renderContainer({
        container: ref,
        panes: presentPanes(state, ref),
        active: (ref.type === 'edge'
          ? state.edges[ref.edge]
          : ref.type === 'floating'
            ? state.floating.find((w) => w.id === ref.id)
            : (findNode(state.root, ref.id) as { active: PaneId | null } | undefined)
        )?.active ?? null,
      })}
    </ContainerContext.Provider>
  )

  const edgeShown = (edge: Edge) => state.edges[edge].open && state.edges[edge].active !== null

  const renderEdge = (edge: Edge) => {
    if (!edgeShown(edge)) return null
    const dock = state.edges[edge]
    const horizontal = edge === 'left' || edge === 'right'
    const leading = edge === 'left' || edge === 'top'
    const overlay = dock.mode === 'overlay'
    const sash = (
      <Sash
        kind="edge"
        axis={horizontal ? 'x' : 'y'}
        label={`Resize ${edge} dock`}
        begin={() => {
          const root = rootRef.current
          if (!root) return null
          const extent = horizontal ? root.clientWidth : root.clientHeight
          return { size: store.getState().edges[edge].size, max: Math.max(minSize, extent - minSize) }
        }}
        apply={(start, delta) => {
          const size = Math.min(Math.max(start.size + (leading ? delta : -delta), minSize), start.max)
          store.update((s) => updateEdge(s, edge, { size }))
        }}
      />
    )
    const box: CSSProperties = overlay
      ? {
          position: 'absolute',
          zIndex: Z.overlayChrome,
          [horizontal ? 'top' : 'left']: 0,
          [horizontal ? 'bottom' : 'right']: 0,
          [edge]: 0,
          [horizontal ? 'width' : 'height']: dock.size,
        }
      : { flex: `0 0 ${dock.size}px` }
    return (
      <div
        key={edge}
        data-spaces-edge={edge}
        data-mode={dock.mode}
        style={{ ...FILL, ...box, flexDirection: horizontal ? 'row' : 'column' }}
      >
        {!leading && sash}
        <div style={{ ...FILL, flex: '1 1 0' }}>{renderChrome({ type: 'edge', edge })}</div>
        {leading && sash}
      </div>
    )
  }

  const pinned = (edge: Edge) => (state.edges[edge].mode === 'pinned' ? renderEdge(edge) : null)
  const overlaid = (edge: Edge) => (state.edges[edge].mode === 'overlay' ? renderEdge(edge) : null)

  const renderNode = (node: LayoutNode, grow: number): ReactNode => {
    const flex = `${grow} 1 0px`
    if (node.type === 'group') {
      return (
        <div key={node.id} data-spaces-group={node.id} style={{ ...FILL, flex }}>
          {renderChrome({ type: 'group', id: node.id })}
        </div>
      )
    }
    const shown = node.children.filter((child) => !isNodeVacant(state, child))
    const total = shown.reduce((sum, child) => sum + child.weight, 0)
    const axis = node.orientation === 'row' ? 'x' : 'y'
    return (
      <div
        key={node.id}
        data-spaces-split={node.id}
        data-orientation={node.orientation}
        style={{ ...FILL, flex, flexDirection: node.orientation }}
      >
        {shown.map((child, index) => {
          const next = shown[index + 1]
          return (
            <Fragment key={child.id}>
              {/* Grow factors are scaled to add up to 100: a total below 1 would not fill the split. */}
              {renderNode(child, (child.weight / total) * 100)}
              {next && (
                <Sash
                  kind="split"
                  axis={axis}
                  value={(child.weight / (child.weight + next.weight)) * 100}
                  begin={(element) => {
                    const before = element.previousElementSibling?.getBoundingClientRect()
                    const after = element.nextElementSibling?.getBoundingClientRect()
                    if (!before || !after) return null
                    const extent = (rect: DOMRect) => (axis === 'x' ? rect.width : rect.height)
                    return {
                      ids: [child.id, next.id] as const,
                      weights: [child.weight, next.weight] as const,
                      sizes: [extent(before), extent(after)] as const,
                    }
                  }}
                  apply={(start, delta) => {
                    const [a, b] = resizePair({ ...start, delta, min: minSize })
                    store.update((s) => setWeights(s, { [start.ids[0]]: a, [start.ids[1]]: b }))
                  }}
                />
              )}
            </Fragment>
          )
        })}
      </div>
    )
  }

  const rootNode = state.root && !isNodeVacant(state, state.root) ? state.root : null
  // Rendered in a stable order; stacking is done with z-index so raising a window moves no DOM.
  const windows = state.floating
    .map((win, index) => ({ win, index }))
    .filter(({ win }) => win.active !== null)
    .sort((a, b) => a.win.id.localeCompare(b.win.id, undefined, { numeric: true }))

  return (
    <LayoutContext.Provider value={internals}>
      <div
        ref={rootRef}
        className={className}
        data-spaces-layout=""
        style={{ ...style, ...FILL, position: 'relative', isolation: 'isolate', overflow: 'hidden' }}
      >
        {pinned('left')}
        <div style={{ ...FILL, flex: '1 1 0', flexDirection: 'column', position: 'relative' }}>
          {pinned('top')}
          <div data-spaces-center="" style={{ ...FILL, flex: '1 1 0' }}>
            {rootNode && renderNode(rootNode, 1)}
          </div>
          {pinned('bottom')}
          {overlaid('top')}
          {overlaid('bottom')}
        </div>
        {pinned('right')}
        {overlaid('left')}
        {overlaid('right')}

        {windows.map(({ win, index }) => (
          <div
            key={win.id}
            data-spaces-window={win.id}
            style={{
              ...FILL,
              position: 'absolute',
              left: win.rect.x,
              top: win.rect.y,
              width: win.rect.width,
              height: win.rect.height,
              zIndex: Z.windowChrome(index),
            }}
            onPointerDownCapture={() => store.update((s) => raiseWindow(s, win.id))}
          >
            {renderChrome({ type: 'floating', id: win.id })}
          </div>
        ))}

        {order.current.map((paneId) => (
          <PaneHost key={paneId} paneId={paneId} store={store} register={registerHost} render={renderPane} />
        ))}
      </div>
    </LayoutContext.Provider>
  )
}

function paneZ(state: LayoutState, ref: ContainerRef): number {
  if (ref.type === 'floating') return Z.windowPane(state.floating.findIndex((w) => w.id === ref.id))
  if (ref.type === 'edge' && state.edges[ref.edge].mode === 'overlay') return Z.overlayPane
  return Z.tiledPane
}

interface PaneHostProps {
  paneId: PaneId
  store: LayoutStore
  register(paneId: PaneId, element: HTMLElement | null): void
  render(paneId: PaneId): ReactNode
}

/** One stable element per pane. Its position is written by `sync`, not by React. */
const PaneHost = memo(function PaneHost({ paneId, store, register, render }: PaneHostProps) {
  const ref = useCallback((element: HTMLElement | null) => register(paneId, element), [paneId, register])
  const raise = () => {
    const placement = store.getState().panes[paneId]?.placement
    if (placement?.type === 'floating') store.update((s) => raiseWindow(s, placement.windowId))
  }
  return (
    <div
      ref={ref}
      data-spaces-pane={paneId}
      style={{ position: 'absolute', overflow: 'hidden', visibility: 'hidden' }}
      onPointerDownCapture={raise}
    >
      <PaneContext.Provider value={paneId}>{render(paneId)}</PaneContext.Provider>
    </div>
  )
})

export interface PaneSlotProps {
  className?: string
  style?: CSSProperties
}

/** Marks where the active pane's content appears inside container chrome. */
export function PaneSlot({ className, style }: PaneSlotProps) {
  const { key, register } = useSlotRegistration()
  const ref = useCallback((element: HTMLElement | null) => register(key, element), [key, register])
  return (
    <div
      ref={ref}
      className={className}
      data-spaces-slot=""
      style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, ...style }}
    />
  )
}

/**
 * Props for an element that moves a floating window when dragged, such as its title bar.
 * Spread them onto the element: `<header {...useWindowDrag(windowId)} />`.
 */
export function useWindowDrag(windowId: WindowId) {
  const store = useLayoutStore()
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  return {
    style: { touchAction: 'none' } as CSSProperties,
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const win = store.getState().floating.find((w) => w.id === windowId)
      if (!win || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, left: win.rect.x, top: win.rect.y }
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = drag.current
      if (!start) return
      store.update((s) => {
        const win = s.floating.find((w) => w.id === windowId)
        if (!win) return s
        const x = Math.max(0, start.left + event.clientX - start.x)
        const y = Math.max(0, start.top + event.clientY - start.y)
        return setWindowRect(s, windowId, { ...win.rect, x, y })
      })
    },
    onPointerUp() {
      drag.current = null
    },
    onLostPointerCapture() {
      drag.current = null
    },
  }
}

