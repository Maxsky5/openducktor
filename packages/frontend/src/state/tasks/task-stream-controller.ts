import type { TaskEventCursor } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { TaskStreamFrame, TaskStreamSubscription } from "@/lib/shell-bridge";
import type { TaskViewSync } from "@/state/queries/task-view-sync";

type TaskStreamTransport = {
  subscribeTaskStream: (
    input: { cursor: TaskEventCursor | null },
    onFrame: (frame: TaskStreamFrame) => void,
    onTerminalFailure?: (error: unknown) => void,
  ) => Promise<TaskStreamSubscription>;
};

type TaskMetadataReconciler = Pick<
  HostClient,
  "reconcileExternalTaskSyncEvent" | "invalidateAllTaskMetadata"
>;

type OwnedSubscription = {
  subscription: TaskStreamSubscription | null;
  generation: number;
  pendingFrames: TaskStreamFrame[];
  unsubscribePromise: Promise<void> | null;
};

export type TaskStreamController = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

const cursorsEqual = (left: TaskEventCursor | null, right: TaskEventCursor | null): boolean =>
  left !== null && right !== null && left.epoch === right.epoch && left.sequence === right.sequence;

export const createTaskStreamController = ({
  transport,
  metadata,
  taskViewSync,
  getActiveRepoPath,
  onDegraded,
}: {
  transport: TaskStreamTransport;
  metadata: TaskMetadataReconciler;
  taskViewSync: TaskViewSync;
  getActiveRepoPath: () => string | null;
  onDegraded: (error: unknown) => void;
}): TaskStreamController => {
  let current: OwnedSubscription | null = null;
  let acquiring: OwnedSubscription | null = null;
  let startPromise: Promise<void> | null = null;
  let recoveryPromise: Promise<boolean> | null = null;
  let stopPromise: Promise<void> | null = null;
  let processedCursor: TaskEventCursor | null = null;
  let acknowledgedCursor: TaskEventCursor | null = null;
  let processing = false;
  let stopped = false;
  let paused = false;
  let degraded = false;
  let recoveryUsed = false;
  let subscriptionGeneration = 0;
  let operationGeneration = 0;
  let acknowledging: { cursor: TaskEventCursor; owner: OwnedSubscription } | null = null;
  let awaitingReplayCursor: TaskEventCursor | null = null;
  let pendingSnapshot: Extract<TaskStreamFrame, { type: "snapshot_required" }> | null = null;
  const pendingChanges = new Map<string, Extract<TaskStreamFrame, { type: "change" }>>();

  const compareCursor = (left: TaskEventCursor, right: TaskEventCursor): number => {
    if (left.epoch !== right.epoch) {
      throw new Error(
        `Task stream epoch changed from '${right.epoch}' to '${left.epoch}' without a snapshot.`,
      );
    }
    return left.sequence - right.sequence;
  };

  const frameKey = (cursor: TaskEventCursor): string => `${cursor.epoch}:${cursor.sequence}`;

  const reportDegraded = (error: unknown): void => {
    if (degraded) return;
    degraded = true;
    try {
      onDegraded(error);
    } catch {
      // Reporting must not leave a controller-owned promise rejected.
    }
  };

  const close = (owner: OwnedSubscription): Promise<void> => {
    if (owner.unsubscribePromise) return owner.unsubscribePromise;
    owner.unsubscribePromise = Promise.resolve()
      .then(async () => {
        if (owner.subscription) await owner.subscription.unsubscribe();
      })
      .catch((error: unknown) => {
        reportDegraded(error);
      });
    return owner.unsubscribePromise;
  };

  const isActive = (owner: OwnedSubscription, frameGeneration: number): boolean =>
    !stopped && current === owner && operationGeneration === frameGeneration;

  const isCurrentOwner = (owner: OwnedSubscription): boolean =>
    !stopped && current === owner && owner.generation === subscriptionGeneration;

  const closeCurrent = async (): Promise<void> => {
    const owner = current;
    current = null;
    if (owner) await close(owner);
  };

  const acknowledge = async (
    owner: OwnedSubscription,
    cursor: TaskEventCursor,
    frameGeneration: number,
  ): Promise<boolean> => {
    if (!owner.subscription) {
      throw new Error("Task stream frame arrived before subscription setup completed.");
    }
    acknowledging = { cursor, owner };
    try {
      await owner.subscription.acknowledge(cursor);
    } finally {
      if (acknowledging?.owner === owner && cursorsEqual(acknowledging.cursor, cursor)) {
        acknowledging = null;
      }
    }
    if (!isActive(owner, frameGeneration)) return false;
    acknowledgedCursor = cursor;
    return true;
  };

  const applyChange = async (
    owner: OwnedSubscription,
    frame: Extract<TaskStreamFrame, { type: "change" }>,
    frameGeneration: number,
  ): Promise<boolean> => {
    metadata.reconcileExternalTaskSyncEvent(frame.event);
    await taskViewSync.reconcileExternalEvent(frame.event, getActiveRepoPath());
    if (!isActive(owner, frameGeneration)) return false;
    processedCursor = frame.cursor;
    return acknowledge(owner, frame.cursor, frameGeneration);
  };

  const applySnapshot = async (
    owner: OwnedSubscription,
    frame: Extract<TaskStreamFrame, { type: "snapshot_required" }>,
    frameGeneration: number,
  ): Promise<boolean> => {
    metadata.invalidateAllTaskMetadata();
    await taskViewSync.reconcileStreamSnapshot(getActiveRepoPath());
    if (!isActive(owner, frameGeneration)) return false;
    processedCursor = frame.cursor;
    return acknowledge(owner, frame.cursor, frameGeneration);
  };

  const nextChange = (): Extract<TaskStreamFrame, { type: "change" }> | null => {
    if (!processedCursor) {
      return [...pendingChanges.values()].find((frame) => frame.cursor.sequence === 0) ?? null;
    }
    return (
      [...pendingChanges.values()].find(
        (frame) =>
          frame.cursor.epoch === processedCursor?.epoch &&
          frame.cursor.sequence === processedCursor.sequence + 1,
      ) ?? null
    );
  };

  const markRecovered = (): void => {
    degraded = false;
    recoveryUsed = false;
    paused = false;
    awaitingReplayCursor = null;
  };

  const receive = (owner: OwnedSubscription, frame: TaskStreamFrame): void => {
    if (stopped) return;
    if (acquiring === owner) {
      owner.pendingFrames.push(frame);
      return;
    }
    if (current !== owner) return;

    if (frame.type === "snapshot_required") {
      operationGeneration += 1;
      pendingChanges.clear();
      pendingSnapshot = frame;
      awaitingReplayCursor = null;
      paused = false;
      requestDrain();
      return;
    }

    if (pendingSnapshot) {
      if (
        frame.cursor.epoch !== pendingSnapshot.cursor.epoch ||
        frame.cursor.sequence <= pendingSnapshot.cursor.sequence
      ) {
        return;
      }
      pendingChanges.set(frameKey(frame.cursor), frame);
      requestDrain();
      return;
    }

    if (processedCursor) {
      try {
        const comparison = compareCursor(frame.cursor, processedCursor);
        if (
          comparison < 0 ||
          (comparison === 0 && cursorsEqual(frame.cursor, acknowledgedCursor))
        ) {
          return;
        }
        if (comparison === 0) {
          pendingChanges.set(frameKey(frame.cursor), frame);
          if (cursorsEqual(frame.cursor, awaitingReplayCursor)) awaitingReplayCursor = null;
          requestDrain();
          return;
        }
      } catch (error) {
        paused = true;
        reportDegraded(error);
        return;
      }
    }

    pendingChanges.set(frameKey(frame.cursor), frame);
    requestDrain();
  };

  const acquire = async (cursor: TaskEventCursor | null): Promise<void> => {
    const owner: OwnedSubscription = {
      subscription: null,
      generation: ++subscriptionGeneration,
      pendingFrames: [],
      unsubscribePromise: null,
    };
    acquiring = owner;
    try {
      owner.subscription = await Promise.resolve().then(() =>
        transport.subscribeTaskStream(
          { cursor },
          (frame) => receive(owner, frame),
          (error) => {
            if (!isCurrentOwner(owner)) return;
            void startRecovery(error, acknowledgedCursor, true).catch(reportDegraded);
          },
        ),
      );
    } catch (error) {
      if (acquiring === owner) acquiring = null;
      throw error;
    }

    if (acquiring === owner) acquiring = null;
    if (stopped) {
      await close(owner);
      return;
    }

    current = owner;
    for (const frame of owner.pendingFrames) receive(owner, frame);
    owner.pendingFrames = [];
  };

  const recover = async (
    error: unknown,
    cursor: TaskEventCursor | null,
    awaitReplay: boolean,
  ): Promise<boolean> => {
    if (stopped) return false;
    reportDegraded(error);
    if (recoveryUsed) {
      paused = true;
      await closeCurrent();
      return false;
    }

    recoveryUsed = true;
    paused = true;
    await closeCurrent();
    if (stopped) return false;

    if (awaitReplay) {
      awaitingReplayCursor = processedCursor;
    } else {
      awaitingReplayCursor = null;
      pendingChanges.clear();
      pendingSnapshot = null;
    }
    try {
      await acquire(cursor);
    } catch (acquisitionError) {
      paused = true;
      reportDegraded(acquisitionError);
      return false;
    }
    paused = false;
    return true;
  };

  const startRecovery = (
    error: unknown,
    cursor: TaskEventCursor | null,
    awaitReplay: boolean,
  ): Promise<boolean> => {
    if (!recoveryPromise) {
      recoveryPromise = recover(error, cursor, awaitReplay).finally(() => {
        recoveryPromise = null;
      });
    }
    return recoveryPromise;
  };

  const drain = async (): Promise<void> => {
    if (processing || stopped || paused || !current) return;
    processing = true;
    try {
      while (!stopped && !paused && current) {
        const owner = current;
        const frameGeneration = operationGeneration;
        const snapshot = pendingSnapshot;
        if (
          snapshot &&
          cursorsEqual(processedCursor, snapshot.cursor) &&
          !cursorsEqual(processedCursor, acknowledgedCursor)
        ) {
          if (cursorsEqual(processedCursor, awaitingReplayCursor)) return;
          try {
            const acknowledged = await acknowledge(owner, snapshot.cursor, frameGeneration);
            if (!acknowledged) continue;
            if (pendingSnapshot === snapshot) pendingSnapshot = null;
            markRecovered();
            continue;
          } catch (error) {
            if (isActive(owner, frameGeneration)) {
              if (!(await startRecovery(error, acknowledgedCursor, true))) return;
            }
            continue;
          }
        }
        if (snapshot) {
          try {
            const acknowledged = await applySnapshot(owner, snapshot, frameGeneration);
            if (!acknowledged) continue;
            if (pendingSnapshot === snapshot) pendingSnapshot = null;
            markRecovered();
            continue;
          } catch (error) {
            if (isActive(owner, frameGeneration)) {
              const acknowledgementFailed = cursorsEqual(processedCursor, snapshot.cursor);
              if (
                !(await startRecovery(
                  error,
                  acknowledgementFailed ? acknowledgedCursor : null,
                  acknowledgementFailed,
                ))
              ) {
                return;
              }
            }
            continue;
          }
        }

        if (processedCursor && !cursorsEqual(processedCursor, acknowledgedCursor)) {
          if (cursorsEqual(processedCursor, awaitingReplayCursor)) return;
          const replay = pendingChanges.get(frameKey(processedCursor));
          if (!replay) return;
          try {
            const acknowledged = await acknowledge(owner, replay.cursor, frameGeneration);
            if (!acknowledged) continue;
            pendingChanges.delete(frameKey(replay.cursor));
            markRecovered();
            continue;
          } catch (error) {
            if (isActive(owner, frameGeneration)) {
              if (!(await startRecovery(error, acknowledgedCursor, true))) return;
            }
            continue;
          }
        }

        const change = nextChange();
        if (!change) return;
        try {
          const acknowledged = await applyChange(owner, change, frameGeneration);
          if (!acknowledged) continue;
          pendingChanges.delete(frameKey(change.cursor));
          markRecovered();
        } catch (error) {
          if (!isActive(owner, frameGeneration)) continue;
          const acknowledgementFailed = cursorsEqual(processedCursor, change.cursor);
          const recoveryCursor = acknowledgementFailed ? acknowledgedCursor : null;
          if (!(await startRecovery(error, recoveryCursor, acknowledgementFailed))) return;
        }
      }
    } catch (error) {
      reportDegraded(error);
    } finally {
      processing = false;
    }
  };

  const requestDrain = (): void => {
    void drain().catch(reportDegraded);
  };

  return {
    start: (): Promise<void> => {
      if (stopped) return Promise.resolve();
      if (!startPromise) {
        startPromise = acquire(acknowledgedCursor).then(() => drain());
      }
      return startPromise;
    },
    stop: (): Promise<void> => {
      if (!stopPromise) {
        stopped = true;
        stopPromise = (async () => {
          await startPromise?.catch(() => {});
          await recoveryPromise?.catch(() => {});
          await closeCurrent();
          if (acquiring) await close(acquiring);
        })().catch(reportDegraded);
      }
      return stopPromise;
    },
  };
};
