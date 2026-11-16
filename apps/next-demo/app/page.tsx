// The core entry has no React in it, so a Server Component can build and validate layouts.
import { column, createLayout, group, loadLayout, row } from '@spaces/layout/core'
import type { LayoutState } from '@spaces/layout/core'
import { cookies } from 'next/headers'
import { LAYOUT_COOKIE } from './layout-cookie'
import { Workspace } from './workspace'

function defaultLayout(): LayoutState {
  return createLayout({
    root: row(group(['editor-1', 'editor-2'], { weight: 2 }), column(group(['preview']), group(['terminal']))),
    edges: { left: { panes: ['files', 'search'], size: 220 } },
  })
}

/** The arrangement saved in the cookie, or `null` when there is none or it is no longer valid. */
function savedLayout(value: string | undefined): LayoutState | null {
  if (!value) return null
  try {
    return loadLayout(JSON.parse(value))
  } catch {
    return null
  }
}

export default async function Page() {
  const saved = savedLayout((await cookies()).get(LAYOUT_COOKIE)?.value)
  return <Workspace initial={saved ?? defaultLayout()} restored={saved !== null} />
}
