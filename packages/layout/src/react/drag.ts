import type { PointerEvent as ReactPointerEvent } from 'react'
import { isSameArrangement, movePane, presentPanes } from '../core/index.ts'
import type { ContainerRef, Drop, DropRegion, DropResolver, PaneId, Point, Rect } from '../core/index.ts'
import type { LayoutStore } from './store.ts'

export interface DragState {
  /** The pane being dragged. */
  paneId: PaneId
  /** Where it would land if released now, or `null` when a release would change nothing. */
  drop: Drop | null
}

export interface DragEnvironment {
  store: LayoutStore
  root(): HTMLElement | null
  /** The element the tiled tree fills. */
  tiled(): HTMLElement | null
  /** The containers on screen, front to back. */
  containers(): { container: ContainerRef; element: HTMLElement; raised: boolean }[]
  resolve(): DropResolver
  threshold(): number
}

export interface DragController {
  getState(): DragState | null
  subscribe(listener: () => void): () => void
  registerTab(paneId: PaneId, element: HTMLElement | null): void
  begin(paneId: PaneId, event: ReactPointerEvent<HTMLElement>): void
}

const DEFAULT_FLOAT_SIZE = { width: 480, height: 320 }
const INTERACTIVE = 'a, button, input, select, textarea, [contenteditable], [data-spaces-no-drag]'

/** A press on a control inside the tab, such as a close button, belongs to that control. */
function onControlInside(target: EventTarget | null, tab: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  const control = target.closest(INTERACTIVE)
  return control !== null && control !== tab && tab.contains(control)
}

/**
 * Swallow the click the browser sends after a drag ends, so releasing the tab
 * does not also activate it. Removed again right after the pointer comes up,
 * or at the next press if the release was never seen, as when it lands in an
 * iframe.
 */
function suppressClickAfterDrag(pointerIsDown: boolean): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
  }
  const remove = () => {
    window.removeEventListener('click', swallow, true)
    window.removeEventListener('pointerup', afterRelease, true)
    window.removeEventListener('pointerdown', remove, true)
  }
  const afterRelease = () => setTimeout(remove, 0)
  window.addEventListener('click', swallow, true)
  window.addEventListener('pointerdown', remove, true)
  if (pointerIsDown) window.addEventListener('pointerup', afterRelease, true)
  else afterRelease()
}

/**
 * Drives dragging a tab to a new place. The layout is not changed while the
 * drag is under way: the pointer position is resolved against rectangles
 * measured when the drag starts, and the pane is moved once, on release.
 */
export function createDragController(env: DragEnvironment): DragController {
  const tabs = new Map<PaneId, HTMLElement>()
  const listeners = new Set<() => void>()
  let state: DragState | null = null
  let active = false
  /** Ends the session under way if it was started on this element. */
  let abandon: ((tab: HTMLElement) => void) | null = null

  const publish = (next: DragState | null) => {
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of [...listeners]) listener()
  }

  const measure = () => {
    const root = env.root()
    if (!root) return null
    const box = root.getBoundingClientRect()
    const origin: Point = { x: box.left + root.clientLeft, y: box.top + root.clientTop }
    const rectOf = (element: HTMLElement): Rect => {
      const r = element.getBoundingClientRect()
      return { x: r.left - origin.x, y: r.top - origin.y, width: r.width, height: r.height }
    }
    const current = env.store.getState()
    const regions: DropRegion[] = env.containers().map(({ container, element, raised }) => ({
      container,
      raised,
      rect: rectOf(element),
      tabs: presentPanes(current, container).flatMap((paneId) => {
        const tab = tabs.get(paneId)
        return tab ? [{ paneId, rect: rectOf(tab) }] : []
      }),
    }))
    const tiled = env.tiled()
    return {
      origin,
      regions,
      tiled: tiled ? rectOf(tiled) : null,
      bounds: { x: 0, y: 0, width: root.clientWidth, height: root.clientHeight },
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    registerTab(paneId, element) {
      if (element) {
        tabs.set(paneId, element)
        return
      }
      // A removed element gets no more pointer events, so a drag pressed on it would never end.
      const removed = tabs.get(paneId)
      tabs.delete(paneId)
      if (removed) abandon?.(removed)
    },

    begin(paneId, event) {
      if (active || event.button !== 0 || !event.isPrimary) return
      const tab = event.currentTarget
      if (onControlInside(event.target, tab)) return

      const pointerId = event.pointerId
      const start: Point = { x: event.clientX, y: event.clientY }
      let last = start
      let shift = event.shiftKey
      // Measured once, when the drag starts. Live rectangles would shift under the pointer
      // if the consumer makes room for the dragged tab, and the target would flicker.
      let snapshot: ReturnType<typeof measure> = null
      const restoreSelection = document.body.style.userSelect
      active = true
      tab.setPointerCapture(pointerId)

      const resolve = (): Drop | null => {
        if (!snapshot) return null
        const current = env.store.getState()
        const pane = current.panes[paneId]
        if (!pane) return null
        const size = pane.floatingRect ?? DEFAULT_FLOAT_SIZE
        const drop = env.resolve()({
          point: { x: last.x - snapshot.origin.x, y: last.y - snapshot.origin.y },
          dragged: paneId,
          regions: snapshot.regions,
          tiled: snapshot.tiled,
          float: shift ? { width: size.width, height: size.height, bounds: snapshot.bounds } : null,
        })
        if (!drop) return null
        try {
          // A drop that would leave everything where it is shows no indicator and does nothing.
          return isSameArrangement(current, movePane(current, paneId, drop.target)) ? null : drop
        } catch {
          return null
        }
      }

      const update = () => publish({ paneId, drop: resolve() })

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return
        last = { x: e.clientX, y: e.clientY }
        shift = e.shiftKey
        if (!snapshot) {
          if (Math.hypot(last.x - start.x, last.y - start.y) < env.threshold()) return
          snapshot = measure()
          if (!snapshot) return finish()
          document.body.style.userSelect = 'none'
          window.addEventListener('keydown', onKey, true)
          window.addEventListener('keyup', onKey, true)
          window.addEventListener('blur', onCancel)
          document.addEventListener('selectstart', onSelectStart)
        }
        update()
      }

      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return
        if (!snapshot) return finish()
        last = { x: e.clientX, y: e.clientY }
        const drop = resolve()
        finish()
        suppressClickAfterDrag(false)
        if (drop) env.store.update((s) => (s.panes[paneId] ? movePane(s, paneId, drop.target) : s))
      }

      const onCancel = (event?: Event) => {
        const dragging = snapshot !== null
        // After Escape the button is still down. Keep the capture, so the release comes to the tab
        // and not to whatever is under the pointer.
        finish(event?.type === 'keydown')
        if (dragging) suppressClickAfterDrag(true)
      }

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && e.type === 'keydown') {
          // Handled here first, so it does not also close a dialog the layout sits in.
          e.stopPropagation()
          e.preventDefault()
          onCancel(e)
        } else if (e.key === 'Shift') {
          shift = e.type === 'keydown'
          update()
        }
      }

      const onSelectStart = (e: Event) => e.preventDefault()

      function finish(keepCapture = false) {
        active = false
        abandon = null
        tab.removeEventListener('pointermove', onMove)
        tab.removeEventListener('pointerup', onUp)
        tab.removeEventListener('pointercancel', onCancel)
        tab.removeEventListener('lostpointercapture', onCancel)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('keyup', onKey, true)
        window.removeEventListener('blur', onCancel)
        document.removeEventListener('selectstart', onSelectStart)
        if (snapshot) document.body.style.userSelect = restoreSelection
        if (!keepCapture && tab.hasPointerCapture(pointerId)) tab.releasePointerCapture(pointerId)
        snapshot = null
        publish(null)
      }

      abandon = (element) => {
        if (element === tab) onCancel()
      }
      tab.addEventListener('pointermove', onMove)
      tab.addEventListener('pointerup', onUp)
      tab.addEventListener('pointercancel', onCancel)
      tab.addEventListener('lostpointercapture', onCancel)
    },
  }
}
