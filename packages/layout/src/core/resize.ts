/**
 * New weights for two neighbouring nodes after the divider between them is
 * dragged by `delta` pixels. Their combined weight stays the same, so no other
 * sibling moves. Each side keeps at least `min` pixels; when both cannot, the
 * weights are returned unchanged.
 */
export function resizePair(input: {
  weights: readonly [number, number]
  sizes: readonly [number, number]
  delta: number
  min?: number | readonly [number, number]
}): [number, number] {
  const { weights, sizes, delta } = input
  const [minA, minB] = typeof input.min === 'number' ? [input.min, input.min] : (input.min ?? [0, 0])
  const total = sizes[0] + sizes[1]
  if (!(total > 0) || minA + minB > total) return [weights[0], weights[1]]
  const a = Math.min(Math.max(sizes[0] + delta, minA), total - minB)
  const weight = weights[0] + weights[1]
  const floor = weight * 1e-6
  const first = Math.min(Math.max((a / total) * weight, floor), weight - floor)
  return [first, weight - first]
}
