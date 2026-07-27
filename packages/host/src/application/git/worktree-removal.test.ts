import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ResolvedPathWithinRoot, WorktreeFilePort } from "../../ports/worktree-file-port";
import { removeWorktreeAndFilesystemPath } from "./worktree-removal";

type CleanupHarnessInput = {
  isRegistered?: (worktreePath: string) => boolean;
  pathExists?: boolean;
  pathIsWithinRoot?: (root: string, candidate: string) => boolean;
  removePathError?: HostOperationError;
  removalError?: Error;
  resolvedPaths: ResolvedPathWithinRoot[];
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
    pathExists: () => Effect.succeed(pathExists),
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
) =>
  Effect.runPromise(
    removeWorktreeAndFilesystemPath(harness.dependencies, {
      force: true,
      managedWorktreeBasePath,
      missingOutsideManagedRootPathPolicy: "fail",
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
        { canonicalPath: "/real/worktrees/task-1", kind: "descendant" },
        { canonicalPath: "/real/worktrees/task-1", kind: "descendant" },
      ],
    });
    const error = await getForcedRemovalError(harness, "/managed/worktrees/task-1");
    expect(error).toMatchObject({ cause: removalError });
    expect(harness.calls).toContain("isRegisteredWorktree:/repo|/real/worktrees/task-1");
    expect(harness.calls).not.toContain("removePathIfPresent:/real/worktrees/task-1");
  });
  test.each([
    ["managed", "descendant"],
    ["outside", "outside"],
  ] satisfies Array<[string, ResolvedPathWithinRoot["kind"]]>)(
    "uses the canonical identity for a registered %s alias",
    async (_description, kind) => {
      const removalError = new Error("worktree removal race");
      const canonicalPath = `/real/${kind}/task-1`;
      const harness = createCleanupHarness({
        isRegistered: (worktreePath) => worktreePath === canonicalPath,
        removalError,
        resolvedPaths: [
          { canonicalPath, kind },
          { canonicalPath, kind },
        ],
      });
      const error = await getForcedRemovalError(harness, "/managed/worktrees/task-1");
      expect(error).toMatchObject({ cause: removalError });
      expect(harness.calls).toContain(`isRegisteredWorktree:/repo|${canonicalPath}`);
      expect(harness.calls).not.toContain(`removePathIfPresent:${canonicalPath}`);
    },
  );
  test("does not remove a missing path whose symlinked parent resolves outside the managed root", async () => {
    const removalError = new Error("worktree removal race");
    const harness = createCleanupHarness({
      pathExists: false,
      pathIsWithinRoot: (root, candidate) => candidate.startsWith(`${root}/`),
      removalError,
      resolvedPaths: [
        { canonicalPath: "/outside/task-1", kind: "outside" },
        { canonicalPath: "/outside/task-1", kind: "outside" },
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
        { canonicalPath: "/real/worktrees/task-1", kind: "descendant" },
        { canonicalPath: "/real/worktrees/task-1", kind: "descendant" },
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
        { canonicalPath: "/managed/worktrees/task-1", kind: "descendant" },
        { canonicalPath: "/managed/worktrees/task-1", kind: "descendant" },
      ],
    });
    const error = await getForcedRemovalError(harness, "/managed/worktrees/task-1");
    expect(error).toMatchObject({
      cause: finalCleanupError,
      operation: "git.remove_worktree.cleanup_path",
    });
  });
  test("rejects a stranded existing path outside managed roots", async () => {
    const harness = createCleanupHarness({
      removalError: new Error("worktree removal race"),
      resolvedPaths: [
        { canonicalPath: "/outside/task-1", kind: "outside" },
        { canonicalPath: "/outside/task-1", kind: "outside" },
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
        { canonicalPath: "/legacy/task-1", kind: "outside" },
        { canonicalPath: "/legacy/task-1", kind: "outside" },
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
        { canonicalPath: "/managed/worktrees", kind: "outside" },
        { canonicalPath: "/managed/worktrees", kind: "outside" },
      ],
    });
    await expect(removeForcedWorktree(harness, "/managed/worktrees")).rejects.toThrow(
      "outside managed roots",
    );
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees");
  });
  test("does not remove a path when its canonical identity changes during Git cleanup", async () => {
    const removalError = new Error("worktree removal race");
    const harness = createCleanupHarness({
      pathIsWithinRoot: (root, candidate) => candidate.startsWith(`${root}/`),
      removalError,
      resolvedPaths: [
        { canonicalPath: "/managed/worktrees/task-1", kind: "descendant" },
        { canonicalPath: "/managed/worktrees/task-2", kind: "descendant" },
      ],
    });
    const error = await getForcedRemovalError(harness, "/managed/worktrees/task-1");
    expect(error).toMatchObject({ cause: removalError });
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees/task-1");
    expect(harness.calls).not.toContain("removePathIfPresent:/managed/worktrees/task-2");
  });
});
