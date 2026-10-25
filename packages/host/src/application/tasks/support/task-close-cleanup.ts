import type { AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { HostValidationError } from "../../../effect/host-errors";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import type { requireTaskCloseDependencies } from "./task-cleanup-dependencies";
import type { TaskWorkflow } from "@openducktor/workflows";
import { validateExistingTaskWorktreeCandidate } from "./task-cleanup-support";
import type { TaskRecord } from "../../../ports/task-repository-ports";

type CloseWorktreeCandidate = {
  path: string;
  source: "task_worktree" | "session";
};

const collectCloseManagedSessionWorktreePaths = (
  workflow: TaskWorkflow,
  sessions: AgentSessionRecord[],
): CloseWorktreeCandidate[] =>
  sessions.reduce<CloseWorktreeCandidate[]>((candidates, session) => {
    if (!workflow.hasRole(session.role.trim())) {
      return candidates;
    }

    const workingDirectory = session.workingDirectory.trim();
    if (workingDirectory.length > 0) {
      candidates.push({ path: workingDirectory, source: "session" });
    }

    return candidates;
  }, []);

export const collectCloseWorktreePaths = (
  dependencies: ReturnType<typeof requireTaskCloseDependencies> & {
    taskWorktreeService?: TaskWorktreeService;
  },
  repoPath: string,
  workflow: TaskWorkflow,
  task: TaskRecord,
  sessions: AgentSessionRecord[],
) =>
  Effect.gen(function* () {
    const normalizedRepo = normalizePathForComparison(repoPath);
    const taskWorktree = dependencies.taskWorktreeService
      ? yield* dependencies.taskWorktreeService.getTaskWorktree({
          repoPath,
          taskId: task.id,
        })
      : null;
    const candidatePaths: CloseWorktreeCandidate[] = [
      ...(taskWorktree
        ? [{ path: taskWorktree.workingDirectory, source: "task_worktree" as const }]
        : []),
      ...collectCloseManagedSessionWorktreePaths(workflow, sessions),
    ];
    const seen = new Set<string>();
    const paths: string[] = [];

    for (const candidate of candidatePaths) {
      const worktreePath = candidate.path;
      const normalizedWorktree = normalizePathForComparison(worktreePath);
      if (normalizedWorktree === normalizedRepo) {
        if (candidate.source === "session") {
          continue;
        }

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
        const validated = yield* validateExistingTaskWorktreeCandidate(
          dependencies.gitPort,
          repoPath,
          worktreePath,
          task.id,
          "close",
        );
        const normalizedValidated = normalizePathForComparison(validated);
        if (seen.has(normalizedValidated) && normalizedValidated !== normalizedWorktree) {
          continue;
        }
        seen.add(normalizedValidated);
        paths.push(validated);
        continue;
      }
      // Missing candidates stay in the list so shared local cleanup can apply
      // its explicit missing-path policy while preserving dependency checks.
      paths.push(worktreePath);
    }

    return paths;
  });
