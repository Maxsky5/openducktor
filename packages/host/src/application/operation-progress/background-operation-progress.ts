import type { SerialGate } from "../../effect/serial-gate";
import type {
  BackgroundOperationSnapshot,
  BackgroundOperationStep,
  FailedBackgroundOperation,
  WorkflowFailure,
} from "@openducktor/contracts";
import { Context, Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import { createProgressSnapshot } from "./progress-snapshot";

type Step = Pick<BackgroundOperationStep, "id" | "label">;
type StepEvidence = Pick<BackgroundOperationStep, "details" | "resources">;
type Progress = ReturnType<typeof createBackgroundOperationProgress>;

export const CurrentBackgroundOperation = Context.Reference<Progress | undefined>(
  "@openducktor/host/CurrentBackgroundOperation",
  { defaultValue: () => undefined },
);

export const operationFailure = (stage: string, cause: unknown): WorkflowFailure => ({
  stage,
  code: "background_operation_failed",
  message: errorMessage(cause),
  nextAction: "Review the failed step and check the original target before trying again.",
});

export const createBackgroundOperationProgress = (
  identity: Pick<
    BackgroundOperationSnapshot,
    "operationId" | "hostInstanceId" | "workspace" | "target"
  >,
  publish: (snapshot: BackgroundOperationSnapshot) => void,
) => {
  const progress = createProgressSnapshot<BackgroundOperationSnapshot>(
    { ...identity, revision: 0, steps: [], phase: "running" },
    publish,
  );
  const update = (step: Step & Partial<BackgroundOperationStep>) => {
    const snapshot = progress.current();
    const previous = snapshot.steps.find((item) => item.id === step.id);
    const request = snapshot.steps.find((item) => item.id === "request");
    const steps =
      step.id !== "request" && step.id !== "waiting" && request?.state === "running"
        ? snapshot.steps.map((item) =>
            item === request ? { ...item, state: "completed" as const } : item,
          )
        : snapshot.steps;
    const next: BackgroundOperationStep = {
      state: "pending",
      details: [],
      ...previous,
      ...step,
    };
    const ordered = steps.filter((item) => item.id !== step.id);
    const firstPending = ordered.findIndex((item) => item.state === "pending");
    if ((!previous || previous.state === "pending") && firstPending >= 0) {
      ordered.splice(firstPending, 0, next);
    } else if (previous) {
      ordered.splice(
        steps.findIndex((item) => item.id === step.id),
        0,
        next,
      );
    } else {
      ordered.push(next);
    }
    progress.commit({ ...snapshot, steps: ordered });
  };
  return {
    update,
    addResource(id: string, resource: NonNullable<BackgroundOperationStep["resources"]>[number]) {
      const step = progress.current().steps.find((item) => item.id === id);
      if (
        !step ||
        step.resources?.some((item) => item.kind === resource.kind && item.value === resource.value)
      )
        return;
      update({ ...step, resources: [...(step.resources ?? []), resource] });
    },
    plan(steps: readonly Step[], after?: string) {
      const snapshot = progress.current();
      const added = steps.filter((step) => !snapshot.steps.some((item) => item.id === step.id));
      if (added.length === 0) return;
      const ordered = [...snapshot.steps];
      const anchor = after === undefined ? -1 : ordered.findIndex((step) => step.id === after);
      ordered.splice(
        anchor >= 0 ? anchor + 1 : ordered.length,
        0,
        ...added.map((step) => ({
          ...step,
          state: "pending" as const,
          details: [],
        })),
      );
      progress.commit({ ...snapshot, steps: ordered });
    },
    settle(failure?: WorkflowFailure) {
      const snapshot = progress.current();
      const steps = snapshot.steps.map((step): BackgroundOperationStep => {
        if (step.state === "running" || step.state === "waiting") {
          return failure ? { ...step, state: "failed", failure } : { ...step, state: "completed" };
        }
        return step.state === "pending" ? { ...step, state: "not_run" } : step;
      });
      progress.commit(
        failure
          ? { ...snapshot, steps, phase: "failed", failure }
          : { ...snapshot, steps, phase: "succeeded" },
      );
      return progress.read();
    },
  };
};

export const updateBackgroundOperation = (update: (progress: Progress) => void) =>
  Effect.gen(function* () {
    const progress = yield* CurrentBackgroundOperation;
    if (progress) update(progress);
  });

export const planBackgroundSteps = (...steps: Step[]) =>
  updateBackgroundOperation((progress) => progress.plan(steps));

export const backgroundStep = <A, E, R>(
  step: Step,
  work: Effect.Effect<A, E, R>,
  evidence?: (value: A) => Partial<StepEvidence>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const progress = yield* CurrentBackgroundOperation;
    if (!progress) return yield* work;
    progress.update({ ...step, state: "running" });
    return yield* work.pipe(
      Effect.tap((value) =>
        Effect.sync(() => progress.update({ ...step, state: "completed", ...evidence?.(value) })),
      ),
      Effect.tapError((cause) =>
        Effect.sync(() =>
          progress.update({ ...step, state: "failed", failure: operationFailure(step.id, cause) }),
        ),
      ),
    );
  });

export const backgroundGate = <A, E, R>(
  gate: SerialGate,
  key: string,
  work: Effect.Effect<A, E, R>,
  label: string,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const operation = yield* CurrentBackgroundOperation;
    if (!operation || !gate.isActive(key)) return yield* gate.run(key, work);
    const step = { id: "waiting", label };
    operation.update({ ...step, state: "waiting" });
    return yield* gate.run(
      key,
      Effect.sync(() =>
        operation.update({
          ...step,
          state: "completed",
        }),
      ).pipe(Effect.andThen(work)),
    );
  });

const failures = new WeakMap<object, FailedBackgroundOperation>();

export const rememberBackgroundOperationFailure = (
  cause: unknown,
  snapshot: BackgroundOperationSnapshot,
): void => {
  if (cause instanceof Object && snapshot.phase === "failed") failures.set(cause, snapshot);
};

export const backgroundOperationFailureProgress = (cause: unknown) =>
  cause instanceof Object ? failures.get(cause) : undefined;
