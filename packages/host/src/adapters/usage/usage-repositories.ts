import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isPathNotFoundError } from "../../effect/host-errors";

/** The repository of a recorded folder, and how sure the rule is. */
export type UsageRepositories = {
  /** Read from git: the folder, or the folder around a deleted one, is in the repository. */
  fromGit: ReadonlyMap<string, string>;
  /** Inferred for a deleted folder from the folder that held it, or from its name. */
  inferred: ReadonlyMap<string, string>;
};

/**
 * Failures of a path that the host cannot inspect, such as a folder without access or a special
 * system entry. Such a path has no git data, so its folder stays its own project.
 */
const UNINSPECTABLE_CODES = new Set(["ENOTDIR", "EACCES", "EPERM", "EINVAL"]);

const isUninspectable = (cause: unknown): boolean =>
  isPathNotFoundError(cause) ||
  (cause instanceof Error && "code" in cause && UNINSPECTABLE_CODES.has(String(cause.code)));

/** The entry of a path, or null when it does not exist or the host cannot inspect it. */
const statOf = (file: string) => {
  try {
    return statSync(file);
  } catch (cause) {
    if (isUninspectable(cause)) return null;
    throw cause;
  }
};

const childFolders = (folder: string): Dirent[] => {
  try {
    return readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch (cause) {
    if (isUninspectable(cause)) return [];
    throw cause;
  }
};

const readTextOf = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch (cause) {
    if (isUninspectable(cause)) return null;
    throw cause;
  }
};

/**
 * The main repository of a folder with a `.git` file. A linked worktree names its admin folder
 * `<repository>/.git/worktrees/<id>`, which git can prune while the folder stays. Another `.git`
 * file, such as one of a submodule, makes the folder its own repository.
 */
const mainRepositoryOf = (folder: string, gitFile: string): string => {
  const match = /^gitdir:\s*(.+)$/m.exec(readTextOf(gitFile) ?? "");
  if (!match?.[1]) return folder;
  const gitDir = path.resolve(folder, match[1].trim());
  const commonDir = readTextOf(path.join(gitDir, "commondir"));
  const common = commonDir
    ? path.resolve(gitDir, commonDir.trim())
    : path.dirname(path.dirname(gitDir));
  if (path.basename(path.dirname(gitDir)) !== "worktrees") return folder;
  // A bare repository is its own common folder.
  return path.basename(common) === ".git" ? path.dirname(common) : common;
};

/** The repository that holds a folder that exists, or null outside git. */
const repositoryAround = (folder: string, cache: Map<string, string | null>): string | null => {
  const cached = cache.get(folder);
  if (cached !== undefined) return cached;
  const git = statOf(path.join(folder, ".git"));
  const parent = path.dirname(folder);
  const repository = git?.isDirectory()
    ? folder
    : git?.isFile()
      ? mainRepositoryOf(folder, path.join(folder, ".git"))
      : parent === folder
        ? null
        : repositoryAround(parent, cache);
  cache.set(folder, repository);
  return repository;
};

/** The nearest folder of a path that still exists. */
const nearestExisting = (folder: string): string => {
  let current = folder;
  while (!statOf(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
};

/**
 * Finds the git repository of each recorded folder. Worktrees of one repository then count as
 * one project, whichever tool made them.
 *
 * - A folder belongs to the repository that git names for it or for its nearest existing parent.
 *   A deleted worktree keeps no git data, and tools leave empty worktree folders behind, so for
 *   a folder outside git:
 * - In a folder of worktrees of one repository, it belongs to that repository.
 * - When its path carries the folder name of exactly one known repository, such as `openducktor`
 *   or `openducktor.feat-x`, it belongs to that repository.
 *
 * Other folders stay their own projects.
 */
/**
 * Resolves folders to repositories. It keeps what it learned from the disk for its own life, so a
 * report of another range reads git data only for folders that it has not seen. The index worker
 * keeps one for the life of its threads.
 */
export const createUsageRepositoryResolver = () => {
  const around = new Map<string, string | null>();
  const nearest = new Map<string, string>();
  const containers = new Map<string, string | null>();
  return (folders: readonly string[], knownRepositories: readonly string[]) =>
    resolveRepositories(folders, knownRepositories, { around, nearest, containers });
};

/** Resolves folders to repositories with caches for one call. */
export const resolveUsageRepositories = (
  folders: readonly string[],
  knownRepositories: readonly string[],
): UsageRepositories => createUsageRepositoryResolver()(folders, knownRepositories);

const resolveRepositories = (
  folders: readonly string[],
  knownRepositories: readonly string[],
  caches: {
    around: Map<string, string | null>;
    nearest: Map<string, string>;
    containers: Map<string, string | null>;
  },
): UsageRepositories => {
  const { around, nearest, containers } = caches;
  const fromGit = new Map<string, string>();
  const outsideGit: { folder: string; holder: string }[] = [];
  for (const folder of folders) {
    let existing = nearest.get(folder);
    if (existing === undefined) {
      existing = nearestExisting(folder);
      nearest.set(folder, existing);
    }
    const repository = repositoryAround(existing, around);
    if (repository !== null) fromGit.set(folder, repository);
    // The worktrees beside a folder that exists are in its parent folder.
    else outsideGit.push({ folder, holder: existing === folder ? path.dirname(folder) : existing });
  }

  /** The one repository of the worktrees in a folder, or null. */
  const containerRepository = (holder: string): string | null => {
    const cached = containers.get(holder);
    if (cached !== undefined) return cached;
    // The root folder holds everything, so it is no folder of worktrees.
    if (path.dirname(holder) === holder) return null;
    const repositories = new Set<string>();
    for (const child of childFolders(holder)) {
      const childPath = path.join(holder, child.name);
      if (!statOf(path.join(childPath, ".git"))) continue;
      const repository = repositoryAround(childPath, around);
      if (repository !== null) repositories.add(repository);
    }
    const [only] = repositories;
    const result = repositories.size === 1 && only !== undefined ? only : null;
    containers.set(holder, result);
    return result;
  };

  const byName = new Map<string, Set<string>>();
  for (const repository of [...fromGit.values(), ...knownRepositories]) {
    const name = path.basename(repository);
    byName.set(name, (byName.get(name) ?? new Set()).add(repository));
  }
  /** The one known repository whose folder name the nearest segment carries. */
  const repositoryByName = (folder: string): string | null => {
    for (const segment of folder.split(/[\\/]/).toReversed()) {
      let best: string | null = null;
      for (const name of byName.keys())
        if (
          (segment === name || segment.startsWith(`${name}.`) || segment.startsWith(`${name}-`)) &&
          (best === null || name.length > best.length)
        )
          best = name;
      if (best === null) continue;
      const repositories = byName.get(best);
      const [only] = repositories ?? [];
      return repositories?.size === 1 && only !== undefined ? only : null;
    }
    return null;
  };

  const inferred = new Map<string, string>();
  for (const { folder, holder } of outsideGit) {
    const repository = containerRepository(holder) ?? repositoryByName(folder);
    if (repository !== null) inferred.set(folder, repository);
  }
  return { fromGit, inferred };
};
