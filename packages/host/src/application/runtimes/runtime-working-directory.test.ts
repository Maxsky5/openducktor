import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import {
  hasNestedNodeErrorCode,
  HostOperationError,
  HostValidationError,
} from "../../effect/host-errors";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import { requireRuntimeWorkingDirectory } from "./runtime-working-directory";

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
      gitPort: { isRegisteredWorktree: () => Effect.succeed(false) },
      settingsConfig: {
        ...createSettingsConfigAdapter(),
        defaultWorktreeBasePath: () => join(root, "missing-workspace-base"),
        defaultRepoWorktreeBasePath: () => legacyBase,
      },
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfigByRepoPath: () =>
          Effect.succeed(
            repoConfigSchema.parse({
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

test("accepts registered worktrees outside the managed worktree roots", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "odt-runtime-directory-"));
  try {
    const root = await realpath(temporaryDirectory);
    const repoPath = join(root, "repo");
    const externalWorktree = join(root, "external", "feature");
    const unregisteredDirectory = join(root, "external", "other");
    const externalWorktreeAlias = join(root, "feature-alias");
    await Promise.all([
      mkdir(repoPath),
      mkdir(externalWorktree, { recursive: true }),
      mkdir(unregisteredDirectory, { recursive: true }),
    ]);
    await symlink(externalWorktree, externalWorktreeAlias, "junction");
    const registeredChecks: Array<{ repoPath: string; worktreePath: string }> = [];
    const dependencies = {
      gitPort: {
        isRegisteredWorktree: (checkedRepoPath: string, worktreePath: string) => {
          registeredChecks.push({ repoPath: checkedRepoPath, worktreePath });
          return Effect.succeed(checkedRepoPath === repoPath && worktreePath === externalWorktree);
        },
      },
      settingsConfig: {
        ...createSettingsConfigAdapter(),
        defaultWorktreeBasePath: () => join(root, "managed"),
        defaultRepoWorktreeBasePath: () => join(root, "legacy"),
      },
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfigByRepoPath: () =>
          Effect.succeed(
            repoConfigSchema.parse({
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
    expect(registeredChecks).toEqual([{ repoPath, worktreePath: externalWorktree }]);

    const unregisteredError = await Effect.runPromise(
      Effect.flip(
        requireRuntimeWorkingDirectory(dependencies, {
          repoPath,
          workingDirectory: unregisteredDirectory,
        }),
      ),
    );
    expect(unregisteredError).toBeInstanceOf(HostValidationError);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

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
                    repoConfigSchema.parse({
                      workspaceId: "workspace",
                      workspaceName: "Workspace",
                      repoPath: "/repo",
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
