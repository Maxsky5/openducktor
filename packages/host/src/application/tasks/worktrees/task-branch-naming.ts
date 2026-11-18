import type { RepoConfig } from "@openducktor/contracts";
import { taskNamingWorkText } from "@openducktor/workflows";
import { Effect, Fiber } from "effect";
import { buildBranchName, targetBranchName } from "../../../domain/task";
import { freeBranchName, readTakenBranchNames } from "../../naming/free-branch-name";
import type { GitPort } from "../../../ports/git-port";
import type { TaskRecord } from "../../../ports/task-repository-ports";
import { startupStep, updateStartup } from "../../agent-sessions/session-startup-progress";
import { namingFailureNotice, type NamingService } from "../../naming/naming-service";

const NAMING_STEP = { id: "naming", label: "Generate branch name" } as const;

/**
 * The branch of a new task worktree. With a naming model, the model names it from the task title
 * and description, with `-2`, `-3`, and so on when a local or remote branch or the task target
 * branch has the name. Without a usable model name, the branch comes from the task title.
 * `generated` marks a model branch, which the worktree setup must create without an existing
 * upstream.
 */
export const chooseTaskBranch = (
  deps: {
    naming: NamingService;
    gitPort: Pick<GitPort, "listRefNames" | "listRemoteNames">;
  },
  input: {
    repoConfig: Pick<
      RepoConfig,
      | "repoPath"
      | "branchPrefix"
      | "defaultTargetBranch"
      | "namingModel"
      | "promptOverrides"
      | "promptAppends"
    >;
    repoPath: string;
    task: Pick<TaskRecord, "id" | "title" | "description" | "targetBranch">;
  },
) =>
  Effect.gen(function* () {
    const { repoConfig, task } = input;
    const fallback = buildBranchName(repoConfig.branchPrefix, task.id, task.title);
    const fromTitle = { branch: fallback, generated: false };
    // Without a naming model, no naming step shows.
    if (!repoConfig.namingModel) return fromTitle;
    // The listing runs while the model writes the name.
    const taken = yield* Effect.forkChild(
      readTakenBranchNames(deps.gitPort, input.repoPath, [
        targetBranchName(task, repoConfig.defaultTargetBranch),
      ]),
    );
    const outcome = yield* startupStep(
      NAMING_STEP,
      deps.naming.generate({
        repoConfig,
        outputs: { title: false, branch: true },
        workText: taskNamingWorkText(task),
      }),
    );
    const failure = (message: string) =>
      updateStartup((progress) =>
        progress.step({
          ...NAMING_STEP,
          state: "completed",
          details: [namingFailureNotice(message, `the branch ${fallback}`)],
        }),
      );
    if (outcome.kind === "generated" && outcome.branch) {
      const branch = outcome.branch;
      const free = yield* Effect.result(
        Fiber.join(taken).pipe(Effect.flatMap((names) => freeBranchName(names, branch))),
      );
      if (free._tag === "Success") return { branch: free.success, generated: true };
      yield* failure(free.failure.message);
      return fromTitle;
    }
    if (outcome.kind === "failed") yield* failure(outcome.message);
    return fromTitle;
  });
