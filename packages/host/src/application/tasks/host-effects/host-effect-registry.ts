import type { HostEffectId, TaskArtifactChange, TaskCard } from "@openducktor/contracts";
import type { TaskWorkflowHostEffect } from "@openducktor/workflows";
import type { Effect, Scope } from "effect";
import type { TaskIdInput } from "../task-inputs";
import type { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceError, TaskServiceUseCaseInput } from "../task-service";
import { createWorktreeResetEffect } from "./worktree-reset";

export type HostEffectError = TaskServiceError | TaskMutationProgressFailure;

type HostEffectContext = {
  readonly input: TaskIdInput;
  readonly eventId: string;
  /** The effect as the event declares it, with its settings. */
  readonly effect: TaskWorkflowHostEffect;
  /** The effect adds each artifact that it changes, so the task event reports the change. */
  readonly artifactChanges: TaskArtifactChange[];
};

/**
 * A host effect does its work, then runs `commit`, which runs the next effects and commits the
 * event. When its work fails, it fails without `commit`, so the event does not commit.
 */
export type HostEffectHandler = (
  context: HostEffectContext,
  commit: Effect.Effect<TaskCard, HostEffectError, Scope.Scope>,
) => Effect.Effect<TaskCard, HostEffectError, Scope.Scope>;

export const createHostEffectRegistry = (input: TaskServiceUseCaseInput) =>
  ({
    "worktree.reset": createWorktreeResetEffect(input),
  }) satisfies Record<HostEffectId, HostEffectHandler>;
