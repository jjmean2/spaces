/**
 * Keyboard order for a layout.
 *
 * A pane's content is not a DOM descendant of the container that shows it: it
 * lives in a host element at the end of the layout root, positioned over the
 * container's slot. The browser's own Tab order follows the DOM, so it would
 * visit all the chrome first and then every pane in the order it was created.
 * These functions give the order a person expects: a container's tabs, then
 * its pane, then the next container.
 */

const GUARD = 'data-spaces-focus-guard'
const HOST = 'data-spaces-pane'
const SLOT = 'data-spaces-slot'
const ROOT = 'data-spaces-layout'
/** On a slot: the id of the host element it shows. */
export const SHOWS = 'data-spaces-shows'

const isVisible = (element: HTMLElement) =>
  typeof element.checkVisibility === 'function'
    ? element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
    : element.getClientRects().length > 0

/** Whether Tab stops on the element. Positive `tabindex` values are treated as 0. */
export function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false
  if (element.matches(':disabled')) return false
  const tag = element.tagName
  if ((tag === 'A' || tag === 'AREA') && !element.hasAttribute('href') && !element.hasAttribute('tabindex')) return false
  if (tag === 'INPUT') {
    const input = element as HTMLInputElement
    if (input.type === 'hidden') return false
    // Of a group of radio buttons only the checked one is a stop, or all of them when none is.
    if (input.type === 'radio' && input.name && !input.checked) {
      const scope = input.form ?? input.getRootNode()
      const group = (scope as ParentNode).querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${CSS.escape(input.name)}"]`,
      )
      if ([...group].some((radio) => radio.checked && radio.form === input.form)) return false
    }
  }
  return isVisible(element)
}

/**
 * The elements Tab stops on inside a layout, in the order a person expects.
 * Each slot is replaced by the content of the pane it shows, and a layout
 * nested in a pane is ordered the same way. `also` is included at its place
 * even if it is not a stop, so the order can be continued from it.
 */
export function logicalOrder(root: HTMLElement, also?: Element | null): HTMLElement[] {
  const out: HTMLElement[] = []
  const walk = (node: Element, owner: HTMLElement) => {
    for (const child of node.children) {
      if (!(child instanceof HTMLElement)) continue
      if (child.hasAttribute(GUARD) || child.inert) continue
      // Hosts are entered through the slot that shows them, not where they sit in the DOM.
      if (child.parentElement === owner && child.hasAttribute(HOST)) continue
      if (child.hasAttribute(SLOT) && child.closest(`[${ROOT}]`) === owner) {
        const id = child.getAttribute(SHOWS)
        const host = id ? document.getElementById(id) : null
        if (host && host.parentElement === owner && !host.inert) {
          if (host === also) out.push(host)
          walk(host, owner)
        }
        continue
      }
      if (child === also || isTabbable(child)) out.push(child)
      // What is inside an iframe belongs to another document.
      if (child.tagName === 'IFRAME') continue
      walk(child, child.hasAttribute(ROOT) ? child : owner)
    }
  }
  walk(root, root)
  return out
}

/** Whether the layout is inside a pane of another layout, which then continues the order past its ends. */
export function isNestedLayout(root: HTMLElement): boolean {
  return root.parentElement?.closest(`[${ROOT}]`) != null
}

/** The elements Tab stops on inside `root` in the order the browser itself would take: DOM order. */
export function domOrder(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  const walk = (node: Element) => {
    for (const child of node.children) {
      if (!(child instanceof HTMLElement) || child.inert) continue
      if (isTabbable(child)) out.push(child)
      if (child.tagName !== 'IFRAME') walk(child)
    }
  }
  walk(root)
  return out
}

const SEGMENTED_INPUTS = new Set(['date', 'time', 'datetime-local', 'month', 'week'])

/**
 * Whether Tab can stop more than once inside the element without focus leaving
 * it: the fields of a date input, the buttons of media controls, whatever a
 * custom element or an embedded document holds. Only the browser knows when
 * the last of those has been passed, so it must be left to move focus itself.
 */
export function hasInnerStops(element: Element): boolean {
  switch (element.tagName) {
    case 'IFRAME':
    case 'OBJECT':
    case 'EMBED':
      return true
    case 'INPUT':
      return SEGMENTED_INPUTS.has((element as HTMLInputElement).type)
    case 'VIDEO':
    case 'AUDIO':
      return element.hasAttribute('controls')
    default:
      return element.shadowRoot !== null
  }
}
