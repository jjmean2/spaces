import { useRef } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { Rect, ResizeEdges } from '../core/index.ts'

const HANDLES: { name: string; edges: ResizeEdges; cursor: string; box: CSSProperties }[] = [
  { name: 'top', edges: { top: true }, cursor: 'ns-resize', box: { top: 'calc(var(--t) / -2)', left: 'var(--t)', right: 'var(--t)', height: 'var(--t)' } },
  { name: 'bottom', edges: { bottom: true }, cursor: 'ns-resize', box: { bottom: 'calc(var(--t) / -2)', left: 'var(--t)', right: 'var(--t)', height: 'var(--t)' } },
  { name: 'left', edges: { left: true }, cursor: 'ew-resize', box: { left: 'calc(var(--t) / -2)', top: 'var(--t)', bottom: 'var(--t)', width: 'var(--t)' } },
  { name: 'right', edges: { right: true }, cursor: 'ew-resize', box: { right: 'calc(var(--t) / -2)', top: 'var(--t)', bottom: 'var(--t)', width: 'var(--t)' } },
  { name: 'top-left', edges: { top: true, left: true }, cursor: 'nwse-resize', box: { top: 'calc(var(--t) / -2)', left: 'calc(var(--t) / -2)', width: 'calc(var(--t) * 1.5)', height: 'calc(var(--t) * 1.5)' } },
  { name: 'top-right', edges: { top: true, right: true }, cursor: 'nesw-resize', box: { top: 'calc(var(--t) / -2)', right: 'calc(var(--t) / -2)', width: 'calc(var(--t) * 1.5)', height: 'calc(var(--t) * 1.5)' } },
  { name: 'bottom-left', edges: { bottom: true, left: true }, cursor: 'nesw-resize', box: { bottom: 'calc(var(--t) / -2)', left: 'calc(var(--t) / -2)', width: 'calc(var(--t) * 1.5)', height: 'calc(var(--t) * 1.5)' } },
  { name: 'bottom-right', edges: { bottom: true, right: true }, cursor: 'nwse-resize', box: { bottom: 'calc(var(--t) / -2)', right: 'calc(var(--t) / -2)', width: 'calc(var(--t) * 1.5)', height: 'calc(var(--t) * 1.5)' } },
]

export interface WindowResizeProps {
  /** The rectangle the window is drawn at. */
  rect: Rect
  zIndex: number
  /** Called while an edge or corner is dragged, with the movement since the drag began. */
  onResize(start: Rect, edges: ResizeEdges, dx: number, dy: number): void
}

/**
 * The edges and corners a floating window is resized by. They sit above the
 * window's pane content, which would otherwise cover them wherever it reaches
 * the window's edge. Their thickness is `--spaces-window-resize-size`.
 */
export function WindowResize({ rect, zIndex, onResize }: WindowResizeProps) {
  const drag = useRef<{ x: number; y: number; rect: Rect; edges: ResizeEdges } | null>(null)
  const end = () => {
    drag.current = null
  }
  return (
    <div
      style={
        {
          '--t': 'var(--spaces-window-resize-size, 8px)',
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          zIndex,
          pointerEvents: 'none',
        } as CSSProperties
      }
    >
      {HANDLES.map(({ name, edges, cursor, box }) => (
        <div
          key={name}
          data-spaces-window-resize={name}
          style={{ position: 'absolute', pointerEvents: 'auto', touchAction: 'none', cursor, ...box }}
          onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { x: event.clientX, y: event.clientY, rect, edges }
          }}
          onPointerMove={(event) => {
            const start = drag.current
            if (start) onResize(start.rect, start.edges, event.clientX - start.x, event.clientY - start.y)
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
        />
      ))}
    </div>
  )
}
