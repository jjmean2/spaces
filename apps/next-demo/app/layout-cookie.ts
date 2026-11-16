/** The cookie the workspace saves its arrangement to, so the server can render it on the next visit. */
export const LAYOUT_COOKIE = 'spaces-layout'

/** Browsers drop a cookie larger than about 4 KB. Larger arrangements are not saved. */
export const LAYOUT_COOKIE_MAX_LENGTH = 3800
