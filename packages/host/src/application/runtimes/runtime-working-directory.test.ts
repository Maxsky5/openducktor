import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSessionScope } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import {
  hasNestedNodeErrorCode,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import {
  addGitWorktree,
  gitFixtureEnv,
  initGitRepository,
} from "../../test-support/git-repository-fixture";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { requireRuntimeWorkingDirectory } from "./runtime-working-directory";
import {
  requireManagedHistoryDirectory,
  type RuntimeHistoryWorkingDirectoryDependencies,
} from "./runtime-history-working-directory";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

const canonicalizePath = (inputPath: string) =>
  Effect.tryPromise({
    try: () => realpath(inputPath),
    catch: (cause) => toHostOperationError(cause, "test.canonicalizePath"),
  });

test("checks real legacy directories when the workspace base is absent and rejects symlink escapes", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "odt-runtime-directory-"));
  try {
    const root = await realpath(temporaryDirectory);
    const repoPath = join(root, "repo");
    const legacyBase = join(root, "legacy");
    const workingDirectory = join(legacyBase, "task");
    const outsideDirectory = join(root, "outside");
    await Promise.all([
      mkdir(repoPath),
      mkdir(workingDirectory, { recursive: true }),
      mkdir(outsideDirectory),
    ]);
    const escapedDirectory = join(workingDirectory, "escape");
    await symlink(outsideDirectory, escapedDirectory, "junction");
    const dependencies = {
      gitPort: createGitPortTestDouble({ readCheckout: () => Effect.succeed(null) }),
      settingsConfig: createSettingsConfigTestDouble({
        canonicalizePath,
        defaultWorktreeBasePath: () => join(root, "missing-workspace-base"),
        defaultRepoWorktreeBasePath: () => legacyBase,
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfigByRepoPath: () =>
          Effect.succeed(
            repoConfigFixture({
              workspaceId: "workspace",
              workspaceName: "Workspace",
              repoPath,
            }),
          ),
      }),
    };

    await Effect.runPromise(
      requireRuntimeWorkingDirectory(dependencies, { repoPath, workingDirectory }),
    );
    const escapeError = await Effect.runPromise(
      Effect.flip(
        requireRuntimeWorkingDirectory(dependencies, {
          repoPath,
          workingDirectory: escapedDirectory,
        }),
      ),
    );
    expect(escapeError).toBeInstanceOf(HostValidationError);
    const missingDirectoryError = await Effect.runPromise(
      Effect.flip(
        requireRuntimeWorkingDirectory(dependencies, {
          repoPath,
          workingDirectory: join(legacyBase, "missing-task"),
        }),
      ),
    );
    expect(hasNestedNodeErrorCode(missingDirectoryError, "ENOENT")).toBe(true);

    const missingRepoError = await Effect.runPromise(
      Effect.flip(
        requireRuntimeWorkingDirectory(dependencies, {
          repoPath: join(root, "missing-repo"),
          workingDirectory,
        }),
      ),
    );
    expect(hasNestedNodeErrorCode(missingRepoError, "ENOENT")).toBe(true);

    await rm(legacyBase, { recursive: true });
    const outsideError = await Effect.runPromise(
      Effect.flip(
        requireRuntimeWorkingDirectory(dependencies, {
          repoPath,
          workingDirectory: outsideDirectory,
        }),
      ),
    );
    expect(outsideError).toBeInstanceOf(HostValidationError);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

// Real Git repositories and worktrees spawn many processes on Windows.
test("accepts registered worktrees outside the managed worktree roots", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "odt-runtime-directory-"));
  try {
    const root = await realpath(temporaryDirectory);
    const repoPath = join(root, "repo");
    const externalWorktree = join(root, "external", "feature");
    const externalWorktreeAlias = join(root, "feature-alias");
    const otherRepository = join(root, "external", "other");
    await Promise.all([mkdir(repoPath), mkdir(otherRepository, { recursive: true })]);
    initGitRepository(repoPath);
    initGitRepository(otherRepository);
    addGitWorktree(repoPath, externalWorktree, "feature");
    await symlink(externalWorktree, externalWorktreeAlias, "junction");
    const dependencies = {
      gitPort: createGitCliAdapter({
        readEnv: () => gitFixtureEnv,
        resolveCommand: () => Effect.succeed("git"),
      }),
      settingsConfig: createSettingsConfigTestDouble({
        canonicalizePath,
        defaultWorktreeBasePath: () => join(root, "managed"),
        defaultRepoWorktreeBasePath: () => join(root, "legacy"),
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfigByRepoPath: () =>
          Effect.succeed(
            repoConfigFixture({
              workspaceId: "workspace",
              workspaceName: "Workspace",
              repoPath,
            }),
          ),
      }),
    };

    await Effect.runPromise(
      requireRuntimeWorkingDirectory(dependencies, {
        repoPath,
        workingDirectory: externalWorktreeAlias,
      }),
    );
    const otherRepositoryError = await Effect.runPromise(
      Effect.flip(
        requireRuntimeWorkingDirectory(dependencies, {
          repoPath,
          workingDirectory: otherRepository,
        }),
      ),
    );
    expect(otherRepositoryError).toBeInstanceOf(HostValidationError);
  } finally {
    await removeTestDirectory(temporaryDirectory);
  }
}, 15_000);

for (const base of ["/workspace", "/legacy"]) {
  for (const code of ["EACCES", "EIO", "ENOTDIR"]) {
    test(`preserves ${code} from allowed base ${base}`, async () => {
      const failure = new HostOperationError({
        operation: "settingsConfig.canonicalizePath",
        message: `Cannot resolve ${base}`,
        cause: Object.assign(new Error(code), { code }),
      });
      const paths: string[] = [];
      const error = await Effect.runPromise(
        Effect.flip(
          requireRuntimeWorkingDirectory(
            {
              gitPort: createGitPortTestDouble({}),
              settingsConfig: createSettingsConfigTestDouble({
                canonicalizePath: (path) => {
                  paths.push(path);
                  return path === base ? Effect.fail(failure) : Effect.succeed(path);
                },
                defaultWorktreeBasePath: () => "/workspace",
                defaultRepoWorktreeBasePath: () => "/legacy",
              }),
              workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
                getRepoConfigByRepoPath: () =>
                  Effect.succeed(
                    repoConfigFixture({
                      workspaceId: "workspace",
                      workspaceName: "Workspace",
                    }),
                  ),
              }),
            },
            { repoPath: "/repo", workingDirectory: "/legacy/task" },
          ),
        ),
      );
      expect(error).toBe(failure);
      expect(paths).toEqual(
        base === "/workspace"
          ? ["/repo", "/legacy/task", "/workspace"]
          : ["/repo", "/legacy/task", "/workspace", "/legacy"],
      );
    });
  }
}

test.each(["workflow", "repository"] as const)(
  "uses the selected %s workspace for live and recorded directories with a shared repository path",
  async (kind) => {
    const sessionScope: AgentSessionScope =
      kind === "workflow"
        ? { kind, workspaceId: "selected", taskId: "task", role: "build" }
        : { kind, workspaceId: "selected" };
    const dependencies: RuntimeHistoryWorkingDirectoryDependencies = {
      gitPort: createGitPortTestDouble({ readCheckout: () => Effect.succeed(null) }),
      settingsConfig: createSettingsConfigTestDouble({
        canonicalizePath: (path) => Effect.succeed(path),
        defaultRepoWorktreeBasePath: () => "/legacy",
        defaultWorktreeBasePath: () => "/unselected",
        resolveConfiguredPath: (path) => path,
      }),
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfig: (workspaceId) =>
          Effect.succeed(
            repoConfigFixture({
              workspaceId,
              workspaceName: workspaceId,
              worktreeBasePath: `/worktrees/${workspaceId}`,
            }),
          ),
        getRepoConfigByRepoPath: () =>
          Effect.fail(
            new HostValidationError({
              message: "Several workspaces share this path. Select a workspace.",
            }),
          ),
      }),
      worktreeFiles: {
        resolvePathWithinRoot: (root, candidate) =>
          Effect.succeed({
            canonicalPath: candidate,
            cleanupPath: candidate,
            isSymlink: false,
            kind: candidate.startsWith(`${root}/`) ? "descendant" : "outside",
          }),
      },
    };
    const selected = {
      repoPath: "/repo",
      workingDirectory: "/worktrees/selected/task",
      sessionScope,
    };
    await Effect.runPromise(requireRuntimeWorkingDirectory(dependencies, selected));
    await Effect.runPromise(requireManagedHistoryDirectory(dependencies, selected));
    await expect(
      Effect.runPromise(
        requireRuntimeWorkingDirectory(dependencies, {
          ...selected,
          workingDirectory: "/worktrees/foreign/task",
        }),
      ),
    ).rejects.toThrow("outside the selected workspace");
    await expect(
      Effect.runPromise(
        requireManagedHistoryDirectory(dependencies, {
          ...selected,
          workingDirectory: "/worktrees/foreign/task",
        }),
      ),
    ).rejects.toThrow("outside the managed worktrees");
    await expect(
      Effect.runPromise(
        requireRuntimeWorkingDirectory(dependencies, {
          ...selected,
          repoPath: "/moved/repo",
          workingDirectory: "/moved/repo",
        }),
      ),
    ).rejects.toThrow("no longer matches");
    await expect(
      Effect.runPromise(
        requireRuntimeWorkingDirectory(dependencies, {
          repoPath: "/repo",
          workingDirectory: "/repo",
        }),
      ),
    ).rejects.toThrow("Select a workspace");
  },
);
