import type { WorkspaceRef } from "@openducktor/contracts";
import { Effect } from "effect";
import { canonicalTargetBranch, checkoutBranch } from "../../../domain/task";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { TaskRecord } from "../../../ports/task-repository-ports";
import { getScopedRepoConfig } from "../../workspaces/scoped-repo-config";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import { START_WORKTREE_SESSION_HINT } from "./task-workflow-events";

type TaskTargetBranchInput = WorkspaceRef & {
  task: Pick<TaskRecord, "id" | "targetBranch" | "targetBranchError">;
};

export const loadTaskTargetBranch = (
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">,
  { task, ...scope }: TaskTargetBranchInput,
) =>
  Effect.gen(function* () {
    if (task.targetBranchError)
      return yield* new HostValidationError({
        field: "targetBranch",
        message: task.targetBranchError,
        details: { repoPath: scope.repoPath, taskId: task.id },
      });
    if (task.targetBranch) return { source: "task" as const, branch: task.targetBranch };
    const config = yield* getScopedRepoConfig(settings, scope);
    return { source: "workspace" as const, branch: config.defaultTargetBranch };
  });

export const resolveTaskWorktreeStartPoint = (
  {
    gitPort,
    workspaceSettingsService,
  }: {
    gitPort: Pick<GitPort, "referenceExists">;
    workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfig">;
  },
  input: TaskTargetBranchInput,
) =>
  Effect.gen(function* () {
    const { repoPath } = input;
    const { branch: targetBranch, source } = yield* loadTaskTargetBranch(
      workspaceSettingsService,
      input,
    );
    const configuredTargetBranch = yield* Effect.try({
      try: () => canonicalTargetBranch(targetBranch),
      catch: (cause) => new HostValidationError({ message: errorMessage(cause), cause }),
    });
    if (yield* gitPort.referenceExists(repoPath, configuredTargetBranch)) {
      return {
        reference: configuredTargetBranch,
        upstreamRemote: targetBranch.remote?.trim() || null,
      };
    }
    if (source === "workspace" && targetBranch.remote?.trim() === "origin") {
      const localBranch = checkoutBranch(targetBranch);
      if (yield* gitPort.referenceExists(repoPath, localBranch)) {
        return { reference: localBranch, upstreamRemote: null };
      }
    }
    return yield* new HostValidationError({
      field: "targetBranch",
      message: `Target branch ${configuredTargetBranch} does not exist in this repository. Choose an existing target branch, or fetch this branch first.`,
      details: { repoPath, targetBranch: configuredTargetBranch },
    });
  });

const unavailableTaskBranch = <Details extends object>(error: HostValidationError<Details>) =>
  ({ kind: "unavailable", error }) as const;

export const inspectTaskBranches = (
  dependencies: {
    gitPort: GitPort;
    taskWorktreeService: TaskWorktreeService;
    workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfig">;
  },
  input: WorkspaceRef & {
    task: TaskRecord;
    operationLabel: string;
  },
) =>
  Effect.gen(function* () {
    const { workspaceId, repoPath, task, operationLabel } = input;
    const taskId = task.id;
    const taskWorktree = yield* dependencies.taskWorktreeService.getTaskWorktree({
      workspaceId,
      repoPath,
      taskId,
    });
    if (!taskWorktree) {
      return unavailableTaskBranch(
        new HostValidationError({
          field: "taskId",
          message: `${operationLabel} requires a task worktree for task ${taskId}. ${START_WORKTREE_SESSION_HINT}`,
          details: { repoPath, taskId },
        }),
      );
    }
    const { workingDirectory } = taskWorktree;
    const currentBranch = yield* dependencies.gitPort.getCurrentBranch(workingDirectory);
    if (currentBranch.detached) {
      return unavailableTaskBranch(
        new HostValidationError({
          field: "workingDirectory",
          message: `${operationLabel} requires a task branch, but the task worktree is detached.`,
          details: { workingDirectory },
        }),
      );
    }
    const sourceBranch = currentBranch.name?.trim();
    if (!sourceBranch) {
      return unavailableTaskBranch(
        new HostValidationError({
          field: "workingDirectory",
          message: `${operationLabel} requires a task branch name.`,
          details: { workingDirectory },
        }),
      );
    }
    const { branch } = yield* loadTaskTargetBranch(dependencies.workspaceSettingsService, {
      workspaceId,
      repoPath,
      task,
    });
    const targetBranch = yield* Effect.try({
      try: () => checkoutBranch(branch),
      catch: (cause) => new HostValidationError({ message: errorMessage(cause), cause }),
    });
    return { kind: "available" as const, branches: { sourceBranch, targetBranch } };
  });

export const requireTaskBranches = (...args: Parameters<typeof inspectTaskBranches>) =>
  inspectTaskBranches(...args).pipe(
    Effect.flatMap((result) =>
      result.kind === "available" ? Effect.succeed(result.branches) : Effect.fail(result.error),
    ),
  );
