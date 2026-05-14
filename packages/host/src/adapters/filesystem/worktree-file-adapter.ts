import { cp, lstat, mkdir, readdir, readlink, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";

const metadataDirectoryName = ".git";

const normalizeMissingPath = (inputPath: string): string => path.resolve(inputPath);

const normalizeForComparison = async (inputPath: string): Promise<string> => {
  try {
    return await realpath(inputPath);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return normalizeMissingPath(inputPath);
    }

    throw new Error(`Failed resolving path ${inputPath}: ${String(error)}`, { cause: error });
  }
};

const ensureRelativeCopyPath = (relativePath: string): string => {
  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new Error("Configured worktree copy path cannot be empty");
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error(`Configured worktree copy path must be relative: ${relativePath}`);
  }

  const normalized = path.normalize(trimmed);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(
      `Configured worktree copy path cannot traverse outside the repository: ${relativePath}`,
    );
  }

  const components = normalized.split(path.sep);
  if (components.includes(metadataDirectoryName)) {
    throw new Error(
      `Configured worktree copy path cannot include the repository metadata directory: ${relativePath}`,
    );
  }

  return normalized;
};

const ensurePathWithinRoot = async (
  rootPath: string,
  candidatePath: string,
  original: string,
  role: string,
): Promise<void> => {
  const root = await normalizeForComparison(rootPath);
  const candidate = await normalizeForComparison(candidatePath);
  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
    return;
  }

  throw new Error(`Configured worktree copy ${role} escapes its root: ${original}`);
};

const ensureNoSymlinkedDestinationComponents = async (
  worktreePath: string,
  relativePath: string,
  original: string,
): Promise<void> => {
  const components = relativePath.split(path.sep);
  let current = worktreePath;
  for (const component of components.slice(0, -1)) {
    current = path.join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Configured worktree copy destination cannot use symlinked path components: ${original}`,
        );
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }
};

const validateSourceTree = async (
  repoPath: string,
  sourcePath: string,
  original: string,
): Promise<void> => {
  const stats = await lstat(sourcePath).catch((error: unknown) => {
    throw new Error(`Configured worktree copy source is unavailable: ${sourcePath}`, {
      cause: error,
    });
  });

  if (stats.isSymbolicLink()) {
    const target = await readlink(sourcePath);
    if (path.isAbsolute(target)) {
      throw new Error(
        `Configured worktree copy source cannot include absolute symlink: ${original}`,
      );
    }
    await ensurePathWithinRoot(
      repoPath,
      path.resolve(path.dirname(sourcePath), target),
      original,
      "source",
    );
    return;
  }

  if (stats.isDirectory()) {
    const entries = await readdir(sourcePath);
    for (const entry of entries) {
      await validateSourceTree(repoPath, path.join(sourcePath, entry), `${original}/${entry}`);
    }
    return;
  }

  await ensurePathWithinRoot(repoPath, sourcePath, original, "source");
};

const copyPath = async (
  repoPath: string,
  worktreePath: string,
  relativePath: string,
): Promise<void> => {
  const sourcePath = path.join(repoPath, relativePath);
  const destinationPath = path.join(worktreePath, relativePath);
  const stats = await lstat(sourcePath).catch((error: unknown) => {
    throw new Error(`Configured worktree copy source is unavailable: ${sourcePath}`, {
      cause: error,
    });
  });

  await validateSourceTree(repoPath, sourcePath, relativePath);
  await ensureNoSymlinkedDestinationComponents(worktreePath, relativePath, relativePath);
  await ensurePathWithinRoot(
    worktreePath,
    path.dirname(destinationPath),
    relativePath,
    "destination",
  );

  if (stats.isDirectory()) {
    await cp(sourcePath, destinationPath, {
      dereference: false,
      errorOnExist: false,
      force: true,
      preserveTimestamps: true,
      recursive: true,
    });
    return;
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  if (stats.isSymbolicLink()) {
    await rm(destinationPath, { force: true, recursive: true });
    await symlink(await readlink(sourcePath), destinationPath);
    return;
  }

  if (!stats.isFile()) {
    throw new Error(`Configured worktree copy source is not a file or directory: ${sourcePath}`);
  }

  await cp(sourcePath, destinationPath, {
    dereference: false,
    errorOnExist: false,
    force: true,
    preserveTimestamps: true,
  });
};

export const createWorktreeFileAdapter = (): WorktreeFilePort => ({
  ensureDirectory(inputPath) {
    return mkdir(inputPath, { recursive: true }).then(() => undefined);
  },
  async copyConfiguredPaths(repoPath, worktreePath, relativePaths) {
    const worktreeRoot = await realpath(worktreePath).catch((error: unknown) => {
      throw new Error(
        `Failed resolving worktree path before copying configured paths: ${worktreePath}`,
        {
          cause: error,
        },
      );
    });
    const repoRoot = await realpath(repoPath).catch((error: unknown) => {
      throw new Error(
        `Failed resolving repository path before copying configured paths: ${repoPath}`,
        {
          cause: error,
        },
      );
    });

    for (const relativePath of relativePaths) {
      await copyPath(repoRoot, worktreeRoot, ensureRelativeCopyPath(relativePath));
    }
  },
  removePathIfPresent(inputPath) {
    return rm(inputPath, { force: true, recursive: true });
  },
  resolveWorktreePath(repoPath, worktreePath) {
    return path.isAbsolute(worktreePath) ? worktreePath : path.join(repoPath, worktreePath);
  },
  async pathIsWithinRoot(root, candidate) {
    const normalizedRoot = await normalizeForComparison(root);
    const normalizedCandidate = await normalizeForComparison(candidate);
    return (
      normalizedCandidate === normalizedRoot ||
      normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
    );
  },
});
