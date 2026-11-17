/** A string, number, boolean, null or array value at the end of a key path. */
export interface LeafNode {
  kind: 'leaf';
  value: unknown;
  line: number;
  column: number;
}

/** An object in a locale file. Children keep their file order. */
export interface ObjectNode {
  kind: 'object';
  children: Map<string, TreeNode>;
  line: number;
  column: number;
}

export type TreeNode = LeafNode | ObjectNode;

export function objectNode(line = 1, column = 1): ObjectNode {
  return { kind: 'object', children: new Map(), line, column };
}

/** A key defined more than once in the same object. */
export interface DuplicateKey {
  /** Path of the duplicated key. */
  path: string[];
  line: number;
  firstLine: number;
}

export interface ParseError {
  message: string;
  line: number;
  column: number;
}

/** What a parser returns. */
export interface ParsedTree {
  root: ObjectNode;
  duplicates: DuplicateKey[];
  errors: ParseError[];
}

/** One translatable leaf with its path. */
export interface FlatLeaf {
  path: string[];
  node: LeafNode;
}

/** Walks a tree and yields every leaf with its path, in file order. */
export function* leaves(node: ObjectNode, prefix: string[] = []): Generator<FlatLeaf> {
  for (const [key, child] of node.children) {
    const path = [...prefix, key];
    if (child.kind === 'leaf') yield { path, node: child };
    else yield* leaves(child, path);
  }
}

/** Reads the node at a path. */
export function getNode(root: ObjectNode, path: string[]): TreeNode | undefined {
  let node: TreeNode = root;
  for (const seg of path) {
    if (node.kind !== 'object') return undefined;
    const next: TreeNode | undefined = node.children.get(seg);
    if (!next) return undefined;
    node = next;
  }
  return node;
}

/**
 * Sets a leaf at a path, creating objects on the way. Returns false when a
 * leaf is in the way (for example setting `a.b` when `a` is a string).
 */
export function setLeaf(root: ObjectNode, path: string[], value: unknown): boolean {
  let node: ObjectNode = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]!;
    let next = node.children.get(seg);
    if (!next) {
      next = objectNode(0, 0);
      node.children.set(seg, next);
    }
    if (next.kind !== 'object') return false;
    node = next;
  }
  const last = path[path.length - 1]!;
  const existing = node.children.get(last);
  if (existing && existing.kind === 'object') return false;
  node.children.set(last, { kind: 'leaf', value, line: existing?.line ?? 0, column: existing?.column ?? 0 });
  return true;
}

/** Deletes a leaf and any objects left empty. Returns true when something was removed. */
export function deleteLeaf(root: ObjectNode, path: string[]): boolean {
  const parents: ObjectNode[] = [root];
  let node: ObjectNode = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = node.children.get(path[i]!);
    if (next?.kind !== 'object') return false;
    parents.push(next);
    node = next;
  }
  const removed = node.children.delete(path[path.length - 1]!);
  if (!removed) return false;
  for (let i = parents.length - 1; i > 0; i--) {
    if (parents[i]!.children.size > 0) break;
    parents[i - 1]!.children.delete(path[i - 1]!);
  }
  return true;
}

/** Sorts keys recursively by code point, so the order is the same on every machine. */
export function sortTree(node: ObjectNode): void {
  const entries = [...node.children.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  node.children = new Map(entries);
  for (const child of node.children.values()) if (child.kind === 'object') sortTree(child);
}

/** Converts a tree to plain JavaScript objects. */
export function toPlain(node: TreeNode): unknown {
  if (node.kind === 'leaf') return node.value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of node.children) out[k] = toPlain(v);
  return out;
}

/** Builds a tree from plain JavaScript data. */
export function fromPlain(data: unknown): ObjectNode {
  const root = objectNode();
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      root.children.set(
        k,
        v && typeof v === 'object' && !Array.isArray(v)
          ? fromPlain(v)
          : { kind: 'leaf', value: v, line: 0, column: 0 },
      );
    }
  }
  return root;
}
