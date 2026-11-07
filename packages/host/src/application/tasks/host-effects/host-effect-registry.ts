import type { HostEffectId, TaskArtifactChange, TaskCard } from "@openducktor/contracts";
import type { Effect, Scope } from "effect";
import type { TaskIdInput } from "../task-inputs";
import type { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceError, TaskServiceUseCaseInput } from "../task-service";
import { createWorktreeResetEffect } from "./worktree-reset";

export type HostEffectError = TaskServiceError | TaskMutationProgressFailure;

/** What a host effect gets from the event that runs it. */
export type HostEffectContext = {
  readonly input: TaskIdInput;
  readonly eventId: string;
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

/** The handler of each host effect. */
export const createHostEffectRegistry = (input: TaskServiceUseCaseInput) =>
  ({
    "worktree.reset": createWorktreeResetEffect(input),
  }) satisfies Record<HostEffectId, HostEffectHandler>;
