import type { AgentRole, RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { GitPort } from "../../../ports/git-port";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { HostValidationError } from "../../../effect/host-errors";

export const resolveTaskSessionStartTarget = ({
  settingsConfig,
  gitPort,
  repoConfig,
  taskId,
  role,
  targetWorkingDirectory,
}: {
  settingsConfig: SettingsConfigPort;
  gitPort: GitPort;
  repoConfig: RepoConfig;
  taskId: string;
  role: AgentRole;
  targetWorkingDirectory?: string;
}) =>
  Effect.gen(function* () {
    const worktreeBase = repoConfig.worktreeBasePath
      ? settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
      : settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
    const worktreePath = settingsConfig.join(worktreeBase, taskId);
    let targetsCanonicalWorktree = !targetWorkingDirectory;
    if (targetWorkingDirectory) {
      targetsCanonicalWorktree =
        normalizePathForComparison(targetWorkingDirectory) ===
        normalizePathForComparison(worktreePath);
      if (!targetsCanonicalWorktree) {
        const [targetExists, worktreeExists] = yield* Effect.all([
          settingsConfig.pathExists(targetWorkingDirectory),
          settingsConfig.pathExists(worktreePath),
        ]);
        if (targetExists && worktreeExists) {
          const [canonicalTargetPath, canonicalWorktreePath] = yield* Effect.all([
            gitPort.canonicalizePath(targetWorkingDirectory),
            gitPort.canonicalizePath(worktreePath),
          ]);
          targetsCanonicalWorktree =
            normalizePathForComparison(canonicalTargetPath) ===
            normalizePathForComparison(canonicalWorktreePath);
        }
      }
    }
    if (!targetsCanonicalWorktree) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "targetWorkingDirectory",
          message: `Fresh ${role} sessions must use canonical task worktree ${worktreePath}.`,
          details: {
            taskId,
            role,
            expected: worktreePath,
            actual: targetWorkingDirectory,
          },
        }),
      );
    }

    return { worktreeBase, worktreePath };
  });
