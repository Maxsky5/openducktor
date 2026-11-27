import type {
  BackgroundOperationSnapshot,
  BackgroundOperationTarget,
  WorkspaceRef,
  WorkspaceTextFileReadResult,
} from "@openducktor/contracts";
import { type BackgroundOperationInvocation, HostInvokeError } from "@openducktor/host-client";
import { HostChannelRequestError, isHostInvocationRefused } from "@openducktor/host-client/channel";
import type { HostConnection } from "../connection/host-connection";
import { errorMessage } from "../lib/errors";

export type ArchiveFileDraft = {
  fileId: string;
  contents: string;
  baseline: Extract<WorkspaceTextFileReadResult, { kind: "text" }>;
  branch: string | null;
};

type Origin = {
  workspace: WorkspaceRef;
  target: BackgroundOperationTarget;
  action: string;
  workspaceLabel?: string;
  targetLabel?: string;
  archiveDraft?: ArchiveFileDraft;
};

type Phase = "running" | "succeeded" | "failed" | "unconfirmed";

export type BackgroundAttempt = Origin & {
  id: string;
  phase: Phase;
  progress?: BackgroundOperationSnapshot;
  message?: string;
  failureDismissed?: boolean;
  toastDismissed?: boolean;
};

export type BackgroundOperationStore = ReturnType<typeof createBackgroundOperationStore>;

const SUCCESS_DURATION = 10_000;
const targetKey = ({ workspace, target }: Pick<Origin, "workspace" | "target">) =>
  JSON.stringify([
    workspace.workspaceId,
    target.kind,
    target.kind === "task" ? target.taskId : target.sessionId,
  ]);

export const backgroundAttemptOrigin = ({
  workspace,
  workspaceLabel,
  target,
  targetLabel,
}: BackgroundAttempt) =>
  `${workspaceLabel ?? workspace.workspaceId} · ${targetLabel ?? (target.kind === "task" ? target.taskId : target.sessionId)}`;

export const BACKGROUND_UNKNOWN_MESSAGE =
  "The app could not confirm the result. Check the original target before trying again.";

export const createBackgroundOperationStore = (
  host: HostConnection,
  onSettled?: (attempt: BackgroundAttempt) => void,
) => {
  type Entry = {
    attempt: BackgroundAttempt;
    hostInstanceId?: string;
    onSettled?: (attempt: BackgroundAttempt) => void;
  };
  const entries = new Map<string, Entry>();
  const archiveDrafts = new Map<string, ArchiveFileDraft>();
  const draftKey = (workspaceId: string, sessionId: string, fileId: string) =>
    JSON.stringify([workspaceId, sessionId, fileId]);
  const running = new Map<string, string>();
  const listeners = new Set<() => void>();
  const expiry = new Map<string, ReturnType<typeof setTimeout>>();
  let snapshot: readonly BackgroundAttempt[] = [];
  let disposed = false;
  let subscription: Promise<() => void> | undefined;
  let stop: (() => void) | undefined;
  const publish = () => {
    snapshot = Array.from(entries.values(), (entry) => entry.attempt);
    for (const listener of listeners) listener();
  };
  const remove = (id: string) => {
    entries.delete(id);
    expiry.delete(id);
    publish();
  };
  const settle = (entry: Entry, phase: Exclude<Phase, "running">, message?: string) => {
    if (disposed || entry.attempt.phase === "failed" || entry.attempt.phase === "succeeded") return;
    const { id } = entry.attempt;
    const key = targetKey(entry.attempt);
    if (running.get(key) === id) running.delete(key);
    const { message: _previousMessage, ...attempt } = entry.attempt;
    entry.attempt = {
      ...attempt,
      phase,
      toastDismissed: false,
    };
    if (message !== undefined) entry.attempt.message = message;
    const { archiveDraft, workspace, target } = attempt;
    if (phase === "succeeded") {
      if (archiveDraft && target.kind === "chat") {
        const key = draftKey(workspace.workspaceId, target.sessionId, archiveDraft.fileId);
        const retained = archiveDrafts.get(key);
        if (!retained || retained === archiveDraft) {
          archiveDrafts.delete(key);
          delete entry.attempt.archiveDraft;
        } else {
          entry.attempt.archiveDraft = retained;
        }
      }
      if (!entry.attempt.archiveDraft)
        expiry.set(
          id,
          setTimeout(() => remove(id), SUCCESS_DURATION),
        );
    }
    publish();
    onSettled?.(entry.attempt);
    entry.onSettled?.(entry.attempt);
  };
  const accept = (progress: BackgroundOperationSnapshot) => {
    const entry = entries.get(progress.operationId);
    if (!entry) return;
    const phase = entry.attempt.phase;
    const confirmed = phase === "failed" || phase === "succeeded";
    if (confirmed && progress.phase !== phase) return;
    if (entry.hostInstanceId !== undefined && progress.hostInstanceId !== entry.hostInstanceId)
      return;
    if (
      progress.workspace.repoPath !== entry.attempt.workspace.repoPath ||
      targetKey({ ...entry.attempt, workspace: progress.workspace, target: progress.target }) !==
        targetKey(entry.attempt) ||
      progress.revision <= (entry.attempt.progress?.revision ?? -1)
    )
      return;
    entry.hostInstanceId = progress.hostInstanceId;
    entry.attempt = { ...entry.attempt, progress };
    if (confirmed || progress.phase === "running") publish();
    else
      settle(
        entry,
        progress.phase,
        progress.phase === "failed" ? progress.failure.message : undefined,
      );
  };
  const subscribeBeforeDispatch = () => {
    subscription ??= host
      .subscribeBackgroundOperationProgress((event) => {
        if ("channel" in event) accept(event.payload);
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
        return unsubscribe;
      })
      .catch((cause: unknown) => {
        subscription = undefined;
        throw cause;
      });
    return subscription;
  };
  return {
    getArchiveDraft: (workspaceId: string, sessionId: string, fileId: string) =>
      archiveDrafts.get(draftKey(workspaceId, sessionId, fileId)),
    replaceArchiveDraft(
      workspaceId: string,
      sessionId: string,
      previous: ArchiveFileDraft,
      next?: ArchiveFileDraft,
    ) {
      const key = draftKey(workspaceId, sessionId, previous.fileId);
      if (archiveDrafts.get(key) !== previous) return;
      if (next) archiveDrafts.set(key, next);
      else archiveDrafts.delete(key);
    },
    isRunning: (workspace: WorkspaceRef, target: BackgroundOperationTarget) =>
      running.has(targetKey({ workspace, target })),
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run<T>(
      origin: Origin,
      invoke: (tracking: BackgroundOperationInvocation) => Promise<T>,
      onSettled?: Entry["onSettled"],
    ): Promise<T> {
      if (disposed) throw new Error("The connection has closed.");
      const key = targetKey(origin);
      if (running.has(key)) throw new Error("An operation is running for this target.");
      const id = crypto.randomUUID();
      const expectedHostEpoch = host.backgroundOperationHostEpoch?.();
      const entry: Entry = {
        attempt: { ...origin, id, phase: "running" },
        ...(expectedHostEpoch && { hostInstanceId: expectedHostEpoch }),
        ...(onSettled && { onSettled }),
      };
      if (origin.archiveDraft && origin.target.kind === "chat")
        archiveDrafts.set(
          draftKey(
            origin.workspace.workspaceId,
            origin.target.sessionId,
            origin.archiveDraft.fileId,
          ),
          origin.archiveDraft,
        );
      entries.set(id, entry);
      running.set(key, id);
      publish();

      let dispatched = false;
      try {
        await subscribeBeforeDispatch();
        if (disposed) throw new Error("The connection has closed.");
        const hostEpoch = entry.hostInstanceId ?? host.backgroundOperationHostEpoch?.();
        if (hostEpoch !== undefined) entry.hostInstanceId = hostEpoch;
        dispatched = true;
        const result = await invoke({
          operationId: id,
          ...(hostEpoch && { expectedHostEpoch: hostEpoch }),
        });
        settle(entry, "succeeded");
        return result;
      } catch (cause) {
        if (cause instanceof HostInvokeError && cause.operationProgress)
          accept(cause.operationProgress);
        const replied =
          cause instanceof HostInvokeError &&
          cause.cause instanceof HostChannelRequestError &&
          cause.cause.error.kind === "host";
        if (!dispatched || replied || isHostInvocationRefused(cause))
          settle(entry, "failed", errorMessage(cause));
        else settle(entry, "unconfirmed", BACKGROUND_UNKNOWN_MESSAGE);
        throw cause;
      }
    },
    dismissToast(id: string) {
      const entry = entries.get(id);
      if (!entry || entry.attempt.phase === "running") return;
      if (
        entry.attempt.phase === "succeeded" ||
        (entry.attempt.phase === "failed" && entry.attempt.failureDismissed)
      ) {
        clearTimeout(expiry.get(id));
        remove(id);
      } else {
        entry.attempt = { ...entry.attempt, toastDismissed: true };
        publish();
      }
    },
    dismissFailure(id: string) {
      const entry = entries.get(id);
      if (!entry || entry.attempt.phase !== "failed") return;
      if (entry.attempt.toastDismissed) remove(id);
      else {
        entry.attempt = { ...entry.attempt, failureDismissed: true };
        publish();
      }
    },
    dispose() {
      disposed = true;
      stop?.();
      for (const timer of expiry.values()) clearTimeout(timer);
      expiry.clear();
      entries.clear();
      archiveDrafts.clear();
      running.clear();
      publish();
      listeners.clear();
    },
  };
};
