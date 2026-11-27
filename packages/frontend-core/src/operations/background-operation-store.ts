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

export type BackgroundAttempt = Omit<Origin, "archiveDraft"> & {
  id: string;
  phase: Phase;
  progress?: BackgroundOperationSnapshot;
  message?: string;
  failureDismissed?: boolean;
  toastDismissed?: boolean;
  archiveDraftFileIds?: readonly string[];
};

export type BackgroundOperationStore = ReturnType<typeof createBackgroundOperationStore>;

type OperationHandlers = {
  onSettled?: (attempt: BackgroundAttempt) => void;
  /** Runs for validated snapshots, including terminal evidence after a reply. */
  onProgress?: (progress: BackgroundOperationSnapshot) => void;
};

type WorkspaceIdentity = Pick<WorkspaceRef, "workspaceId">;

const SUCCESS_DURATION = 10_000;
const targetKey = ({
  workspace,
  target,
}: {
  workspace: WorkspaceIdentity;
  target: BackgroundOperationTarget;
}): string =>
  JSON.stringify([
    workspace.workspaceId,
    target.kind,
    target.kind === "task" ? target.taskId : target.sessionId,
  ]);

const matchesChat = (
  { workspace, target }: BackgroundAttempt,
  workspaceId: string,
  sessionId: string,
): boolean =>
  target.kind === "chat" && target.sessionId === sessionId && workspace.workspaceId === workspaceId;

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
  type Entry = OperationHandlers & {
    attempt: BackgroundAttempt;
    consentedArchiveDraft?: ArchiveFileDraft;
    hostInstanceId?: string;
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
  const expireSuccess = ({ id, phase, archiveDraftFileIds, toastDismissed }: BackgroundAttempt) => {
    if (
      phase === "succeeded" &&
      (toastDismissed || !archiveDraftFileIds?.length) &&
      !expiry.has(id)
    )
      expiry.set(
        id,
        setTimeout(() => remove(id), SUCCESS_DURATION),
      );
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
    const { archiveDraftFileIds, workspace, target } = attempt;
    if (target.kind === "chat" && archiveDraftFileIds) {
      const consented = entry.consentedArchiveDraft;
      if (phase === "succeeded" && consented) {
        const key = draftKey(workspace.workspaceId, target.sessionId, consented.fileId);
        if (archiveDrafts.get(key) === consented) archiveDrafts.delete(key);
      }
      const retained = archiveDraftFileIds.filter((fileId) =>
        archiveDrafts.has(draftKey(workspace.workspaceId, target.sessionId, fileId)),
      );
      if (retained.length > 0) entry.attempt.archiveDraftFileIds = retained;
      else delete entry.attempt.archiveDraftFileIds;
    }
    const notifySettled = entry.onSettled;
    if (phase !== "unconfirmed") {
      delete entry.consentedArchiveDraft;
      delete entry.onSettled;
    }
    expireSuccess(entry.attempt);
    publish();
    onSettled?.(entry.attempt);
    notifySettled?.(entry.attempt);
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
      targetKey(progress) !== targetKey(entry.attempt) ||
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
    entry.onProgress?.(progress);
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
    /** An unfinished archive can retain a file even when it started with a clean editor. */
    replaceArchiveDraft(
      workspaceId: string,
      sessionId: string,
      previous: ArchiveFileDraft | null,
      next?: ArchiveFileDraft,
    ) {
      const fileId = previous?.fileId ?? next?.fileId;
      if (!fileId || disposed) return;
      const key = draftKey(workspaceId, sessionId, fileId);
      const retained = archiveDrafts.get(key);
      if (retained && retained !== previous) return;
      if (!next) {
        if (!archiveDrafts.delete(key)) return;
        for (const entry of entries.values()) {
          const { attempt } = entry;
          const { archiveDraftFileIds } = attempt;
          if (!archiveDraftFileIds || !matchesChat(attempt, workspaceId, sessionId)) continue;
          const remaining = archiveDraftFileIds.filter((id) => id !== fileId);
          if (remaining.length === archiveDraftFileIds.length) continue;
          entry.attempt = { ...attempt, archiveDraftFileIds: remaining };
          expireSuccess(entry.attempt);
        }
        publish();
        return;
      }
      let hasPendingArchive = false;
      let changed = false;
      for (const entry of entries.values()) {
        const { attempt } = entry;
        if (
          (attempt.phase !== "running" && attempt.phase !== "unconfirmed") ||
          !matchesChat(attempt, workspaceId, sessionId)
        )
          continue;
        hasPendingArchive = true;
        const fileIds = attempt.archiveDraftFileIds ?? [];
        if (fileIds.includes(fileId)) continue;
        entry.attempt = { ...attempt, archiveDraftFileIds: [...fileIds, fileId] };
        changed = true;
      }
      if (!retained && !hasPendingArchive) return;
      archiveDrafts.set(key, next);
      if (changed) publish();
    },
    isRunning: (workspace: WorkspaceIdentity, target: BackgroundOperationTarget) =>
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
      handlers?: OperationHandlers,
    ): Promise<T> {
      if (disposed) throw new Error("The connection has closed.");
      const key = targetKey(origin);
      if (running.has(key)) throw new Error("An operation is running for this target.");
      const id = crypto.randomUUID();
      const expectedHostEpoch = host.backgroundOperationHostEpoch?.();
      const { archiveDraft: consented, ...displayOrigin } = origin;
      const entry: Entry = {
        attempt: { ...displayOrigin, id, phase: "running" },
        ...(expectedHostEpoch && { hostInstanceId: expectedHostEpoch }),
        ...handlers,
      };
      if (consented && origin.target.kind === "chat") {
        entry.consentedArchiveDraft = consented;
        entry.attempt.archiveDraftFileIds = [consented.fileId];
        archiveDrafts.set(
          draftKey(origin.workspace.workspaceId, origin.target.sessionId, consented.fileId),
          consented,
        );
      }
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
      const awaitsFinalProgress =
        entry.onProgress !== undefined && entry.attempt.progress?.phase !== "succeeded";
      if (
        (entry.attempt.phase === "succeeded" && !awaitsFinalProgress) ||
        (entry.attempt.phase === "failed" && entry.attempt.failureDismissed)
      ) {
        clearTimeout(expiry.get(id));
        remove(id);
      } else {
        entry.attempt = { ...entry.attempt, toastDismissed: true };
        expireSuccess(entry.attempt);
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
