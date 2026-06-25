import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { HostValidationError } from "../../../effect/host-errors";
import type { requireTaskCloseDependencies } from "./task-cleanup-dependencies";
import { implementationSessionRoles, isRelatedTaskBranch } from "./task-cleanup-support";

const collectCloseManagedSessionWorktreePaths = (sessions: AgentSessionRecord[]): string[] =>
  sessions
    .filter((session) => implementationSessionRoles.has(session.role.trim()))
    .map((session) => session.workingDirectory.trim())
    .filter((workingDirectory) => workingDirectory.length > 0);

export const collectCloseWorktreePaths = (
  dependencies: ReturnType<typeof requireTaskCloseDependencies>,
  repoPath: string,
  branchPrefix: string,
  task: TaskCard,
  sessions: AgentSessionRecord[],
) =>
  Effect.gen(function* () {
    const normalizedRepo = normalizePathForComparison(repoPath);
    const taskWorktree = yield* dependencies.taskWorktreeService.getTaskWorktree({
      repoPath,
      taskId: task.id,
    });
    const candidatePaths = [
      ...(taskWorktree ? [taskWorktree.workingDirectory] : []),
      ...collectCloseManagedSessionWorktreePaths(sessions),
    ];
    const seen = new Set<string>();
    const paths: string[] = [];

    for (const worktreePath of candidatePaths) {
      const normalizedWorktree = normalizePathForComparison(worktreePath);
      if (normalizedWorktree === normalizedRepo) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Cannot close task ${task.id} because worktree ${worktreePath} resolves to the repository root.`,
            details: { repoPath, taskId: task.id, worktreePath },
          }),
        );
      }
      if (seen.has(normalizedWorktree)) {
        continue;
      }
      seen.add(normalizedWorktree);
      if (yield* dependencies.settingsConfig.pathExists(worktreePath)) {
        const currentBranch = yield* dependencies.gitPort.getCurrentBranch(worktreePath);
        const branchName = currentBranch.name?.trim();
        if (!branchName) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Cannot close task ${task.id} because worktree ${worktreePath} is detached or has no active branch.`,
              details: { repoPath, taskId: task.id, worktreePath },
            }),
          );
        }
        if (!isRelatedTaskBranch(branchName, branchPrefix, task.id)) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Cannot close task ${task.id} because worktree ${worktreePath} is on unrelated branch ${branchName}.`,
              details: { repoPath, taskId: task.id, worktreePath, branchName },
            }),
          );
        }
      }
      paths.push(worktreePath);
    }

    return paths;
  });
