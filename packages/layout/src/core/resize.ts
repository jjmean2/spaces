/**
 * New weights for two neighbouring nodes after the divider between them is
 * dragged by `delta` pixels. Their combined weight stays the same, so no other
 * sibling moves. Each side stays between `min` and `max` pixels; when both
 * cannot, the weights are returned unchanged.
 */
export function resizePair(input: {
  weights: readonly [number, number]
  sizes: readonly [number, number]
  delta: number
  min?: number | readonly [number, number]
  max?: number | readonly [number, number]
}): [number, number] {
  const { weights, sizes, delta } = input
  const [minA, minB] = typeof input.min === 'number' ? [input.min, input.min] : (input.min ?? [0, 0])
  const [maxA, maxB] =
    typeof input.max === 'number' ? [input.max, input.max] : (input.max ?? [Infinity, Infinity])
  const total = sizes[0] + sizes[1]
  // The first side may not go below its minimum, nor so low that the second exceeds its maximum.
  const low = Math.max(minA, total - maxB)
  const high = Math.min(maxA, total - minB)
  if (!(total > 0) || low > high) return [weights[0], weights[1]]
  const a = Math.min(Math.max(sizes[0] + delta, low), high)
  const weight = weights[0] + weights[1]
  const floor = weight * 1e-6
  const first = Math.min(Math.max((a / total) * weight, floor), weight - floor)
  return [first, weight - first]
}
