import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createWorktreeFileAdapter } from "./worktree-file-adapter";

const createTempRoot = (): Promise<string> => mkdtemp(path.join(tmpdir(), "odt-worktree-file-"));
describe("createWorktreeFileAdapter", () => {
  test("copies configured repository paths into a worktree", async () => {
    const root = await createTempRoot();
    const repo = path.join(root, "repo");
    const worktree = path.join(root, "worktree");
    await mkdir(path.join(repo, "config"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(repo, ".env"), "TOKEN=dev\n");
    await writeFile(path.join(repo, "config", "local.json"), "{}\n");
    const files = createWorktreeFileAdapter();
    try {
      await Effect.runPromise(
        files.copyConfiguredPaths(repo, worktree, [".env", "config/local.json"]),
      );
      await expect(readFile(path.join(worktree, ".env"), "utf8")).resolves.toBe("TOKEN=dev\n");
      await expect(readFile(path.join(worktree, "config", "local.json"), "utf8")).resolves.toBe(
        "{}\n",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
  test("rejects configured copy paths that leave the repository", async () => {
    const root = await createTempRoot();
    const repo = path.join(root, "repo");
    const worktree = path.join(root, "worktree");
    await mkdir(repo, { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(repo, "README.md"), "# repo\n");
    await writeFile(path.join(worktree, ".keep"), "");
    const files = createWorktreeFileAdapter();
    try {
      await expect(
        Effect.runPromise(files.copyConfiguredPaths(repo, worktree, ["../secret"])),
      ).rejects.toThrow("cannot traverse outside");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
  test("resolves a missing cleanup path through a symlinked managed root", async () => {
    const root = await createTempRoot();
    const configuredRoot = path.join(root, "configured-worktrees");
    const managedRoot = path.join(root, "managed-worktrees");
    const missingWorktree = path.join(managedRoot, "task-1");
    await mkdir(managedRoot, { recursive: true });
    await symlink(managedRoot, configuredRoot);
    const canonicalManagedRoot = await realpath(managedRoot);
    const files = createWorktreeFileAdapter();
    try {
      await expect(
        Effect.runPromise(files.resolvePathWithinRoot(configuredRoot, missingWorktree)),
      ).resolves.toEqual({
        canonicalPath: path.join(canonicalManagedRoot, "task-1"),
        cleanupPath: path.join(canonicalManagedRoot, "task-1"),
        isSymlink: false,
        kind: "descendant",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
  test("classifies a missing cleanup path whose symlinked parent leaves the managed root", async () => {
    const root = await createTempRoot();
    const managedRoot = path.join(root, "managed-worktrees");
    const outsideRoot = path.join(root, "outside");
    const symlinkedParent = path.join(managedRoot, "runtime-link");
    const missingWorktree = path.join(symlinkedParent, "task-1");
    await mkdir(managedRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, symlinkedParent);
    const canonicalOutsideRoot = await realpath(outsideRoot);
    const files = createWorktreeFileAdapter();
    try {
      await expect(
        Effect.runPromise(files.resolvePathWithinRoot(managedRoot, missingWorktree)),
      ).resolves.toEqual({
        canonicalPath: path.join(canonicalOutsideRoot, "task-1"),
        cleanupPath: path.join(canonicalOutsideRoot, "task-1"),
        isSymlink: false,
        kind: "outside",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
  test("classifies existing paths by their canonical containment", async () => {
    const root = await createTempRoot();
    const managedRoot = path.join(root, "managed-worktrees");
    const managedWorktree = path.join(managedRoot, "task-1");
    const outsideWorktree = path.join(root, "outside", "task-2");
    await mkdir(managedWorktree, { recursive: true });
    await mkdir(outsideWorktree, { recursive: true });
    const files = createWorktreeFileAdapter();
    try {
      await expect(
        Effect.runPromise(files.resolvePathWithinRoot(managedRoot, managedWorktree)),
      ).resolves.toMatchObject({ kind: "descendant" });
      await expect(
        Effect.runPromise(files.resolvePathWithinRoot(managedRoot, outsideWorktree)),
      ).resolves.toMatchObject({ kind: "outside" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
  test("keeps a final managed symlink as the filesystem cleanup entry", async () => {
    const root = await createTempRoot();
    const managedRoot = path.join(root, "managed-worktrees");
    const targetPath = path.join(managedRoot, "task-target");
    const symlinkPath = path.join(managedRoot, "task-link");
    await mkdir(targetPath, { recursive: true });
    await symlink(targetPath, symlinkPath);
    const canonicalTargetPath = await realpath(targetPath);
    const canonicalManagedRoot = await realpath(managedRoot);
    const files = createWorktreeFileAdapter();
    try {
      await expect(
        Effect.runPromise(files.resolvePathWithinRoot(managedRoot, symlinkPath)),
      ).resolves.toEqual({
        canonicalPath: canonicalTargetPath,
        cleanupPath: path.join(canonicalManagedRoot, "task-link"),
        isSymlink: true,
        kind: "descendant",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
  test("classifies an outside symlink entry as outside even when its target is managed", async () => {
    const root = await createTempRoot();
    const managedRoot = path.join(root, "managed-worktrees");
    const targetPath = path.join(managedRoot, "task-target");
    const outsideRoot = path.join(root, "outside");
    const symlinkPath = path.join(outsideRoot, "task-link");
    await mkdir(targetPath, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await symlink(targetPath, symlinkPath);
    const files = createWorktreeFileAdapter();
    try {
      await expect(
        Effect.runPromise(files.resolvePathWithinRoot(managedRoot, symlinkPath)),
      ).resolves.toMatchObject({ kind: "outside" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
  test("does not classify the managed root itself as a cleanup target", async () => {
    const root = await createTempRoot();
    const managedRoot = path.join(root, "managed-worktrees");
    await mkdir(managedRoot, { recursive: true });
    const canonicalManagedRoot = await realpath(managedRoot);
    const files = createWorktreeFileAdapter();
    try {
      await expect(
        Effect.runPromise(files.resolvePathWithinRoot(managedRoot, managedRoot)),
      ).resolves.toEqual({
        canonicalPath: canonicalManagedRoot,
        cleanupPath: canonicalManagedRoot,
        isSymlink: false,
        kind: "outside",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
