import type { Edge, GroupNode, LayoutNode, NodeId, Orientation, PaneId, SplitNode } from './types.ts'

export function* walk(node: LayoutNode | null): Generator<LayoutNode> {
  if (!node) return
  yield node
  if (node.type === 'split') for (const child of node.children) yield* walk(child)
}

export function* groups(node: LayoutNode | null): Generator<GroupNode> {
  for (const n of walk(node)) if (n.type === 'group') yield n
}

export function findNode(root: LayoutNode | null, id: NodeId): LayoutNode | undefined {
  for (const n of walk(root)) if (n.id === id) return n
  return undefined
}

export function findGroup(root: LayoutNode | null, id: NodeId): GroupNode | undefined {
  const node = findNode(root, id)
  return node?.type === 'group' ? node : undefined
}

export function findParent(root: LayoutNode | null, id: NodeId): SplitNode | undefined {
  for (const n of walk(root)) {
    if (n.type === 'split' && n.children.some((c) => c.id === id)) return n
  }
  return undefined
}

/** The group whose pane list contains the pane, whether or not it is shown there. */
export function findHomeGroup(root: LayoutNode | null, paneId: PaneId): GroupNode | undefined {
  for (const g of groups(root)) if (g.panes.includes(paneId)) return g
  return undefined
}

export function sideOrientation(side: Edge): Orientation {
  return side === 'left' || side === 'right' ? 'row' : 'column'
}

export function sideIsBefore(side: Edge): boolean {
  return side === 'left' || side === 'top'
}

/**
 * Insert `node` beside the node with id `targetId`. Mutates the tree and
 * returns the new root.
 *
 * When the target's parent already splits along the same axis the new node
 * becomes a sibling and takes half of the target's share. Otherwise the target
 * is wrapped in a new split and the two share it equally.
 */
export function insertBeside(
  root: LayoutNode,
  targetId: NodeId,
  side: Edge,
  node: LayoutNode,
  newSplitId: () => NodeId,
): LayoutNode {
  const orientation = sideOrientation(side)
  const before = sideIsBefore(side)
  const target = findNode(root, targetId)
  if (!target) throw new Error(`Unknown node "${targetId}"`)
  const parent = findParent(root, targetId)

  if (parent && parent.orientation === orientation) {
    const index = parent.children.indexOf(target)
    target.weight /= 2
    node.weight = target.weight
    parent.children.splice(before ? index : index + 1, 0, node)
    return root
  }

  const split: SplitNode = {
    type: 'split',
    id: newSplitId(),
    weight: target.weight,
    orientation,
    children: before ? [node, target] : [target, node],
  }
  target.weight = 1
  node.weight = 1
  if (!parent) return split
  parent.children[parent.children.indexOf(target)] = split
  return root
}

/**
 * Insert `node` along one side of the whole tree. Mutates the tree and returns
 * the new root. The new node takes an equal share with the existing top-level
 * children.
 */
export function insertAtRoot(
  root: LayoutNode | null,
  side: Edge,
  node: LayoutNode,
  newSplitId: () => NodeId,
): LayoutNode {
  if (!root) {
    node.weight = 1
    return node
  }
  const orientation = sideOrientation(side)
  const before = sideIsBefore(side)
  if (root.type === 'split' && root.orientation === orientation) {
    const total = root.children.reduce((sum, c) => sum + c.weight, 0)
    node.weight = total / root.children.length
    if (before) root.children.unshift(node)
    else root.children.push(node)
    return root
  }
  root.weight = 1
  node.weight = 1
  return {
    type: 'split',
    id: newSplitId(),
    weight: 1,
    orientation,
    children: before ? [node, root] : [root, node],
  }
}

/**
 * Restore the tree invariants after a mutation:
 * - a group with no panes is removed
 * - a split with one child is replaced by that child, which inherits its share
 * - a split nested in a split of the same orientation is merged into it, with
 *   its children's shares scaled so the proportions on screen do not change
 */
export function normalizeTree(node: LayoutNode | null): LayoutNode | null {
  if (!node) return null
  if (node.type === 'group') return node.panes.length > 0 ? node : null

  const children: LayoutNode[] = []
  for (const child of node.children) {
    const normalized = normalizeTree(child)
    if (!normalized) continue
    if (normalized.type === 'split' && normalized.orientation === node.orientation) {
      const total = normalized.children.reduce((sum, c) => sum + c.weight, 0)
      for (const grandchild of normalized.children) {
        children.push({ ...grandchild, weight: (grandchild.weight / total) * normalized.weight })
      }
    } else {
      children.push(normalized)
    }
  }

  if (children.length === 0) return null
  if (children.length === 1) return { ...children[0]!, weight: node.weight }
  return { ...node, children }
}
