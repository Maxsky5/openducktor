import { normalizePathForComparison } from "../../domain/path-comparison";
import { validateExistingGitTaskWorktree } from "../tasks/support/task-worktree-start";
import { Effect } from "effect";
import { validateTaskSessionWorkflowAvailable } from "../tasks/support/task-session-workflow-validation";
import {
  resolveLaunchWorkspace,
  validateWorkflowRuntimeSelection,
  launchValidationError,
} from "./workflow-launch-preparation";
import type { WorkflowLaunchContext, WorkflowLaunchDependencies } from "./workflow-launch-types";
import { findWorkflowSession } from "./task-workflow-session-storage";
export const createWorkflowLaunchSubmission = (deps: WorkflowLaunchDependencies) => {
  const validateSubmission = (attempt: WorkflowLaunchContext) =>
    Effect.gen(function* () {
      const input = attempt.sendInput;
      if (!input)
        return yield* launchValidationError("This launch has no retained first instruction.");
      yield* attempt.checkCanceled();
      attempt.stage("validate_submission");
      const records = yield* deps.tasks.agentSessionsList({
        repoPath: input.repoPath,
        taskId: attempt.request.taskId,
      });
      const record = findWorkflowSession(records, attempt.snapshot.role, input);
      if (!record)
        return yield* launchValidationError(
          "The retained session is no longer owned by this task. Inspect the task session before recovery.",
        );
      if (
        record.selectedModel?.runtimeKind !== attempt.snapshot.model?.runtimeKind ||
        record.selectedModel?.providerId !== attempt.snapshot.model?.providerId ||
        record.selectedModel?.modelId !== attempt.snapshot.model?.modelId ||
        record.selectedModel?.variant !== attempt.snapshot.model?.variant ||
        record.selectedModel?.profileId !== attempt.snapshot.model?.profileId
      )
        return yield* launchValidationError(
          "The session model changed after launch. Inspect the session before recovery.",
        );
      const task = yield* deps.taskReader.getTask({
        repoPath: input.repoPath,
        taskId: attempt.request.taskId,
      });
      yield* validateTaskSessionWorkflowAvailable(task, attempt.snapshot.role, input.repoPath);
      yield* attempt.checkCanceled();
      return task;
    });
  const validateRecovery = (attempt: WorkflowLaunchContext) =>
    Effect.gen(function* () {
      const task = yield* validateSubmission(attempt);
      const { repoPath } = yield* resolveLaunchWorkspace(deps, attempt.request);
      const input = attempt.sendInput!;
      const directory = yield* deps.git.canonicalizePath(input.workingDirectory);
      if (normalizePathForComparison(directory) !== normalizePathForComparison(repoPath))
        yield* validateExistingGitTaskWorktree(
          { gitPort: deps.git },
          repoPath,
          input.workingDirectory,
          task.id,
        );
      yield* validateWorkflowRuntimeSelection(
        deps,
        {
          repoPath,
          runtimeKind: input.runtimeKind,
          role: attempt.snapshot.role,
          startMode: "reuse",
        },
        attempt.snapshot.model,
      );
    });
  const send = (attempt: WorkflowLaunchContext) =>
    validateSubmission(attempt).pipe(Effect.andThen(attempt.send(deps.runtime.sendUserMessage)));
  return { validateRecovery, send };
};
