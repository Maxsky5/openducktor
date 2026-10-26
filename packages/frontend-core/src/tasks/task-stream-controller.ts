import type { TaskEventCursor } from "@openducktor/contracts";
import type { TaskStreamFrame, TaskStreamSubscription } from "../connection/host-connection";
import type {
  AdmittedSessionChange,
  AgentSessionViewSync,
} from "../queries/agent-session-view-sync";
import type { TaskViewSync } from "../queries/task-view-sync";

type TaskStreamTransport = {
  subscribeTaskStream: (
    input: { cursor: TaskEventCursor | null },
    onFrame: (frame: TaskStreamFrame) => void,
    onTerminalFailure?: (cause: unknown) => void,
    signal?: AbortSignal,
  ) => Promise<TaskStreamSubscription>;
};

type ChangeFrame = Extract<TaskStreamFrame, { type: "change" }>;

type OwnedSubscription = {
  abort: AbortController;
  subscription: TaskStreamSubscription | null;
  generation: number;
  pendingFrames: TaskStreamFrame[];
  unsubscribePromise: Promise<void> | null;
};

export type TaskStreamController = {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Drop the task data of a workspace that closed. */
  releaseWorkspace(repoPath: string): Promise<void>;
};

export const createTaskStreamController = ({
  transport,
  taskViewSync,
  agentSessionViewSync,
  getOpenRepoPaths,
  onDegraded,
  onSnapshotFinished,
  onSnapshotStarted,
  onWorkspaceFailures,
}: {
  transport: TaskStreamTransport;
  taskViewSync: TaskViewSync;
  agentSessionViewSync: AgentSessionViewSync;
  /** The workspaces that a snapshot reconciles. */
  getOpenRepoPaths: () => readonly string[];
  onDegraded: (cause: unknown) => void;
  onSnapshotFinished?: (repoPath: string, succeeded: boolean) => void;
  onSnapshotStarted?: (repoPath: string) => void;
  /** Open workspaces that a snapshot could not reconcile. The stream and other workspaces are current. */
  onWorkspaceFailures: (failures: ReadonlyMap<string, unknown>) => void;
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
  let acknowledgementPromise: Promise<void> | null = null;
  let awaitingReplayCursor: TaskEventCursor | null = null;
  let pendingSnapshot: Extract<TaskStreamFrame, { type: "snapshot_required" }> | null = null;
  const pendingChanges = new Map<string, ChangeFrame>();
  // Session work starts when a change becomes consecutive, so reads of changes that arrive
  // before a host request starts join that request. Completion stays in cursor order.
  const admittedChanges = new Map<string, AdmittedSessionChange>();
  let admittedCursor: TaskEventCursor | null = null;

  const compareCursor = (left: TaskEventCursor, right: TaskEventCursor): number => {
    if (left.epoch !== right.epoch) {
      throw new Error(
        `Task stream epoch changed from '${right.epoch}' to '${left.epoch}' without a snapshot.`,
      );
    }
    return left.sequence - right.sequence;
  };

  const frameKey = (cursor: TaskEventCursor): string => `${cursor.epoch}:${cursor.sequence}`;

  const reportDegraded = (cause: unknown): void => {
    // A stopped stream closes with its connection, as on a host switch, so its failed
    // unsubscribe asks nothing of the user.
    if (degraded || stopped) return;
    degraded = true;
    try {
      onDegraded(cause);
    } catch {
      // Reporting must not leave a controller-owned promise rejected.
    }
  };

  const close = (owner: OwnedSubscription): Promise<void> => {
    if (owner.unsubscribePromise) return owner.unsubscribePromise;
    owner.abort.abort();
    owner.unsubscribePromise = Promise.resolve()
      .then(async () => {
        if (owner.subscription) await owner.subscription.unsubscribe();
      })
      .catch((cause: unknown) => {
        reportDegraded(cause);
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
    await owner.subscription.acknowledge(cursor);
    if (!isActive(owner, frameGeneration)) return false;
    acknowledgedCursor = cursor;
    return true;
  };

  const acknowledgeProgress = (owner: OwnedSubscription, frameGeneration: number): void => {
    if (
      acknowledgementPromise ||
      !processedCursor ||
      cursorsEqual(processedCursor, acknowledgedCursor) ||
      awaitingReplayCursor
    )
      return;
    const cursor = processedCursor;
    acknowledgementPromise = (async () => {
      try {
        if (await acknowledge(owner, cursor, frameGeneration)) {
          markRecovered();
        }
      } catch (error) {
        if (isActive(owner, frameGeneration)) await startRecovery(error, acknowledgedCursor, true);
      }
    })()
      .catch(reportDegraded)
      .finally(() => {
        acknowledgementPromise = null;
        requestDrain();
      });
  };

  /** Apply consecutive changes together so their session reads share requests. */
  const applyChanges = async (
    owner: OwnedSubscription,
    frames: ChangeFrame[],
    frameGeneration: number,
  ): Promise<void> => {
    await Promise.all([
      (async () => {
        for (const frame of frames) {
          // A replacement snapshot supersedes the rest of the run.
          if (!isActive(owner, frameGeneration)) return;
          // Task views apply in event order.
          // react-doctor-disable-next-line react-doctor/async-await-in-loop
          await taskViewSync.reconcileExternalEvent(frame.event, frame.cursor);
        }
      })(),
      agentSessionViewSync.completeExternalEvents(
        frames.map((frame) => {
          const change = admittedChanges.get(frameKey(frame.cursor));
          if (!change) throw new Error("Task change was not admitted in cursor order.");
          return change;
        }),
        () => isActive(owner, frameGeneration),
      ),
    ]);
    if (isActive(owner, frameGeneration)) {
      processedCursor = frames[frames.length - 1]!.cursor;
      // Replay uses the cursor. Release completed cards while acknowledgement is pending.
      for (const frame of frames) {
        const key = frameKey(frame.cursor);
        pendingChanges.delete(key);
        admittedChanges.delete(key);
      }
    }
  };

  const applySnapshot = async (
    owner: OwnedSubscription,
    frame: Extract<TaskStreamFrame, { type: "snapshot_required" }>,
    frameGeneration: number,
  ): Promise<boolean> => {
    const repoPaths = getOpenRepoPaths();
    for (const repoPath of repoPaths) onSnapshotStarted?.(repoPath);
    // A failed task list keeps the stream ownership of its workspace, so no task load retries it.
    let readRepoPaths: ReadonlySet<string> = new Set();
    try {
      const tasks = await taskViewSync.reconcileStreamSnapshot(repoPaths);
      // A newer snapshot supersedes this one before it reconciles session lists.
      if (!isActive(owner, frameGeneration)) return false;
      // A workspace that closes during the snapshot was released. Its sessions stay released.
      const sessionFailures = await agentSessionViewSync.reconcileStreamSnapshot(
        tasks.taskIdsByRepo,
        () => isActive(owner, frameGeneration),
      );
      readRepoPaths = new Set(tasks.taskIdsByRepo.keys());
      if (isActive(owner, frameGeneration)) {
        // One workspace that fails does not stop the snapshot of the other workspaces.
        reportWorkspaceFailures(new Map([...tasks.failures, ...sessionFailures]));
      }
    } finally {
      if (isActive(owner, frameGeneration)) {
        const openRepoPaths = new Set(getOpenRepoPaths());
        // Only a failed snapshot recovers the stream.
        for (const repoPath of repoPaths) {
          if (openRepoPaths.has(repoPath)) {
            onSnapshotFinished?.(repoPath, readRepoPaths.has(repoPath));
          }
        }
      }
    }
    if (!isActive(owner, frameGeneration)) return false;
    processedCursor = frame.cursor;
    return acknowledge(owner, frame.cursor, frameGeneration);
  };

  /** Report the failures of the workspaces that are still open. */
  const reportWorkspaceFailures = (failures: ReadonlyMap<string, unknown>): void => {
    const openRepoPaths = new Set(getOpenRepoPaths());
    const failed = new Map([...failures].filter(([repoPath]) => openRepoPaths.has(repoPath)));
    if (failed.size === 0) return;
    try {
      onWorkspaceFailures(failed);
    } catch {
      // Reporting must not fail the snapshot or start a stream recovery.
    }
  };

  const nextChange = (after: TaskEventCursor | null): ChangeFrame | null => {
    if (!after) {
      return [...pendingChanges.values()].find((frame) => frame.cursor.sequence === 0) ?? null;
    }
    return (
      [...pendingChanges.values()].find(
        (frame) =>
          frame.cursor.epoch === after.epoch && frame.cursor.sequence === after.sequence + 1,
      ) ?? null
    );
  };

  const admitChanges = (): void => {
    if (stopped || paused || pendingSnapshot) return;
    for (
      let frame = nextChange(admittedCursor ?? processedCursor);
      frame;
      frame = nextChange(frame.cursor)
    ) {
      const change = agentSessionViewSync.admitExternalEvent(frame.event);
      // The drain awaits the result later. A failure before then is not unhandled.
      change.catch(() => {});
      admittedChanges.set(frameKey(frame.cursor), change);
      admittedCursor = frame.cursor;
    }
  };

  const clearAdmittedChanges = (): void => {
    admittedChanges.clear();
    admittedCursor = null;
  };

  /** The received changes that follow the processed cursor without a gap. */
  const nextChanges = (): ChangeFrame[] => {
    const frames: ChangeFrame[] = [];
    for (let frame = nextChange(processedCursor); frame; frame = nextChange(frame.cursor)) {
      frames.push(frame);
    }
    return frames;
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
      // Reads of the replaced stream must not commit records or start live refreshes.
      agentSessionViewSync.cancelReads();
      clearAdmittedChanges();
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
    admitChanges();
    requestDrain();
  };

  const acquire = async (cursor: TaskEventCursor | null): Promise<void> => {
    const owner: OwnedSubscription = {
      abort: new AbortController(),
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
            void startRecovery(error, acknowledgedCursor, true).then((recovered) => {
              if (!recovered && !stopped) reportDegraded(error);
            }, reportDegraded);
          },
          owner.abort.signal,
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
    cause: unknown,
    cursor: TaskEventCursor | null,
    awaitReplay: boolean,
  ): Promise<boolean> => {
    if (stopped) return false;
    reportDegraded(cause);
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
      awaitingReplayCursor = cursorsEqual(processedCursor, acknowledgedCursor)
        ? null
        : processedCursor;
    } else {
      awaitingReplayCursor = null;
      pendingChanges.clear();
      clearAdmittedChanges();
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
    requestDrain();
    return true;
  };

  const startRecovery = (
    cause: unknown,
    cursor: TaskEventCursor | null,
    awaitReplay: boolean,
  ): Promise<boolean> => {
    if (!recoveryPromise) {
      recoveryPromise = recover(cause, cursor, awaitReplay).finally(() => {
        recoveryPromise = null;
      });
    }
    return recoveryPromise;
  };

  const drain = async (): Promise<void> => {
    if (processing || stopped || paused || !current) return;
    processing = true;
    try {
      // Frames that arrive together, such as a replayed backlog, join one run.
      await Promise.resolve();
      while (!stopped && !paused && current) {
        const owner = current;
        const frameGeneration = operationGeneration;
        const snapshot = pendingSnapshot;
        if (snapshot && acknowledgementPromise) {
          await acknowledgementPromise;
          continue;
        }
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
                if (!stopped && !acknowledgementFailed) reportDegraded(error);
                return;
              }
            }
            continue;
          }
        }

        if (awaitingReplayCursor) return;

        admitChanges();
        const changes = nextChanges();
        if (changes.length === 0) {
          acknowledgeProgress(owner, frameGeneration);
          return;
        }
        try {
          // Apply the next run while the previous cumulative acknowledgement is in flight.
          await applyChanges(owner, changes, frameGeneration);
          if (isActive(owner, frameGeneration)) acknowledgeProgress(owner, frameGeneration);
        } catch (error) {
          if (!isActive(owner, frameGeneration)) continue;
          if (!(await startRecovery(error, null, false))) return;
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
    releaseWorkspace: async (repoPath): Promise<void> => {
      await Promise.all([
        taskViewSync.releaseWorkspace(repoPath),
        agentSessionViewSync.releaseWorkspace(repoPath),
      ]);
    },
    stop: (): Promise<void> => {
      if (!stopPromise) {
        stopped = true;
        acquiring?.abort.abort();
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

const cursorsEqual = (left: TaskEventCursor | null, right: TaskEventCursor | null): boolean =>
  left !== null && right !== null && left.epoch === right.epoch && left.sequence === right.sequence;
