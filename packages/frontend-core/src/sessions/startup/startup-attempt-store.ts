import type {
  StartupOperationContext,
  StartupOperationSnapshot,
  StartupOwnership,
  StartupPreparedHandoff,
  StartupScope,
  StartupInstruction,
} from "@openducktor/contracts";
import type { HostConnection } from "../../connection/host-connection";
import { HostInvokeError } from "@openducktor/host-client";
import type { SessionNavigationTarget } from "../navigation/session-navigation-target";
import {
  canOpenStartupSession,
  startupIsPending,
  startupNavigationTarget,
} from "./startup-navigation";

export type StartupAttemptStatus = {
  phase: "submitting" | "waiting" | "running" | "settling" | "ready" | "failed" | "canceled";
  confirmation: "current" | "unconfirmed";
  successExpiresAt?: number;
};

export type StartupRecoveryAction = {
  kind: "retry_message" | "repair" | "retry";
  label: string;
  run: () => void | Promise<void>;
};

export type StartupPresentation = "dialog" | "inline" | "notification";

export type StartupAttempt = {
  id: string;
  origin: { workspaceId: string; repoPath: string; scope: StartupScope };
  label: string;
  status: StartupAttemptStatus;
  operations: readonly StartupOperationSnapshot[];
  ownership: StartupOwnership;
  instructionRequired: boolean;
  instruction?: StartupInstruction;
  prepared?: StartupPreparedHandoff;
  presentation: StartupPresentation;
  navigationTarget?: SessionNavigationTarget;
  recoveryActions?: readonly StartupRecoveryAction[];
  error?: string;
};

type AttemptEntry = {
  attempt: StartupAttempt;
  operationIds: string[];
  finalOperationId: string | null;
  completedOperationId: string | null;
  adoption: Promise<boolean> | null;
  warning: string | undefined;
  savedOperationIndex: number;
};

export type StartupAttemptStore = ReturnType<typeof createStartupAttemptStore>;

/** Transient starts belong to the connection that admitted them, never to a view or Query. */
export const createStartupAttemptStore = (
  host: HostConnection,
  preparation: {
    adopt: (snapshot: StartupOperationSnapshot) => Promise<void>;
    isCurrent: (id: string, handoff: StartupPreparedHandoff) => boolean;
    release: (id: string) => void;
  },
) => {
  const entries = new Map<string, AttemptEntry>();
  const listeners = new Set<() => void>();
  let snapshot: readonly StartupAttempt[] = [];
  let disposed = false;
  let subscription: Promise<() => void> | null = null;
  let unsubscribe: (() => void) | null = null;
  const publish = () => {
    snapshot = [...entries.values()].map((entry) => entry.attempt);
    for (const listener of listeners) listener();
  };
  const update = (id: string, change: (current: StartupAttempt) => StartupAttempt) => {
    const entry = entries.get(id);
    if (!entry || disposed) return;
    entry.attempt = change(entry.attempt);
    publish();
  };
  const release = (id: string) => {
    if (entries.delete(id)) {
      preparation.release(id);
      publish();
    }
  };
  const accept = (progress: StartupOperationSnapshot) => {
    const entry = entries.get(progress.context.startupAttemptId);
    if (!entry || disposed || !entry.operationIds.includes(progress.context.operationId)) return;
    if (
      progress.workspaceId !== entry.attempt.origin.workspaceId ||
      progress.repoPath !== entry.attempt.origin.repoPath
    )
      return;
    const old = entry.attempt.operations.find(
      (operation) => operation.context.operationId === progress.context.operationId,
    );
    if (
      old &&
      (old.hostInstanceId !== progress.hostInstanceId || old.revision >= progress.revision)
    )
      return;
    const operations = entry.operationIds.flatMap((operationId) => {
      const operation =
        operationId === progress.context.operationId
          ? progress
          : entry.attempt.operations.find((item) => item.context.operationId === operationId);
      return operation ? [operation] : [];
    });
    const operationIndex = entry.operationIds.indexOf(progress.context.operationId);
    const newerSaved =
      progress.ownership.state === "saved" && operationIndex >= entry.savedOperationIndex;
    const ownership =
      entry.attempt.ownership.state === "saved" && !newerSaved
        ? entry.attempt.ownership
        : progress.ownership;
    if (newerSaved) entry.savedOperationIndex = operationIndex;
    const final = progress.context.operationId === entry.finalOperationId;
    const latestOperation = progress.context.operationId === entry.operationIds.at(-1);
    let phase: StartupAttemptStatus["phase"] = entry.attempt.status.phase;
    if (latestOperation && progress.phase !== "completed") phase = progress.phase;
    else if (latestOperation && phase === "submitting" && progress.phase === "completed")
      phase = "running";
    const failure = progress.steps.find((step) => step.state === "failed")?.failure;
    const navigationTarget = startupNavigationTarget(entry.attempt, ownership);
    const instruction =
      entry.attempt.instruction && ["accepted", "queued"].includes(entry.attempt.instruction.state)
        ? entry.attempt.instruction
        : (progress.instruction ?? entry.attempt.instruction);
    update(entry.attempt.id, (attempt) => ({
      ...attempt,
      operations,
      ownership,
      status: {
        ...attempt.status,
        phase,
        confirmation: final ? "current" : attempt.status.confirmation,
      },
      ...(latestOperation && progress.prepared && { prepared: progress.prepared }),
      ...(navigationTarget && { navigationTarget }),
      ...(instruction && { instruction }),
      ...(latestOperation && failure && { error: `${failure.message} ${failure.nextAction}` }),
    }));
    if (final && ownership.state === "saved" && progress.prepared) {
      entry.adoption ??= preparation.adopt(progress).then(
        () => true,
        (cause: unknown) => {
          if (
            entries.get(entry.attempt.id) === entry &&
            entry.finalOperationId === progress.context.operationId
          )
            update(entry.attempt.id, (attempt) => ({
              ...attempt,
              error: cause instanceof Error ? cause.message : String(cause),
              status: { ...attempt.status, confirmation: "unconfirmed" },
            }));
          return false;
        },
      );
      void entry.adoption.then((adopted) => {
        if (!adopted) return;
        const current = entries.get(entry.attempt.id);
        const latest = current?.attempt.operations.find(
          (operation) => operation.context.operationId === progress.context.operationId,
        );
        if (
          current !== entry ||
          current.finalOperationId !== progress.context.operationId ||
          latest?.revision !== progress.revision
        )
          return;
        if (!progress.prepared || !preparation.isCurrent(current.attempt.id, progress.prepared)) {
          update(current.attempt.id, (attempt) => ({
            ...attempt,
            status: { ...attempt.status, confirmation: "unconfirmed" },
            error: "Session preparation is no longer confirmed. Inspect the saved session.",
          }));
          return;
        }
        if (
          progress.phase === "completed" &&
          (!current.attempt.instructionRequired ||
            (current.attempt.instruction &&
              ["accepted", "queued"].includes(current.attempt.instruction.state)))
        )
          update(current.attempt.id, (attempt) => readyAttempt(attempt, current.warning));
      });
    }
  };
  const ensureSubscribed = (): Promise<void> => {
    if (disposed) return Promise.reject(new Error("The startup connection has been released."));
    subscription ??= host
      .subscribeStartupProgress((event) => {
        if ("__openducktorConnectionControl" in event) {
          if (event.kind !== "reconnected") return;
          if (event.hostChanged) {
            for (const id of entries.keys()) preparation.release(id);
            entries.clear();
            publish();
          } else if (event.missedEventNames.includes("startup")) {
            for (const entry of entries.values()) {
              if (["ready", "failed", "canceled"].includes(entry.attempt.status.phase)) continue;
              entry.attempt = {
                ...entry.attempt,
                status: { ...entry.attempt.status, confirmation: "unconfirmed" },
              };
            }
            publish();
          }
          return;
        }
        accept(event.payload);
      })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
        return stop;
      })
      .catch((cause: unknown) => {
        subscription = null;
        throw cause;
      });
    return subscription.then(() => undefined);
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getAttempt: (id: string) => entries.get(id)?.attempt ?? null,
    isReadyForHandoff(id: string): boolean {
      const entry = entries.get(id);
      return (
        entry !== undefined &&
        entry.completedOperationId !== null &&
        entry.completedOperationId === entry.finalOperationId &&
        entry.attempt.status.phase === "ready" &&
        entry.attempt.status.confirmation === "current" &&
        entry.attempt.prepared !== undefined &&
        preparation.isCurrent(id, entry.attempt.prepared)
      );
    },
    begin(input: {
      id?: string;
      origin: StartupAttempt["origin"];
      label: string;
      presentation: StartupPresentation;
      instructionRequired?: boolean;
    }): string {
      if (disposed) throw new Error("The startup connection has been released.");
      const id = input.id ?? crypto.randomUUID();
      if (entries.has(id)) throw new Error("This session start is already registered.");
      entries.set(id, {
        attempt: {
          id,
          origin: input.origin,
          label: input.label,
          presentation: input.presentation,
          status: { phase: "submitting", confirmation: "current" },
          operations: [],
          ownership: { state: "unknown" },
          instructionRequired: input.instructionRequired ?? false,
        },
        operationIds: [],
        finalOperationId: null,
        completedOperationId: null,
        adoption: null,
        warning: undefined,
        savedOperationIndex: -1,
      });
      publish();
      return id;
    },
    async operation<T extends { startupProgress?: StartupOperationSnapshot | undefined }>(
      id: string,
      perform: (context: StartupOperationContext) => Promise<T>,
      {
        final = true,
        beforeDispatch,
      }: { final?: boolean; beforeDispatch?: () => Promise<void> } = {},
    ): Promise<T> {
      const entry = entries.get(id);
      if (!entry || disposed) throw new Error("The session start is no longer available.");
      const context = { startupAttemptId: id, operationId: crypto.randomUUID() };
      entry.completedOperationId = null;
      entry.adoption = null;
      entry.warning = undefined;
      entry.operationIds.push(context.operationId);
      if (final) entry.finalOperationId = context.operationId;
      update(id, (attempt) => {
        const { error: _error, recoveryActions: _actions, ...rest } = attempt;
        return {
          ...rest,
          status: { ...attempt.status, phase: "submitting", confirmation: "current" },
        };
      });
      let dispatched = false;
      try {
        await ensureSubscribed();
        if (entries.get(id) !== entry || disposed)
          throw new Error("The session start connection changed.");
        if (beforeDispatch) {
          await beforeDispatch();
          if (entries.get(id) !== entry || disposed)
            throw new Error("The session start connection changed.");
        }
        dispatched = true;
        const result = await perform(context);
        if (result.startupProgress) accept(result.startupProgress);
        return result;
      } catch (cause) {
        if (entries.get(id) !== entry || disposed) throw cause;
        const progress =
          cause instanceof HostInvokeError ? cause.failure?.startupProgress : undefined;
        if (progress) accept(progress);
        update(id, (attempt) =>
          !progress &&
          attempt.status.confirmation === "current" &&
          ["ready", "failed", "canceled"].includes(attempt.status.phase)
            ? attempt
            : {
                ...attempt,
                ...(!dispatched &&
                  attempt.ownership.state !== "saved" && {
                    ownership: { state: "not_saved" as const },
                  }),
                error: cause instanceof Error ? cause.message : String(cause),
                status: {
                  ...attempt.status,
                  phase: progress?.phase === "canceled" ? "canceled" : "failed",
                  confirmation: progress || !dispatched ? "current" : "unconfirmed",
                },
              },
        );
        throw cause;
      }
    },
    accept,
    setSaved(id: string, ownership: Extract<StartupOwnership, { state: "saved" }>) {
      const entry = entries.get(id);
      if (entry) entry.savedOperationIndex = entry.operationIds.length - 1;
      update(id, (attempt) => {
        const navigationTarget = startupNavigationTarget(attempt, ownership);
        return { ...attempt, ownership, ...(navigationTarget && { navigationTarget }) };
      });
    },
    async complete(id: string): Promise<void> {
      const entry = entries.get(id);
      if (!entry) return;
      const operationId = entry.finalOperationId;
      const adopted = entry.adoption ? await entry.adoption : true;
      if (entries.get(id) !== entry || entry.finalOperationId !== operationId || !adopted) return;
      update(id, (attempt) => {
        if (
          attempt.ownership.state !== "saved" ||
          !attempt.prepared ||
          !preparation.isCurrent(id, attempt.prepared)
        ) {
          const { recoveryActions: _actions, ...retained } = attempt;
          let message = "Session preparation is no longer confirmed.";
          if (attempt.instruction?.state === "accepted")
            message = "The message was accepted, but session preparation is no longer confirmed.";
          else if (attempt.instruction?.state === "queued")
            message = "The instruction was queued, but session preparation is no longer confirmed.";
          return {
            ...retained,
            status: { ...attempt.status, phase: "running", confirmation: "unconfirmed" },
            error: [
              `${message} Inspect the saved session before starting or sending again.`,
              entry.warning,
            ]
              .filter(Boolean)
              .join(" "),
          };
        }
        if (
          attempt.instructionRequired &&
          (!attempt.instruction || !["accepted", "queued"].includes(attempt.instruction.state))
        )
          return attempt;
        entry.completedOperationId = entry.finalOperationId;
        return readyAttempt(attempt, entry.warning);
      });
    },
    setInstruction(id: string, instruction: StartupInstruction) {
      update(id, (attempt) => ({ ...attempt, instruction }));
    },
    setNavigationTarget(id: string, navigationTarget: SessionNavigationTarget) {
      update(id, (attempt) => ({ ...attempt, navigationTarget }));
    },
    fail(id: string, message: string, confirmed = true) {
      update(id, (attempt) => ({
        ...attempt,
        error: message,
        status: {
          ...attempt.status,
          phase: "failed",
          confirmation: confirmed ? "current" : "unconfirmed",
        },
      }));
    },
    setWarning(id: string, error: string) {
      const entry = entries.get(id);
      if (entry) entry.warning = error;
      update(id, (attempt) => ({ ...attempt, error }));
    },
    rejectBeforeDispatch(id: string, message: string) {
      update(id, (attempt) => ({
        ...attempt,
        ownership: attempt.ownership.state === "saved" ? attempt.ownership : { state: "not_saved" },
        error: message,
        status: { ...attempt.status, phase: "failed", confirmation: "current" },
      }));
    },
    setRecoveryActions(id: string, recoveryActions: readonly StartupRecoveryAction[]) {
      update(id, (attempt) => ({ ...attempt, recoveryActions }));
    },
    setPresentation(id: string, presentation: StartupPresentation) {
      update(id, (attempt) => ({ ...attempt, presentation }));
    },
    continueInBackground(id: string) {
      update(id, (attempt) =>
        attempt.origin.scope.kind === "task"
          ? { ...attempt, presentation: "notification" }
          : attempt,
      );
    },
    dismiss(id: string) {
      const attempt = entries.get(id)?.attempt;
      if (attempt && !startupIsPending(attempt)) release(id);
    },
    handoff(id: string): boolean {
      const attempt = entries.get(id)?.attempt;
      if (!canOpenStartupSession(attempt)) return false;
      if (attempt.status.phase === "ready") release(id);
      else update(id, (current) => ({ ...current, presentation: "notification" }));
      return true;
    },
    release,
    expireSuccess(now = Date.now()) {
      for (const attempt of snapshot)
        if (
          attempt.presentation === "notification" &&
          attempt.status.phase === "ready" &&
          attempt.status.successExpiresAt !== undefined &&
          attempt.status.successExpiresAt <= now
        )
          release(attempt.id);
    },
    dispose() {
      disposed = true;
      unsubscribe?.();
      for (const id of entries.keys()) preparation.release(id);
      entries.clear();
      publish();
      listeners.clear();
    },
  };
};

const readyAttempt = (attempt: StartupAttempt, warning?: string): StartupAttempt => {
  const { error: _error, recoveryActions: _actions, ...rest } = attempt;
  return {
    ...rest,
    ...(warning && { error: warning }),
    status: {
      phase: "ready",
      confirmation: "current",
      successExpiresAt: attempt.status.successExpiresAt ?? Date.now() + 10_000,
    },
  };
};
