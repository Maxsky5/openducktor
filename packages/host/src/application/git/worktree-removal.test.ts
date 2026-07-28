import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ResolvedPathWithinRoot, WorktreeFilePort } from "../../ports/worktree-file-port";
import { removeWorktreeAndFilesystemPath } from "./worktree-removal";

type CleanupResolution = ResolvedPathWithinRoot & { cleanupPath: string };
const cleanupResolution = (
  canonicalPath: string,
  kind: CleanupResolution["kind"],
  cleanupPath = canonicalPath,
): CleanupResolution => ({ canonicalPath, cleanupPath, kind });
type CleanupHarnessInput = {
  isRegistered?: (worktreePath: string) => boolean;
  pathExists?: boolean | (() => boolean);
  pathIsWithinRoot?: (root: string, candidate: string) => boolean;
  removePathError?: HostOperationError;
  removalError?: Error;
  resolvedPaths: CleanupResolution[];
};
const createCleanupHarness = ({
  isRegistered = () => false,
  pathExists = true,
  pathIsWithinRoot = () => false,
  removePathError,
  removalError,
  resolvedPaths,
}: CleanupHarnessInput) => {
  const calls: string[] = [];
  let resolvedPathIndex = 0;
  const gitPort = {
    isRegisteredWorktree(repoPath: string, worktreePath: string) {
      return Effect.sync(() => {
        calls.push(`isRegisteredWorktree:${repoPath}|${worktreePath}`);
        return isRegistered(worktreePath);
      });
    },
    removeWorktree(repoPath: string, worktreePath: string, force: boolean) {
      return Effect.suspend(() => {
        calls.push(`removeWorktree:${repoPath}|${worktreePath}|${String(force)}`);
        return removalError
          ? Effect.fail(
              new HostOperationError({
                operation: "test.removeWorktree",
                message: removalError.message,
                cause: removalError,
              }),
            )
          : Effect.void;
      });
    },
  } as unknown as GitPort;
  const settingsConfig = {
    join: (...paths: string[]) => paths.join("/"),
    pathExists: () =>
      Effect.sync(() => (typeof pathExists === "function" ? pathExists() : pathExists)),
  } as unknown as SettingsConfigPort;
  const worktreeFiles: WorktreeFilePort = {
    ensureDirectory: () => Effect.void,
    copyConfiguredPaths: () => Effect.void,
    removePathIfPresent(inputPath) {
      return Effect.suspend(() => {
        calls.push(`removePathIfPresent:${inputPath}`);
        return removePathError ? Effect.fail(removePathError) : Effect.void;
      });
    },
    resolveWorktreePath: (_repoPath, worktreePath) => worktreePath,
    resolvePathWithinRoot() {
      const result = resolvedPaths[Math.min(resolvedPathIndex, resolvedPaths.length - 1)];
      resolvedPathIndex += 1;
      if (!result) {
        return Effect.die("missing resolved path fixture");
      }
      return Effect.succeed(result);
    },
    pathIsWithinRoot(root, candidate) {
      return Effect.succeed(pathIsWithinRoot(root, candidate));
    },
  };
  return {
    calls,
    dependencies: { gitPort, settingsConfig, worktreeFiles },
  };
};
const removeForcedWorktree = (
  harness: ReturnType<typeof createCleanupHarness>,
  worktreePath: string,
  managedWorktreeBasePath = "/managed/worktrees",
  missingOutsideManagedRootPathPolicy: "fail" | "skip" = "fail",
) =>
  Effect.runPromise(
    removeWorktreeAndFilesystemPath(harness.dependencies, {
      force: true,
      managedWorktreeBasePath,
      missingOutsideManagedRootPathPolicy,
      repoPath: "/repo",
      worktreePath,
    }),
  );
const getForcedRemovalError = (
  harness: ReturnType<typeof createCleanupHarness>,
  worktreePath: string,
) =>
  Effect.runPromise(
    Effect.flip(
      removeWorktreeAndFilesystemPath(harness.dependencies, {
        force: true,
        managedWorktreeBasePath: "/managed/worktrees",
        missingOutsideManagedRootPathPolicy: "fail",
        repoPath: "/repo",
        worktreePath,
      }),
    ),
  );

describe("removeWorktreeAndFilesystemPath", () => {
  test("propagates the removal error while Git still registers the canonical worktree", async () => {
    const removalError = new Error("worktree removal race");
    const harness = createCleanupHarness({
      isRegistered: (worktreePath) => worktreePath === "/real/worktrees/task-1",
      removalError,
      resolvedPaths: [
        cleanupResolution("/real/worktrees/task-1", "descendant"),
        cleanupResolution("/real/worktrees/task-1", "descendant"),
      ],
    });
    const error = await getForcedRemovalError(harness, "/managed/worktrees/task-1");
    expect(error).toMatchObject({ cause: removalError });
    expect(harness.calls).toContain("isRegisteredWorktree:/repo|/real/worktrees/task-1");
    expect(harness.calls).not.toContain("removePathIfPresent:/real/worktrees/task-1");
  });
  test("uses the canonical identity for a registered managed alias", async () => {
    const removalError = new Error("worktree removal race");
    const canonicalPath = "/real/descendant/task-1";
    const harness = createCleanupHarness({
      isRegistered: (worktreePath) => worktreePath === canonicalPath,
      removalError,
      resolvedPaths: [
        cleanupResolution(canonicalPath, "descendant"),
        cleanupResolution(canonicalPath, "descendant"),
      ],
    });
    const error = await getForcedRemovalError(harness, "/managed/worktrees/task-1");
    expect(error).toMatchObject({ cause: removalError });
    expect(harness.calls).toContain(`isRegisteredWorktree:/repo|${canonicalPath}`);
    expect(harness.calls).not.toContain(`removePathIfPresent:${canonicalPath}`);
  });
  test("does not remove a missing path whose symlinked parent resolves outside the managed root", async () => {
    const removalError = new Error("worktree removal race");
    const harness = createCleanupHarness({
      pathExists: false,
      pathIsWithinRoot: (root, candidate) => candidate.startsWith(`${root}/`),
      removalError,
      resolvedPaths: [
        cleanupResolution("/outside/task-1", "outside"),
        cleanupResolution("/outside/task-1", "outside"),
      ],
    });
    const error = await getForcedRemovalError(harness, "/managed/worktrees/runtime-link/task-1");
    expect(error).toMatchObject({ cause: removalError });
    expect(harness.calls).not.toContain(
      "removePathIfPresent:/managed/worktrees/runtime-link/task-1",
    );
  });
  test("cleans a missing canonical path under a symlinked managed root", async () => {
    const harness = createCleanupHarness({
      pathExists: false,
      removalError: new Error("worktree removal race"),
      resolvedPaths: [
        cleanupResolution("/real/worktrees/task-1", "descendant"),
        cleanupResolution("/real/worktrees/task-1", "descendant"),
      ],
    });
    await expect(
      removeForcedWorktree(harness, "/real/worktrees/task-1", "/configured/worktrees"),
    ).resolves.toBeUndefined();
    expect(harness.calls).toContain("removePathIfPresent:/real/worktrees/task-1");
  });
  test("preserves an actionable final filesystem cleanup error", async () => {
    const finalCleanupError = new HostOperationError({
      operation: "test.removePathIfPresent",
      message: "cannot remove runtime-created directory",
    });
    const harness = createCleanupHarness({
      removePathError: finalCleanupError,
      removalError: new Error("worktree removal race"),
      resolvedPaths: [
        cleanupResolution("/managed/worktrees/task-1", "descendant"),
        cleanupResolution("/managed/worktrees/task-1", "descendant"),
      ],
    });
    const error = await getForcedRemovalError(harness, "/managed/worktrees/task-1");
    expect(error).toMatchObject({
      cause: finalCleanupError,
      operation: "git.remove_worktree.cleanup_path",
    });
    expect(error.message).toContain("canonical cleanup path: /managed/worktrees/task-1");
  });
  test("reports a stranded existing path outside managed roots", async () => {
    const harness = createCleanupHarness({
      removalError: new Error("worktree removal race"),
      resolvedPaths: [
        cleanupResolution("/outside/task-1", "outside"),
        cleanupResolution("/outside/task-1", "outside"),
      ],
    });
    await expect(getForcedRemovalError(harness, "/outside/task-1")).resolves.toMatchObject({
      message: expect.stringContaining("outside managed roots"),
    });
    expect(harness.calls).not.toContain("removePathIfPresent:/outside/task-1");
  });
  test("propagates the removal error when a missing outside identity is unproved", async () => {
    const removalError = new Error("worktree removal race");
    const harness = createCleanupHarness({
      pathExists: false,
      removalError,
      resolvedPaths: [
        cleanupResolution("/legacy/task-1", "outside"),
        cleanupResolution("/legacy/task-1", "outside"),
      ],
    });
    const error = await getForcedRemovalError(harness, "/legacy/task-1");
    expect(error).toMatchObject({ cause: removalError });
    expect(harness.calls).not.toContain("removePathIfPresent:/legacy/task-1");
  });
  test("never removes the managed worktree root itself", async () => {
    const harness = createCleanupHarness({
      pathIsWithinRoot: (root, candidate) => root === candidate,
      resolvedPaths: [
        cleanupResolution("/managed/worktrees", "outside"),
        cleanupResolution("/managed/worktrees", "outside"),
      ],
    });
    await expect(removeForcedWorktree(harness, "/managed/worktrees")).rejects.toThrow(
      "outside managed roots",
    );
    expect(harness.calls).not.toContain("removeWorktree:/repo|/managed/worktrees|true");
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees");
  });
  test("rejects an existing managed symlink to an outside target before calling Git", async () => {
    const symlinkPath = "/managed/worktrees/task-link";
    const harness = createCleanupHarness({
      resolvedPaths: [cleanupResolution("/outside/task-1", "outside", symlinkPath)],
    });
    await expect(removeForcedWorktree(harness, symlinkPath)).rejects.toThrow(
      "outside managed roots",
    );
    expect(harness.calls).not.toContain(`removeWorktree:/repo|${symlinkPath}|true`);
    expect(harness.calls).not.toContain(`removePathIfPresent:${symlinkPath}`);
  });
  test("does not remove a path when its canonical identity changes during Git cleanup", async () => {
    const removalError = new Error("worktree removal race");
    const harness = createCleanupHarness({
      pathIsWithinRoot: (root, candidate) => candidate.startsWith(`${root}/`),
      removalError,
      resolvedPaths: [
        cleanupResolution("/managed/worktrees/task-1", "descendant"),
        cleanupResolution("/managed/worktrees/task-2", "descendant"),
      ],
    });
    const error = await getForcedRemovalError(harness, "/managed/worktrees/task-1");
    expect(error).toMatchObject({ cause: removalError });
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees/task-1");
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees/task-2");
  });
  test("removes a final symlink entry instead of its canonical target", async () => {
    const symlinkPath = "/managed/worktrees/task-link";
    const targetPath = "/managed/worktrees/task-target";
    const harness = createCleanupHarness({
      removalError: new Error("worktree removal race"),
      resolvedPaths: [
        cleanupResolution(targetPath, "descendant", symlinkPath),
        cleanupResolution(targetPath, "descendant", symlinkPath),
      ],
    });
    await expect(removeForcedWorktree(harness, symlinkPath)).resolves.toBeUndefined();
    expect(harness.calls).toContain(`removePathIfPresent:${symlinkPath}`);
    expect(harness.calls).not.toContain(`removePathIfPresent:${targetPath}`);
  });
  test("removes an unchanged dangling cleanup entry after Git succeeds", async () => {
    const symlinkPath = "/managed/worktrees/task-link";
    let pathExistsCalls = 0;
    const harness = createCleanupHarness({
      pathExists: () => {
        pathExistsCalls += 1;
        return pathExistsCalls === 1;
      },
      resolvedPaths: [
        cleanupResolution("/managed/worktrees/task-target", "descendant", symlinkPath),
        cleanupResolution(symlinkPath, "descendant", symlinkPath),
      ],
    });
    await expect(removeForcedWorktree(harness, symlinkPath)).resolves.toBeUndefined();
    expect(harness.calls).toContain(`removePathIfPresent:${symlinkPath}`);
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees/task-target");
  });
  test("accepts reconstructed casing after a managed target is removed", async () => {
    const cleanupPath = "/managed/worktrees/task-1";
    let pathExistsCalls = 0;
    const harness = createCleanupHarness({
      pathExists: () => {
        pathExistsCalls += 1;
        return pathExistsCalls === 1;
      },
      resolvedPaths: [
        cleanupResolution("/managed/worktrees/Task-1", "descendant", cleanupPath),
        cleanupResolution(cleanupPath, "descendant", cleanupPath),
      ],
    });
    await expect(removeForcedWorktree(harness, cleanupPath)).resolves.toBeUndefined();
    expect(harness.calls).toContain(`removePathIfPresent:${cleanupPath}`);
  });
  test.skipIf(process.platform !== "win32")(
    "accepts case-only changes to a Windows cleanup identity",
    async () => {
      const harness = createCleanupHarness({
        resolvedPaths: [
          cleanupResolution(String.raw`C:\Managed\Worktrees\Task-1`, "descendant"),
          cleanupResolution(String.raw`c:\managed\worktrees\task-1`, "descendant"),
        ],
      });
      await expect(
        removeForcedWorktree(harness, String.raw`C:\Managed\Worktrees\Task-1`),
      ).resolves.toBeUndefined();
      expect(harness.calls).toContain(String.raw`removePathIfPresent:c:\managed\worktrees\task-1`);
    },
  );
  test("rejects a changed cleanup identity after Git succeeds", async () => {
    const harness = createCleanupHarness({
      resolvedPaths: [
        cleanupResolution("/managed/worktrees/task-1", "descendant"),
        cleanupResolution("/managed/worktrees/task-2", "descendant"),
      ],
    });
    await expect(removeForcedWorktree(harness, "/managed/worktrees/task-1")).rejects.toThrow(
      "filesystem identity changed",
    );
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees/task-1");
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees/task-2");
  });
  test("skips an unregistered missing outside path when policy allows it", async () => {
    const outsidePath = "/legacy/task-1";
    const harness = createCleanupHarness({
      pathExists: false,
      removalError: new Error("worktree removal race"),
      resolvedPaths: [
        cleanupResolution(outsidePath, "outside"),
        cleanupResolution(outsidePath, "outside"),
      ],
    });
    await expect(
      removeForcedWorktree(harness, outsidePath, "/managed/worktrees", "skip"),
    ).resolves.toBeUndefined();
    expect(harness.calls).toContain(`isRegisteredWorktree:/repo|${outsidePath}`);
    expect(harness.calls).not.toContain(`removePathIfPresent:${outsidePath}`);
  });
  test("does not apply the outside-missing skip policy to a managed identity change", async () => {
    const harness = createCleanupHarness({
      pathExists: false,
      resolvedPaths: [
        cleanupResolution("/managed/worktrees/task-1", "descendant"),
        cleanupResolution("/managed/worktrees/task-2", "descendant"),
      ],
    });
    await expect(
      removeForcedWorktree(harness, "/managed/worktrees/task-1", "/managed/worktrees", "skip"),
    ).rejects.toThrow("filesystem identity changed");
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees/task-1");
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees/task-2");
  });
  test("rejects the repository root before calling Git", async () => {
    const harness = createCleanupHarness({
      pathIsWithinRoot: (root, candidate) => root === candidate,
      resolvedPaths: [cleanupResolution("/repo", "outside")],
    });
    await expect(removeForcedWorktree(harness, "/repo")).rejects.toThrow(
      "worktree path cannot be the repository root",
    );
    expect(harness.calls).toEqual([]);
  });
});
