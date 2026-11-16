import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

export interface SashProps<Ctx> {
  /** `x` separates left from right; `y` separates top from bottom. */
  axis: 'x' | 'y'
  /** Capture what the drag starts from. Return `null` to refuse the drag. */
  begin(element: HTMLElement): Ctx | null
  /** Apply a movement of `delta` pixels from where the drag began. */
  apply(context: Ctx, delta: number): void
  /** Position of the divider between its two sides, 0 to 100. */
  value?: number
  label?: string
  kind: 'split' | 'edge'
}

const KEY_STEP = 16

/** A divider that is dragged with the pointer or moved with the arrow keys. */
export function Sash<Ctx>({ axis, begin, apply, value, label, kind }: SashProps<Ctx>) {
  const drag = useRef<{ context: Ctx; start: number } | null>(null)
  const position = (event: PointerEvent) => (axis === 'x' ? event.clientX : event.clientY)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const context = begin(event.currentTarget)
    if (context === null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { context, start: position(event) }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) apply(drag.current.context, position(event) - drag.current.start)
  }
  const endDrag = () => {
    drag.current = null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== back && event.key !== forward) return
    const context = begin(event.currentTarget)
    if (context === null) return
    event.preventDefault()
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP
    apply(context, event.key === forward ? step : -step)
  }

  return (
    <div
      role="separator"
      // A divider between left and right is a vertical line, and the other way round.
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={value === undefined ? undefined : Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      tabIndex={0}
      data-spaces-sash={kind}
      data-axis={axis}
      style={{
        flex: '0 0 var(--spaces-sash-size, 4px)',
        cursor: axis === 'x' ? 'col-resize' : 'row-resize',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
    />
  )
}
