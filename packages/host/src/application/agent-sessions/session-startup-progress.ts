import type {
  StartupInstruction,
  StartupOperationSnapshot,
  StartupOwnership,
  StartupPreparedHandoff,
  StartupStep,
  AgentSessionLiveRef,
  AgentSessionControlSummary,
} from "@openducktor/contracts";
import { Context, Effect } from "effect";
import { createProgressSnapshot } from "../operation-progress/progress-snapshot";
import { errorMessage, type HostError } from "../../effect/host-errors";

export type StartupStepUpdate = Pick<StartupStep, "id" | "label" | "state"> & Partial<StartupStep>;

export type StartupProgressRecorder = {
  snapshot(): StartupOperationSnapshot;
  step(step: StartupStepUpdate): void;
  /** Adds the planned steps in one snapshot, so a client shows them together. */
  plan(steps: StartupStepUpdate[]): void;
  ownership(ownership: StartupOwnership): void;
  instruction(instruction: StartupInstruction): void;
  phase(phase: StartupOperationSnapshot["phase"]): void;
  settle(phase: "completed" | "failed" | "canceled", message?: string): void;
  finalize(ref: AgentSessionLiveRef): Effect.Effect<void, HostError>;
  confirmStopped(ref: AgentSessionLiveRef): Effect.Effect<void, HostError>;
  expectPreparationRuntime(runtimeId: string): void;
};

export const CurrentStartupProgress = Context.Reference<StartupProgressRecorder | undefined>(
  "@openducktor/host/CurrentStartupProgress",
  { defaultValue: () => undefined },
);

const PRE_SESSION_STEP_IDS = new Set(["checks", "naming", "checkout", "upstream", "copies"]);
const PRE_INSTRUCTION_STEP_IDS = new Set(["save", "bind", "workflow", "publish", "handoff"]);
const isPreSessionStep = (id: string) => PRE_SESSION_STEP_IDS.has(id) || id.startsWith("action:");

const mergeStep = (steps: StartupStep[], step: StartupStepUpdate): StartupStep[] => {
  const previous = steps.find((item) => item.id === step.id);
  const next: StartupStep = {
    details: [],
    ...previous,
    ...step,
  };
  if (previous?.action && step.action) next.action = { ...previous.action, ...step.action };
  if (previous?.state === "failed") {
    next.state = "failed";
    if (previous.failure) next.failure = previous.failure;
  }
  if (previous?.action?.result && !step.action?.result) {
    next.state = previous.state;
    next.details = previous.details;
  }
  let updated: StartupStep[];
  if (previous) {
    updated = steps.map((item) => (item.id === step.id ? next : item));
  } else if (isPreSessionStep(step.id)) {
    const insertAt = steps.findIndex((item) => item.id === "prepare" || item.id === "instruction");
    updated =
      insertAt === -1
        ? [...steps, next]
        : [...steps.slice(0, insertAt), next, ...steps.slice(insertAt)];
  } else if (PRE_INSTRUCTION_STEP_IDS.has(step.id)) {
    const insertAt = steps.findIndex((item) => item.id === "instruction");
    updated =
      insertAt === -1
        ? [...steps, next]
        : [...steps.slice(0, insertAt), next, ...steps.slice(insertAt)];
  } else {
    updated = [...steps, next];
  }
  return updated.map((item) =>
    item.id === "request" && step.id !== "request" && item.state === "running"
      ? { ...item, state: "completed" as const }
      : item,
  );
};

const mergePlanStep = (steps: StartupStep[], step: StartupStepUpdate): StartupStep[] => {
  const previous = steps.find((item) => item.id === step.id);
  if (previous && step.state === "pending" && previous.state !== "pending") {
    return steps;
  }
  return mergeStep(steps, step);
};

export const createStartupProgressRecorder = (
  initial: Omit<StartupOperationSnapshot, "revision" | "steps" | "ownership" | "phase">,
  publish: (snapshot: StartupOperationSnapshot) => void,
  finalize: (
    ref: AgentSessionLiveRef,
    expectedRuntimeId?: string,
  ) => Effect.Effect<StartupPreparedHandoff, HostError>,
  confirmStopped: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>,
): StartupProgressRecorder => {
  let expectedRuntimeId: string | undefined;
  const progress = createProgressSnapshot<StartupOperationSnapshot>(
    {
      ...initial,
      revision: 0,
      steps: [],
      ownership: { state: "not_saved" },
      phase: "running",
    },
    publish,
  );
  const commit = (fields: Partial<StartupOperationSnapshot>) =>
    progress.commit({ ...progress.current(), ...fields });
  return {
    snapshot: progress.read,
    step: (step) => commit({ steps: mergeStep(progress.current().steps, step) }),
    plan: (steps) => {
      const nextSteps = steps.reduce(mergePlanStep, progress.current().steps);
      if (JSON.stringify(nextSteps) === JSON.stringify(progress.current().steps)) return;
      commit({ steps: nextSteps });
    },
    ownership: (ownership) => {
      if (progress.current().ownership.state === "saved" && ownership.state !== "saved") return;
      commit({ ownership });
    },
    instruction: (instruction) => commit({ instruction }),
    confirmStopped,
    expectPreparationRuntime: (runtimeId) => {
      expectedRuntimeId ??= runtimeId;
    },
    finalize: (ref) =>
      finalize(ref, expectedRuntimeId).pipe(
        Effect.tap((prepared) => Effect.sync(() => commit({ prepared }))),
        Effect.asVoid,
      ),
    phase: (phase) => commit({ phase }),
    settle: (phase, message) => {
      commit({
        phase,
        steps: progress.current().steps.map((step) => {
          if (
            phase === "completed" &&
            (step.state === "running" || step.state === "waiting") &&
            !step.action
          )
            return { ...step, state: "completed" };
          if (step.state === "pending" || step.state === "waiting")
            return { ...step, state: "not_run" };
          if (step.state === "running" && !step.action && phase !== "completed") {
            const failed: StartupStep = { ...step, state: "failed" };
            if (message) failed.failure = startupFailure(step.id, message);
            return failed;
          }
          return step;
        }),
      });
    },
  };
};

export const updateStartup = (update: (progress: StartupProgressRecorder) => void) =>
  Effect.gen(function* () {
    const progress = yield* CurrentStartupProgress;
    if (progress) update(progress);
  });

export const finalizeStartup = (ref: AgentSessionLiveRef) =>
  Effect.gen(function* () {
    const progress = yield* CurrentStartupProgress;
    if (progress)
      yield* startupStep(
        { id: "handoff", label: "Prepare session handoff" },
        progress.finalize(ref),
      );
  });

/** Completes direct task commands inside their existing host worker. */
export const completeStartupSession = <Failure>(
  work: Effect.Effect<AgentSessionControlSummary, Failure>,
  repoPath: string,
) =>
  Effect.gen(function* () {
    const progress = yield* CurrentStartupProgress;
    if (!progress || progress.snapshot().scope.kind !== "task") return yield* work;
    return yield* work.pipe(
      Effect.tap((session) =>
        Effect.gen(function* () {
          if (!progress.snapshot().prepared)
            yield* finalizeStartup({
              repoPath,
              runtimeKind: session.runtimeKind,
              workingDirectory: session.workingDirectory,
              externalSessionId: session.externalSessionId,
            });
          progress.settle("completed");
        }),
      ),
      Effect.tapError((failure) =>
        Effect.sync(() => {
          progress.settle("failed", errorMessage(failure));
          rememberStartupFailure(failure, progress.snapshot());
        }),
      ),
    );
  });

export const startupStep = <A, E, R>(
  step: Pick<StartupStep, "id" | "label"> & Partial<Omit<StartupStep, "state">>,
  work: Effect.Effect<A, E, R>,
  onSuccess?: (value: A) => Partial<Omit<StartupStep, "id" | "label" | "state">>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const progress = yield* CurrentStartupProgress;
    if (!progress) return yield* work;
    progress.step({ ...step, state: "running" });
    return yield* work.pipe(
      Effect.tap((value) =>
        Effect.sync(() =>
          progress.step({
            id: step.id,
            label: step.label,
            state: "completed",
            ...onSuccess?.(value),
          }),
        ),
      ),
      Effect.tapError((failure) =>
        Effect.sync(() =>
          progress.step({
            id: step.id,
            label: step.label,
            state: "failed",
            failure: startupFailure(step.id, errorMessage(failure)),
          }),
        ),
      ),
    );
  });

export const startupFailure = (stage: string, message: string) => ({
  stage,
  code: "startup_failed",
  message,
  nextAction: "Inspect the failed step and the saved session before retrying.",
});

export const stopStartupSession = <Failure>(
  ref: AgentSessionLiveRef,
  stop: Effect.Effect<void, Failure>,
) =>
  Effect.gen(function* () {
    const progress = yield* CurrentStartupProgress;
    if (!progress) return yield* stop;
    progress.phase("settling");
    yield* startupStep(
      {
        id: "stop-session",
        label: "Stop native session",
        details: [ref.externalSessionId, ref.workingDirectory],
      },
      stop.pipe(Effect.andThen(progress.confirmStopped(ref))),
    ).pipe(
      Effect.tapError(() =>
        updateStartup((current) =>
          current.step({
            id: "stop-session",
            label: "Stop native session",
            state: "failed",
            resources: [
              {
                kind: "worktree",
                value: ref.workingDirectory,
                state: "retained",
                nextAction: `Stop native session ${ref.externalSessionId} before removing its checkout.`,
              },
            ],
          }),
        ),
      ),
    );
  });

const failures = new WeakMap<object, StartupOperationSnapshot>();

export const rememberStartupFailure = <Failure>(
  failure: Failure,
  progress: StartupOperationSnapshot,
): void => {
  if (failure instanceof Object) failures.set(failure, progress);
};

export const startupFailureProgress = <Failure>(
  failure: Failure,
): StartupOperationSnapshot | undefined =>
  failure instanceof Object ? failures.get(failure) : undefined;
