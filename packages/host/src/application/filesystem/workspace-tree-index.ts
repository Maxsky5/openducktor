/** Child links let updates walk a changed subtree without scanning its siblings. */
export class WorkspaceTreeIndex<A extends { path: string }> {
  readonly entries = new Map<string, A>();
  readonly children = new Map<string, Set<string>>();

  set(entry: A): void {
    this.entries.set(entry.path, entry);
    let path = entry.path;
    while (path) {
      const parent = parentPath(path);
      let children = this.children.get(parent);
      if (!children) this.children.set(parent, (children = new Set()));
      const existed = children.has(path);
      children.add(path);
      if (existed) break;
      path = parent;
    }
  }

  delete(path: string): void {
    this.entries.delete(path);
    while (path && !this.entries.has(path) && !this.children.get(path)?.size) {
      const parent = parentPath(path);
      this.children.get(parent)?.delete(path);
      this.children.delete(path);
      path = parent;
    }
  }

  subtree(path: string): A[] {
    const entries: A[] = [];
    const visit = (current: string) => {
      const entry = this.entries.get(current);
      if (entry) entries.push(entry);
      for (const child of this.children.get(current) ?? []) visit(child);
    };
    visit(path);
    return entries;
  }
}
export const parentPath = (path: string): string =>
  path.slice(0, Math.max(0, path.lastIndexOf("/")));
export const inRegion = (path: string, region: string): boolean =>
  path === region || path.startsWith(`${region}/`);
/** Keep only top paths: reading a parent also reads its children. */
export const topPaths = (paths: Set<string>): string[] => {
  const result: string[] = [];
  for (const path of paths) {
    let parent = parentPath(path);
    let covered = false;
    while (parent) {
      if (paths.has(parent)) {
        covered = true;
        break;
      }
      parent = parentPath(parent);
    }
    if (!covered) result.push(path);
  }
  return result;
};
