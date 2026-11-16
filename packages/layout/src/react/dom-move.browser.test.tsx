/**
 * Browser behaviour the pane layer is designed around. `<Layout>` never moves a
 * pane's element in the DOM: it repositions it. These tests show what moving it
 * would cost, and that hiding it costs only focus.
 */
import { expect, test } from 'vitest'

async function setup() {
  const from = document.createElement('div')
  const to = document.createElement('div')
  const host = document.createElement('div')
  host.innerHTML = `
    <div data-scroll style="height:100px;overflow:auto"><div style="height:1000px;padding-top:60px"><input /></div></div>
    <iframe srcdoc="<p>frame</p>"></iframe>`
  from.append(host)
  document.body.append(from, to)

  const iframe = host.querySelector('iframe')!
  await expect.poll(() => iframe.contentDocument?.body?.textContent).toBe('frame')
  ;(iframe.contentWindow as unknown as { marker: string }).marker = 'alive'
  const input = host.querySelector('input')!
  // The input stays in view at the scroll offset below. A focused element that is scrolled out of
  // view makes moveBefore scroll back to it, which would hide what this file measures.
  input.focus({ preventScroll: true })
  const scroller = host.querySelector<HTMLElement>('[data-scroll]')!
  scroller.scrollTop = 40

  const read = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return {
      scroll: scroller.scrollTop,
      iframe: (iframe.contentWindow as unknown as { marker?: string } | null)?.marker ?? 'reloaded',
      focused: document.activeElement === input,
    }
  }
  return { to, host, read, cleanup: () => (from.remove(), to.remove()) }
}

test('re-parenting an element resets its scroll, reloads its iframe and drops focus', async () => {
  const { to, host, read, cleanup } = await setup()
  to.appendChild(host)
  expect(await read()).toEqual({ scroll: 0, iframe: 'reloaded', focused: false })
  cleanup()
})

test.runIf('moveBefore' in Element.prototype)('moveBefore keeps all three, where it exists', async () => {
  const { to, host, read, cleanup } = await setup()
  to.moveBefore(host, null)
  expect(await read()).toEqual({ scroll: 40, iframe: 'alive', focused: true })
  cleanup()
})

test('hiding an element in place keeps scroll and iframe, and drops only focus', async () => {
  const { host, read, cleanup } = await setup()
  host.style.visibility = 'hidden'
  await new Promise((resolve) => setTimeout(resolve, 50))
  host.style.visibility = ''
  expect(await read()).toEqual({ scroll: 40, iframe: 'alive', focused: false })
  cleanup()
})
