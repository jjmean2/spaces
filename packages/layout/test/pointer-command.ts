import type { BrowserCommand } from 'vitest/node'

/**
 * One step of real input. Coordinates are in the test page's own viewport, as
 * `getBoundingClientRect` reports them.
 */
export type PointerStep =
  | ['move', number, number]
  | ['down']
  | ['up']
  | ['keydown', string]
  | ['keyup', string]
  | ['press', string]

/**
 * Drive the real mouse and keyboard through Playwright. Events dispatched from
 * inside the page are not trusted input: they do not exercise pointer capture,
 * the click that follows a release, or what an iframe does to pointer events.
 */
export const pointer: BrowserCommand<[PointerStep[]]> = async (ctx, steps) => {
  const frame = await ctx.frame()
  const box = await (await frame.frameElement()).boundingBox()
  if (!box) throw new Error('The test frame is not visible')
  const scale = box.width / (await frame.evaluate(() => window.innerWidth))
  for (const step of steps) {
    switch (step[0]) {
      case 'move':
        await ctx.page.mouse.move(box.x + step[1] * scale, box.y + step[2] * scale, { steps: 4 })
        break
      case 'down':
        await ctx.page.mouse.down()
        break
      case 'up':
        await ctx.page.mouse.up()
        break
      case 'keydown':
        await ctx.page.keyboard.down(step[1])
        break
      case 'keyup':
        await ctx.page.keyboard.up(step[1])
        break
      case 'press':
        await ctx.page.keyboard.press(step[1])
        break
    }
  }
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    pointer(steps: PointerStep[]): Promise<void>
  }
}
