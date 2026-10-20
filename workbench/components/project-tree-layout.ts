import { projectTreeRows, type ProjectFolder, type ProjectTreeRow, type ProjectTreeState } from './project-tree';

export type ProjectTreeLayoutNode = {
  path: string; row?: ProjectTreeRow; top: number; bottom: number; position: number; size: number;
  children: ProjectTreeLayoutNode[]; statusTop: number; statusHeight: number;
};
export type ProjectTreeLayout = { root: ProjectTreeLayoutNode; nodes: ReadonlyMap<string, ProjectTreeLayoutNode>; rows: ProjectTreeRow[] };
export type ProjectTreeSegment = { kind: 'node'; node: ProjectTreeLayoutNode } | { kind: 'space'; top: number; height: number };

function estimatedStatusHeight(folder: ProjectFolder | undefined): number {
  if (!folder) return 0;
  return (folder.loading ? 28 : 0) + (folder.error ? 96 : 0)
    + (folder.page?.entries.length === 0 && !folder.loading && !folder.error ? 28 : 0)
    + (folder.page && folder.page.nextOffset !== null ? 32 : 0);
}

export function projectTreeLayout(state: ProjectTreeState, heights: ReadonlyMap<string, number>): ProjectTreeLayout {
  const rows = projectTreeRows(state), nodes = new Map<string, ProjectTreeLayoutNode>();
  const root: ProjectTreeLayoutNode = { path: '', top: 0, bottom: 0, position: 0, size: 0, children: [], statusTop: 0, statusHeight: 0 };
  const stack = [root]; let offset = 0;
  const close = () => {
    const node = stack.pop()!, estimate = estimatedStatusHeight(state.folders.get(node.path)), measured = heights.get(node.path);
    node.statusTop = offset;
    node.statusHeight = estimate ? measured !== undefined && Number.isFinite(measured) && measured > 0 ? measured : estimate : 0;
    offset += node.statusHeight; node.bottom = offset;
  };
  for (const row of rows) {
    while (stack.length > row.level) close();
    const parent = stack.at(-1)!, folder = state.folders.get(parent.path);
    const node: ProjectTreeLayoutNode = { path: row.entry.relativePath, row, top: offset, bottom: offset + 28, position: parent.children.length + 1, size: folder?.page?.total ?? 0, children: [], statusTop: offset + 28, statusHeight: 0 };
    parent.children.push(node); nodes.set(node.path, node); offset += 28;
    if (row.entry.directory && state.expanded.has(node.path)) stack.push(node);
  }
  while (stack.length) close();
  return { root, nodes, rows };
}

export function projectTreeSegments(children: readonly ProjectTreeLayoutNode[], top: number, height: number, pinned: string): ProjectTreeSegment[] {
  const start = Math.max(0, top - 280), end = Math.max(0, top) + Math.max(0, height) + 280;
  const segments: ProjectTreeSegment[] = [];
  for (const node of children) {
    if (node.bottom > start && node.top < end || pinned === node.path || pinned.startsWith(`${node.path}/`)) segments.push({ kind: 'node', node });
    else {
      const previous = segments.at(-1);
      if (previous?.kind === 'space') previous.height += node.bottom - node.top;
      else segments.push({ kind: 'space', top: node.top, height: node.bottom - node.top });
    }
  }
  return segments;
}
