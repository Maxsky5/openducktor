import type { RepoConfig } from "@openducktor/contracts";
import { taskNamingWorkText } from "@openducktor/workflows";
import { Effect } from "effect";
import { buildBranchName, targetBranchName } from "../../../domain/task";
import type { TaskRecord } from "../../../ports/task-repository-ports";
import { startupStep } from "../../agent-sessions/session-startup-progress";
import {
  branchNamingStep,
  nameBranch,
  type BranchNamingDependencies,
} from "../../naming/branch-naming";

type TaskBranchRepoConfig = Pick<
  RepoConfig,
  | "repoPath"
  | "branchPrefix"
  | "defaultTargetBranch"
  | "namingModel"
  | "promptOverrides"
  | "promptAppends"
>;

/** The startup step of the branch naming of a new task worktree, or null without a naming model. */
export const taskBranchNamingStep = (repoConfig: Pick<RepoConfig, "namingModel">) =>
  branchNamingStep(repoConfig, false);

/**
 * The free branch of a new task worktree. The naming model names it from the task title and
 * description. Without a usable model branch, it comes from the task ID and title. A naming
 * failure shows on the naming step.
 */
export const nameTaskBranch = (
  deps: BranchNamingDependencies,
  input: {
    repoConfig: TaskBranchRepoConfig;
    repoPath: string;
    task: Pick<TaskRecord, "id" | "title" | "description" | "targetBranch">;
  },
) =>
  Effect.gen(function* () {
    const { repoConfig, task } = input;
    const naming = nameBranch(deps, {
      repoConfig,
      gitDirectory: input.repoPath,
      workText: taskNamingWorkText(task),
      reserved: [targetBranchName(task, repoConfig.defaultTargetBranch)],
      fallback: buildBranchName(repoConfig.branchPrefix, task.id, task.title),
      withTitle: false,
    });
    const step = taskBranchNamingStep(repoConfig);
    if (step === null) return (yield* naming).branch;
    const named = yield* startupStep(step, naming, (result) =>
      result.notice !== null ? { details: [result.notice], warning: result.notice } : {},
    );
    return named.branch;
  });
