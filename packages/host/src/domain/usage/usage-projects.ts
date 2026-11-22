import { normalizePathForComparison } from "../path-comparison";

/** A registered workspace and the folders that belong to it. */
export type UsageWorkspace = {
  workspaceId: string;
  name: string;
  repoPath: string;
  /** The repository folder and the effective worktree folder. */
  roots: readonly string[];
};

/** The project of a recorded folder: its workspace, or the folder itself. */
export type UsageProjectGroup = { key: string; workspaceName: string | null; path: string | null };

const UNKNOWN_PROJECT: UsageProjectGroup = { key: "unknown", workspaceName: null, path: null };

const isInside = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);

/** The git repository of recorded folders. See `resolveUsageRepositories`. */
export type UsageRepositoryEvidence = {
  fromGit: ReadonlyMap<string, string>;
  inferred: ReadonlyMap<string, string>;
};

/**
 * Assigns recorded folders to projects, so the worktrees of one repository count as one project.
 *
 * 1. The repository that git names for the folder.
 * 2. A workspace of this host: a folder inside its repository or its worktree folder. A folder
 *    inside a separate folder, which no single workspace owns, stays its own project.
 * 3. The repository inferred for a deleted folder.
 * 4. The folder itself.
 *
 * A repository of a workspace shows as that workspace.
 */
export const createUsageProjectGrouping = (
  workspaces: readonly UsageWorkspace[],
  separateFolders: readonly string[],
  repositories: UsageRepositoryEvidence,
) => {
  const roots = [
    ...workspaces.flatMap((workspace) =>
      workspace.roots.map((root) => ({ workspace, root: normalizePathForComparison(root) })),
    ),
    ...separateFolders.map((root) => ({ workspace: null, root: normalizePathForComparison(root) })),
  ]
    // The longest root wins when roots nest, such as a worktree folder inside a repository. At
    // equal roots, the separate folder wins: a shared folder that is also a repository has no
    // single owner.
    .sort(
      (left, right) =>
        right.root.length - left.root.length ||
        Number(left.workspace !== null) - Number(right.workspace !== null),
    );
  const workspaceGroup = (workspace: UsageWorkspace): UsageProjectGroup => ({
    key: `workspace:${workspace.workspaceId}`,
    workspaceName: workspace.name,
    path: null,
  });
  const workspaceByRepository = new Map(
    workspaces.map((workspace) => [normalizePathForComparison(workspace.repoPath), workspace]),
  );
  const folderGroup = (path: string): UsageProjectGroup => {
    const comparable = normalizePathForComparison(path);
    const workspace = workspaceByRepository.get(comparable);
    if (workspace) return workspaceGroup(workspace);
    return { key: `path:${comparable}`, workspaceName: null, path: comparable };
  };
  return (path: string | null): UsageProjectGroup => {
    if (path === null) return UNKNOWN_PROJECT;
    const fromGit = repositories.fromGit.get(path);
    if (fromGit !== undefined) return folderGroup(fromGit);
    const comparable = normalizePathForComparison(path);
    const match = roots.find(({ root }) => isInside(comparable, root));
    if (match?.workspace) return workspaceGroup(match.workspace);
    if (match) return folderGroup(path);
    const inferred = repositories.inferred.get(path);
    return folderGroup(inferred ?? path);
  };
};

/** The page shows a project without a recorded folder under this label. */
export const UNKNOWN_PROJECT_LABEL = "Unknown project";

const segmentsOf = (path: string): string[] => path.split("/").filter((part) => part.length > 0);

/**
 * Labels projects without full paths. A workspace uses its name. A folder uses its last segment,
 * plus the fewest parent segments that tell same-named projects apart, but never its first
 * segment, such as a drive or the top folder. Labels that are still equal get ` (2)`, ` (3)`, and
 * so on, in the order of their keys.
 */
export const usageProjectLabels = (
  groups: readonly UsageProjectGroup[],
): Map<string, string | null> => {
  const labels = new Map<string, string | null>();
  const folders: { key: string; segments: string[] }[] = [];
  for (const group of groups) {
    if (group.workspaceName !== null) labels.set(group.key, group.workspaceName);
    else if (group.path === null) labels.set(group.key, null);
    else folders.push({ key: group.key, segments: segmentsOf(group.path) });
  }
  const workspaceNames = new Set(
    groups.flatMap((group) => (group.workspaceName === null ? [] : [group.workspaceName])),
  );
  const labelOf = (segments: string[], depth: number): string =>
    segments.slice(-depth).join("/") || "/";
  for (const folder of folders) {
    const maxDepth = Math.max(1, folder.segments.length - 1);
    let depth = 1;
    const clashes = (candidate: string) =>
      workspaceNames.has(candidate) ||
      folders.some((other) => other !== folder && labelOf(other.segments, depth) === candidate);
    while (depth < maxDepth && clashes(labelOf(folder.segments, depth))) depth++;
    labels.set(folder.key, labelOf(folder.segments, depth));
  }

  // A number never repeats a label that another project already has.
  const taken = new Set<string>([UNKNOWN_PROJECT_LABEL]);
  for (const label of labels.values()) if (label !== null) taken.add(label);
  const kept = new Set<string>();
  for (const key of [...labels.keys()].sort()) {
    const label = labels.get(key);
    if (label === null || label === undefined) continue;
    if (!kept.has(label) && label !== UNKNOWN_PROJECT_LABEL) {
      kept.add(label);
      continue;
    }
    let number = 2;
    while (taken.has(`${label} (${number})`)) number++;
    const numbered = `${label} (${number})`;
    taken.add(numbered);
    labels.set(key, numbered);
  }
  return labels;
};

/** A stable ID of a text that does not show the text: two 32-bit FNV-1a hashes. */
export const usageStableId = (text: string): string => {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x811c9dc5);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
};
