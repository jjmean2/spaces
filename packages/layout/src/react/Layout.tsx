import {
  Fragment,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import {
  EDGES,
  clampWindowRect,
  findNode,
  focusPane,
  focusedPane,
  groups,
  isNodeVacant,
  isPaneVisible,
  nodeLimits,
  paneContainerRef,
  presentPanes,
  raiseWindow,
  resizePair,
  resizeWindowRect,
  resolveDrop,
  setWeights,
  setWindowRect,
  updateEdge,
} from '../core/index.ts'
import type {
  ContainerRef,
  DropResolver,
  Edge,
  LayoutNode,
  LayoutState,
  Limits,
  PaneId,
  Rect,
  WindowId,
} from '../core/index.ts'
import {
  ContainerContext,
  LayoutContext,
  PaneContext,
  containerKey,
  useInternals,
  useSlotRegistration,
} from './context.ts'
import type { LayoutInternals } from './context.ts'
import { createDragController } from './drag.ts'
import type { DragController, DragState } from './drag.ts'
import { Sash } from './Sash.tsx'
import { useLayoutState } from './store.ts'
import { WindowResize } from './WindowResize.tsx'
import type { LayoutStore } from './store.ts'

export interface ContainerRenderProps {
  /** The group, edge dock or floating window being drawn. */
  container: ContainerRef
  /** The panes shown in it, in tab order. */
  panes: PaneId[]
  active: PaneId | null
  /** Whether the pane that last had the user's attention is the one shown here. */
  focused: boolean
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
  /** Smallest size in pixels a divider can shrink a region to. A group's own `size` limits come on top. */
  minSize?: number
  /** Thickness of the dividers in pixels. */
  sashSize?: number
  /** Smallest size a floating window can be resized to. */
  minWindowSize?: { width: number; height: number }
  /**
   * Decides where a dragged tab would land for a pointer position. Defaults to
   * `resolveDrop`; wrap it to change the zones or to forbid some drops.
   */
  resolveDrop?: DropResolver
  /** Distance in pixels the pointer must travel before a press on a tab becomes a drag. */
  dragThreshold?: number
  className?: string
  style?: CSSProperties
}

const DEFAULT_MIN_WINDOW_SIZE = { width: 160, height: 100 }

const FILL: CSSProperties = { display: 'flex', minWidth: 0, minHeight: 0 }

/** Stacking order inside the layout root. Chrome and pane content interleave, so both are set here. */
const Z = {
  tiledPane: 1,
  overlayChrome: 2,
  overlayPane: 3,
  windowChrome: (index: number) => 10 + index * 3,
  windowPane: (index: number) => 11 + index * 3,
  windowResize: (index: number) => 12 + index * 3,
  dropIndicator: 1_000_000,
}

export function Layout({
  store,
  renderPane,
  renderContainer,
  minSize = 48,
  sashSize = 4,
  minWindowSize = DEFAULT_MIN_WINDOW_SIZE,
  resolveDrop: resolveDropProp = resolveDrop,
  dragThreshold = 5,
  className,
  style,
}: LayoutProps) {
  const state = useLayoutState(store)
  const rootRef = useRef<HTMLDivElement>(null)
  const slots = useRef(new Map<string, HTMLElement>())
  const hosts = useRef(new Map<PaneId, HTMLElement>())
  const observer = useRef<ResizeObserver | null>(null)
  const tiledRef = useRef<HTMLDivElement>(null)
  const containers = useRef(new Map<string, HTMLElement>())
  const containerOf = useRef(new Map<HTMLElement, ContainerRef>())
  // The size of the layout, for keeping floating windows within reach when it shrinks.
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null)
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const drawnRect = (rect: Rect) => (bounds ? clampWindowRect(rect, bounds) : rect)
  const containerRefs = useRef(new Map<string, (element: HTMLElement | null) => void>())

  /** A stable ref callback per container, recording its element for drop hit-testing. */
  const containerRef = (ref: ContainerRef) => {
    const key = containerKey(ref)
    let callback = containerRefs.current.get(key)
    if (!callback) {
      callback = (element) => {
        const previous = containers.current.get(key)
        if (previous) containerOf.current.delete(previous)
        if (element) {
          containers.current.set(key, element)
          containerOf.current.set(element, ref)
        } else {
          containers.current.delete(key)
        }
      }
      containerRefs.current.set(key, callback)
    }
    return callback
  }

  const dragOptions = useRef({ resolve: resolveDropProp, threshold: dragThreshold })
  dragOptions.current = { resolve: resolveDropProp, threshold: dragThreshold }

  const drag = useMemo(
    () =>
      createDragController({
        store,
        root: () => rootRef.current,
        tiled: () => tiledRef.current,
        resolve: () => dragOptions.current.resolve,
        threshold: () => dragOptions.current.threshold,
        containers() {
          const current = store.getState()
          const refs: { container: ContainerRef; raised: boolean }[] = [
            // Front to back: the last floating window is on top.
            ...current.floating
              .toReversed()
              .map((win) => ({ container: { type: 'floating', id: win.id } as ContainerRef, raised: true })),
            ...EDGES.map((edge) => ({
              container: { type: 'edge', edge } as ContainerRef,
              raised: current.edges[edge].mode === 'overlay',
            })).sort((a, b) => Number(b.raised) - Number(a.raised)),
            ...[...groups(current.root)].map((g) => ({
              container: { type: 'group', id: g.id } as ContainerRef,
              raised: false,
            })),
          ]
          return refs.flatMap(({ container, raised }) => {
            const element = containers.current.get(containerKey(container))
            return element ? [{ container, element, raised }] : []
          })
        },
      }),
    [store],
  )

  // Place every pane's host element over the slot of the container that shows it.
  // Hosts are never re-parented or reordered, so nothing inside them is reset by a move.
  const sync = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const current = store.getState()
    const origin = root.getBoundingClientRect()
    const originX = origin.left + root.clientLeft
    const originY = origin.top + root.clientTop
    const focused = focusedPane(current)

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
      host.dataset.spacesFocused = String(paneId === focused)
    }
  }, [store])

  const measureBounds = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const { clientWidth: width, clientHeight: height } = root
    setBounds((previous) => (previous?.width === width && previous.height === height ? previous : { width, height }))
  }, [])

  const getObserver = useCallback(() => {
    if (!observer.current && typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(() => {
        measureBounds()
        sync()
      })
    }
    return observer.current
  }, [sync, measureBounds])

  const internals = useMemo<LayoutInternals>(
    () => ({
      store,
      drag,
      windowRect(windowId) {
        const win = store.getState().floating.find((w) => w.id === windowId)
        if (!win) return undefined
        return boundsRef.current ? clampWindowRect(win.rect, boundsRef.current) : win.rect
      },
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
    [store, drag, getObserver],
  )

  useLayoutEffect(() => {
    const root = rootRef.current
    if (root) getObserver()?.observe(root)
    measureBounds()
    // Slots register through refs, which are not attached again when this effect is re-run.
    for (const slot of slots.current.values()) getObserver()?.observe(slot)
    return () => {
      observer.current?.disconnect()
      observer.current = null
    }
  }, [getObserver, measureBounds])

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

  const focused = focusedPane(state)

  const activeOf = (current: LayoutState, ref: ContainerRef): PaneId | null =>
    (ref.type === 'edge'
      ? current.edges[ref.edge]
      : ref.type === 'floating'
        ? current.floating.find((w) => w.id === ref.id)
        : (findNode(current.root, ref.id) as { active: PaneId | null } | undefined)
    )?.active ?? null

  const renderChrome = (ref: ContainerRef) => {
    const active = activeOf(state, ref)
    return (
      <ContainerContext.Provider value={ref}>
        {renderContainer({
          container: ref,
          panes: presentPanes(state, ref),
          active,
          focused: active !== null && active === focused,
        })}
      </ContainerContext.Provider>
    )
  }

  /** Record which pane a press or a focus change landed in: its content, or the chrome around it. */
  const noteFocus = (target: EventTarget) => {
    const root = rootRef.current
    if (!root || !(target instanceof Element)) return
    for (let element: Element | null = target; element && element !== root; element = element.parentElement) {
      const current = store.getState()
      // A host is a direct child of the root. One further down belongs to a nested layout.
      const paneId = element.parentElement === root ? (element as HTMLElement).dataset.spacesPane : undefined
      const ref = containerOf.current.get(element as HTMLElement)
      const id = paneId ?? (ref && activeOf(current, ref))
      if (id && current.panes[id]) {
        store.update((s) => focusPane(s, id))
        return
      }
    }
  }

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
        size={sashSize}
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
        <div ref={containerRef({ type: 'edge', edge })} style={{ ...FILL, flex: '1 1 0' }}>
          {renderChrome({ type: 'edge', edge })}
        </div>
        {leading && sash}
      </div>
    )
  }

  const pinned = (edge: Edge) => (state.edges[edge].mode === 'pinned' ? renderEdge(edge) : null)
  const overlaid = (edge: Edge) => (state.edges[edge].mode === 'overlay' ? renderEdge(edge) : null)

  const limitStyle = (limits: Limits): CSSProperties => ({
    minWidth: limits.minWidth,
    minHeight: limits.minHeight,
    ...(Number.isFinite(limits.maxWidth) ? { maxWidth: limits.maxWidth } : {}),
    ...(Number.isFinite(limits.maxHeight) ? { maxHeight: limits.maxHeight } : {}),
  })

  const renderNode = (node: LayoutNode, grow: number): ReactNode => {
    const flex = `${grow} 1 0px`
    const limits = limitStyle(nodeLimits(state, node, sashSize))
    if (node.type === 'group') {
      return (
        <div
          key={node.id}
          ref={containerRef({ type: 'group', id: node.id })}
          data-spaces-group={node.id}
          style={{ ...FILL, flex, ...limits }}
        >
          {renderChrome({ type: 'group', id: node.id })}
        </div>
      )
    }
    const shown = node.children.filter((child) => !isNodeVacant(state, child))
    const total = shown.reduce((sum, child) => sum + child.weight, 0)
    const axis = node.orientation === 'row' ? 'x' : 'y'
    // Each shown child's limits along the split, in pixels.
    const range = shown.map((child) => {
      const l = nodeLimits(state, child, sashSize)
      return axis === 'x' ? { min: l.minWidth, max: l.maxWidth } : { min: l.minHeight, max: l.maxHeight }
    })
    const fixed = (index: number) => range[index]!.min === range[index]!.max
    return (
      <div
        key={node.id}
        data-spaces-split={node.id}
        data-orientation={node.orientation}
        style={{ ...FILL, flex, ...limits, flexDirection: node.orientation }}
      >
        {shown.map((child, index) => {
          const next = shown[index + 1]
          return (
            <Fragment key={child.id}>
              {/* Grow factors are scaled to add up to 100: a total below 1 would not fill the split. */}
              {renderNode(child, (child.weight / total) * 100)}
              {/* A region of fixed size has nothing to drag. */}
              {next && !fixed(index) && !fixed(index + 1) && (
                <Sash
                  kind="split"
                  size={sashSize}
                  axis={axis}
                  value={(child.weight / (child.weight + next.weight)) * 100}
                  begin={(element) => {
                    const regions = [...(element.parentElement?.children ?? [])].filter(
                      (sibling) => !sibling.hasAttribute('data-spaces-sash'),
                    )
                    if (regions.length !== shown.length) return null
                    const sizes = regions.map((region) => {
                      const rect = region.getBoundingClientRect()
                      return axis === 'x' ? rect.width : rect.height
                    })
                    const measured = sizes.reduce((sum, size) => sum + size, 0)
                    if (!(measured > 0)) return null
                    // A sibling held at a limit is not the size its weight asks for. Restate every
                    // weight from what is on screen, so the divider follows the pointer. The total
                    // is kept, so a sibling that is away keeps its share.
                    const weights = sizes.map((size) => (size / measured) * total)
                    const bound = (i: number) => ({
                      min: Math.min(Math.max(range[i]!.min, minSize), range[i]!.max),
                      max: range[i]!.max,
                    })
                    const [a, b] = [bound(index), bound(index + 1)]
                    return {
                      ids: shown.map((sibling) => sibling.id),
                      weights,
                      pair: {
                        weights: [weights[index]!, weights[index + 1]!] as const,
                        sizes: [sizes[index]!, sizes[index + 1]!] as const,
                        min: [a.min, b.min] as const,
                        max: [a.max, b.max] as const,
                      },
                    }
                  }}
                  apply={(start, delta) => {
                    const [a, b] = resizePair({ ...start.pair, delta })
                    const weights = Object.fromEntries(start.ids.map((id, i) => [id, start.weights[i]!]))
                    weights[start.ids[index]!] = a
                    weights[start.ids[index + 1]!] = b
                    store.update((s) => setWeights(s, weights))
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
        onPointerDownCapture={(event) => noteFocus(event.target)}
        onFocusCapture={(event) => noteFocus(event.target)}
      >
        {pinned('left')}
        <div style={{ ...FILL, flex: '1 1 0', flexDirection: 'column', position: 'relative' }}>
          {pinned('top')}
          <div ref={tiledRef} data-spaces-center="" style={{ ...FILL, flex: '1 1 0' }}>
            {rootNode && renderNode(rootNode, 1)}
          </div>
          {pinned('bottom')}
          {overlaid('top')}
          {overlaid('bottom')}
        </div>
        {pinned('right')}
        {overlaid('left')}
        {overlaid('right')}

        {windows.map(({ win, index }) => {
          const rect = drawnRect(win.rect)
          return (
            <Fragment key={win.id}>
              <div
                ref={containerRef({ type: 'floating', id: win.id })}
                data-spaces-window={win.id}
                style={{
                  ...FILL,
                  position: 'absolute',
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  zIndex: Z.windowChrome(index),
                }}
                onPointerDownCapture={() => store.update((s) => raiseWindow(s, win.id))}
              >
                {renderChrome({ type: 'floating', id: win.id })}
              </div>
              <WindowResize
                rect={rect}
                zIndex={Z.windowResize(index)}
                onResize={(start, edges, dx, dy) =>
                  store.update((s) =>
                    s.floating.some((w) => w.id === win.id)
                      ? setWindowRect(s, win.id, resizeWindowRect(start, edges, dx, dy, minWindowSize))
                      : s,
                  )
                }
              />
            </Fragment>
          )
        })}

        {order.current.map((paneId) => (
          <PaneHost key={paneId} paneId={paneId} store={store} register={registerHost} render={renderPane} />
        ))}

        <DropIndicator drag={drag} />
      </div>
    </LayoutContext.Provider>
  )
}

/**
 * The one element that shows where a dragged tab would land. It has no look of
 * its own: style `[data-spaces-drop-indicator]`, and use `data-zone` to tell a
 * tab position (`tab`) from an area.
 */
function DropIndicator({ drag }: { drag: DragController }) {
  const state = useSyncExternalStore(drag.subscribe, drag.getState, () => null)
  if (!state?.drop) return null
  const { indicator, zone } = state.drop
  return (
    <div
      data-spaces-drop-indicator=""
      data-zone={zone}
      style={{
        position: 'absolute',
        left: indicator.x,
        top: indicator.y,
        width: indicator.width,
        height: indicator.height,
        zIndex: Z.dropIndicator,
        pointerEvents: 'none',
      }}
    />
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
  const { store, windowRect } = useInternals('useWindowDrag')
  const drag = useRef<{ x: number; y: number; rect: Rect } | null>(null)
  return {
    style: { touchAction: 'none' } as CSSProperties,
    onPointerDown(event: PointerEvent<HTMLElement>) {
      // Start from where the window is drawn, which is not where it is stored if the layout
      // has shrunk since. Starting from the stored place would make it jump.
      const rect = windowRect(windowId)
      if (!rect || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, rect }
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = drag.current
      if (!start) return
      store.update((s) =>
        s.floating.some((w) => w.id === windowId)
          ? setWindowRect(s, windowId, {
              ...start.rect,
              x: start.rect.x + event.clientX - start.x,
              y: Math.max(0, start.rect.y + event.clientY - start.y),
            })
          : s,
      )
    },
    onPointerUp() {
      drag.current = null
    },
    onLostPointerCapture() {
      drag.current = null
    },
  }
}

/**
 * Props that make an element a draggable tab for a pane. Spread them onto the
 * tab: `<button {...useTabDrag(paneId)} onClick={...} />`. A press that moves
 * becomes a drag; a press that does not is still a click. Hold Shift while
 * dragging to drop the pane as a floating window.
 */
export function useTabDrag(paneId: PaneId) {
  const { drag } = useInternals('useTabDrag')
  const dragging = useSyncExternalStore(
    drag.subscribe,
    () => drag.getState()?.paneId === paneId,
    () => false,
  )
  const ref = useCallback((element: HTMLElement | null) => drag.registerTab(paneId, element), [drag, paneId])
  return {
    ref,
    'data-spaces-tab': paneId,
    'data-dragging': dragging || undefined,
    style: { touchAction: 'none' } as CSSProperties,
    onPointerDown: (event: PointerEvent<HTMLElement>) => drag.begin(paneId, event),
  }
}

/** The drag under way in this layout, or `null`. For drawing a custom indicator or dimming the source. */
export function useDragState(): DragState | null {
  const { drag } = useInternals('useDragState')
  return useSyncExternalStore(drag.subscribe, drag.getState, () => null)
}
