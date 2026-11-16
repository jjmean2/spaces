/**
 * Structural sharing: returns `next`, but with every subtree that is deeply
 * equal to the same subtree of `prev` replaced by the `prev` object. Lets
 * actions rebuild state freely while unchanged nodes keep their identity.
 */
export function share<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) {
    return next
  }
  if (Array.isArray(prev) !== Array.isArray(next)) return next

  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length
    const out = next.map((item, i) => {
      const shared = share(prev[i], item)
      if (shared !== prev[i]) same = false
      return shared
    })
    return (same ? prev : out) as T
  }

  const p = prev as Record<string, unknown>
  const n = next as Record<string, unknown>
  const keys = Object.keys(n)
  let same = keys.length === Object.keys(p).length
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    out[key] = share(p[key], n[key])
    if (!(key in p) || out[key] !== p[key]) same = false
  }
  return (same ? prev : out) as T
}
