import type { AgentSessionRecord, TaskAgentSessions } from "@openducktor/contracts";
import { CancelledError, type QueryClient, replaceEqualDeep } from "@tanstack/react-query";
import type { AgentSessionReadPort } from "./agent-sessions";

type Waiter = {
  taskId: string;
  readPort: AgentSessionReadPort;
  /** The task revision when the request for this read started. */
  sentRevision: number;
  resolve: (records: AgentSessionRecord[]) => void;
  reject: (cause: unknown) => void;
};

/** A task change or a committed update advances `revision`. */
type TaskRevisions = {
  revision: number;
  /** The newest revision that a completed read or a committed update reflects. */
  current: number;
  /** The revision of the last committed update or deletion. An older read cannot replace it. */
  committed: number;
  /** Public read operations in progress. A task change waits for them to read current records. */
  pendingReads: Set<Promise<AgentSessionRecord[]>>;
};

type WorkspaceQueue = {
  queued: Set<Waiter>;
  sent: Set<Waiter> | null;
  sendScheduled: boolean;
  tasks: Map<string, TaskRevisions>;
  /** Confirmed deleted tasks. Their reads return an empty list without a host request. */
  deleted: Set<string>;
  /** The tasks of the last failed request for each task. A missing task fails the request. */
  failedWith: Map<string, Set<string>>;
};

export type AgentSessionListBatch = {
  /** Read one task list. Reads of a workspace that start together share one host request. */
  load: (
    repoPath: string,
    taskId: string,
    readPort: AgentSessionReadPort,
  ) => Promise<AgentSessionRecord[]>;
  /** Advance the revisions of changed tasks. Reads already sent for them read again. */
  markChanged: (repoPath: string, taskIds: string[]) => void;
  /** The task revision, so a caller can later check that a read reflects it. */
  revision: (repoPath: string, taskId: string) => number;
  /** True when a completed read or a committed update reflects the revision. */
  isCurrent: (repoPath: string, taskId: string, revision: number) => boolean;
  /** Record a committed update. An older read cannot replace it. */
  markCommitted: (repoPath: string, taskId: string) => void;
  markDeleted: (repoPath: string, taskIds: string[]) => void;
  isDeleted: (repoPath: string, taskId: string) => boolean;
  /** An authoritative creation or snapshot proves that these tasks exist. */
  markExisting: (repoPath: string, taskIds: string[]) => void;
  /** Cancel the pending reads of these tasks. */
  drop: (repoPath: string, taskIds: string[]) => void;
  /** Cancel every pending read and supersede the reads that already returned. */
  dropAll: () => void;
  /** Advances with each `dropAll`, so superseded work can stop. */
  epoch: () => number;
  /**
   * The tasks whose last read failed in one request with a deleted task. The deletion can
   * explain the failure, so their lists need another read.
   */
  takeFailedWith: (repoPath: string, deletedTaskIds: string[]) => string[];
  /** Track a public read operation until it settles. */
  trackRead: (repoPath: string, taskId: string, read: Promise<AgentSessionRecord[]>) => void;
  pendingReads: (repoPath: string, taskId: string) => Promise<AgentSessionRecord[]>[];
};

const batches = new WeakMap<QueryClient, AgentSessionListBatch>();

/** A list from a host read, mapped to a check for a newer committed list or a supersession. */
const replacedReads = new WeakMap<AgentSessionRecord[], () => boolean>();

/** Replaced read results that Query stored because no older list existed. */
const replacedCommits = new WeakSet<AgentSessionRecord[]>();

/**
 * Query calls this when it stores a list. A read result that a committed update, a deletion, or
 * a stream snapshot replaced keeps the older stored list. The check uses the new result, because
 * structural sharing can return an older stored list for equal records.
 */
export const shareAgentSessionList = (
  previous: AgentSessionRecord[] | undefined,
  next: AgentSessionRecord[],
): AgentSessionRecord[] => {
  if (!replacedReads.get(next)?.()) return replaceEqualDeep(previous, next);
  if (previous !== undefined) return previous;
  replacedCommits.add(next);
  return next;
};

/** Each workspace of a QueryClient has at most one session-list request in progress. */
export const getAgentSessionListBatch = (queryClient: QueryClient): AgentSessionListBatch => {
  let batch = batches.get(queryClient);
  if (!batch) {
    batch = createAgentSessionListBatch();
    batches.set(queryClient, batch);
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success" || event.action.manual) {
        return;
      }
      // Query cannot cancel a read after its response returned. Without an older stored list to
      // keep, a list without data goes back to its first state instead of the replaced records.
      const data = event.query.state.data;
      if (Array.isArray(data) && replacedCommits.has(data)) event.query.reset();
    });
  }
  return batch;
};

const createAgentSessionListBatch = (): AgentSessionListBatch => {
  const workspaces = new Map<string, WorkspaceQueue>();
  let epoch = 0;

  const workspace = (repoPath: string): WorkspaceQueue => {
    let queue = workspaces.get(repoPath);
    if (!queue) {
      queue = {
        queued: new Set(),
        sent: null,
        sendScheduled: false,
        tasks: new Map(),
        deleted: new Set(),
        failedWith: new Map(),
      };
      workspaces.set(repoPath, queue);
    }
    return queue;
  };

  const revisions = (queue: WorkspaceQueue, taskId: string): TaskRevisions => {
    let task = queue.tasks.get(taskId);
    if (!task) {
      task = { revision: 0, current: 0, committed: 0, pendingReads: new Set() };
      queue.tasks.set(taskId, task);
    }
    return task;
  };

  const commit = (queue: WorkspaceQueue, taskId: string): void => {
    const task = revisions(queue, taskId);
    task.revision += 1;
    task.current = task.revision;
    task.committed = task.revision;
  };

  const waiters = (queue: WorkspaceQueue): Waiter[] => [...queue.queued, ...(queue.sent ?? [])];

  const remove = (queue: WorkspaceQueue, waiter: Waiter): void => {
    queue.queued.delete(waiter);
    queue.sent?.delete(waiter);
  };

  const cancel = (queue: WorkspaceQueue, taskIds: Set<string> | null): void => {
    for (const waiter of waiters(queue)) {
      if (taskIds && !taskIds.has(waiter.taskId)) continue;
      remove(queue, waiter);
      waiter.reject(new CancelledError({ revert: true }));
    }
  };

  const schedule = (repoPath: string, queue: WorkspaceQueue): void => {
    if (queue.sendScheduled || queue.sent || queue.queued.size === 0) return;
    queue.sendScheduled = true;
    queueMicrotask(() => {
      queue.sendScheduled = false;
      void send(repoPath, queue);
    });
  };

  const send = async (repoPath: string, queue: WorkspaceQueue): Promise<void> => {
    const [first] = queue.queued;
    if (!first || queue.sent) return;
    // Reads with another read port wait for the next request.
    const sent = new Set([...queue.queued].filter((waiter) => waiter.readPort === first.readPort));
    for (const waiter of sent) {
      queue.queued.delete(waiter);
      waiter.sentRevision = revisions(queue, waiter.taskId).revision;
    }
    queue.sent = sent;
    const sentEpoch = epoch;
    const taskIds = [...new Set([...sent].map((waiter) => waiter.taskId))].sort();
    try {
      const recordsByTaskId = toRecordsByTaskId(
        taskIds,
        await first.readPort.agentSessionsListForTasks(repoPath, taskIds),
      );
      for (const waiter of sent) {
        const task = revisions(queue, waiter.taskId);
        if (task.revision !== waiter.sentRevision) {
          // The task changed after this request started. Read it again in the next request.
          queue.queued.add(waiter);
          continue;
        }
        queue.failedWith.delete(waiter.taskId);
        const records = recordsByTaskId.get(waiter.taskId)!;
        const sentRevision = waiter.sentRevision;
        replacedReads.set(records, () => epoch !== sentEpoch || task.committed > sentRevision);
        task.current = Math.max(task.current, sentRevision);
        waiter.resolve(records);
      }
    } catch (cause) {
      // The host fails the whole request when one requested task is missing. A deletion during
      // the request explains the failure, and a change during it needs a new read anyway.
      const deletedDuringRequest = taskIds.some((taskId) => queue.deleted.has(taskId));
      const requestTaskIds = new Set(taskIds);
      for (const waiter of sent) {
        if (
          deletedDuringRequest ||
          revisions(queue, waiter.taskId).revision !== waiter.sentRevision
        ) {
          queue.queued.add(waiter);
          continue;
        }
        queue.failedWith.set(waiter.taskId, requestTaskIds);
        waiter.reject(cause);
      }
    } finally {
      queue.sent = null;
      schedule(repoPath, queue);
    }
  };

  return {
    load: (repoPath, taskId, readPort) => {
      const queue = workspace(repoPath);
      if (queue.deleted.has(taskId)) return Promise.resolve([]);
      return new Promise((resolve, reject) => {
        queue.queued.add({ taskId, readPort, sentRevision: 0, resolve, reject });
        schedule(repoPath, queue);
      });
    },
    markChanged: (repoPath, taskIds) => {
      const queue = workspace(repoPath);
      for (const taskId of taskIds) revisions(queue, taskId).revision += 1;
    },
    revision: (repoPath, taskId) => revisions(workspace(repoPath), taskId).revision,
    isCurrent: (repoPath, taskId, revision) => {
      const queue = workspace(repoPath);
      return queue.deleted.has(taskId) || revisions(queue, taskId).current >= revision;
    },
    markCommitted: (repoPath, taskId) => commit(workspace(repoPath), taskId),
    markDeleted: (repoPath, taskIds) => {
      const queue = workspace(repoPath);
      for (const taskId of taskIds) {
        queue.deleted.add(taskId);
        commit(queue, taskId);
      }
    },
    isDeleted: (repoPath, taskId) => workspaces.get(repoPath)?.deleted.has(taskId) ?? false,
    markExisting: (repoPath, taskIds) => {
      const queue = workspace(repoPath);
      for (const taskId of taskIds) queue.deleted.delete(taskId);
    },
    drop: (repoPath, taskIds) => {
      const queue = workspaces.get(repoPath);
      if (queue) cancel(queue, new Set(taskIds));
    },
    dropAll: () => {
      epoch += 1;
      for (const queue of workspaces.values()) cancel(queue, null);
    },
    epoch: () => epoch,
    takeFailedWith: (repoPath, deletedTaskIds) => {
      const queue = workspaces.get(repoPath);
      if (!queue) return [];
      const deleted = new Set(deletedTaskIds);
      const failedTaskIds = [...queue.failedWith].flatMap(([taskId, requestTaskIds]) =>
        !deleted.has(taskId) && deletedTaskIds.some((deletedId) => requestTaskIds.has(deletedId))
          ? [taskId]
          : [],
      );
      for (const taskId of [...failedTaskIds, ...deletedTaskIds]) queue.failedWith.delete(taskId);
      return failedTaskIds;
    },
    trackRead: (repoPath, taskId, read) => {
      const reads = revisions(workspace(repoPath), taskId).pendingReads;
      reads.add(read);
      const settle = () => reads.delete(read);
      read.then(settle, settle);
    },
    pendingReads: (repoPath, taskId) => [...revisions(workspace(repoPath), taskId).pendingReads],
  };
};

const toRecordsByTaskId = (
  taskIds: string[],
  response: TaskAgentSessions[],
): Map<string, AgentSessionRecord[]> => {
  const requested = new Set(taskIds);
  const recordsByTaskId = new Map<string, AgentSessionRecord[]>();
  for (const { taskId, agentSessions } of response) {
    if (!requested.has(taskId)) {
      throw new Error(`Batch session response included unexpected task "${taskId}".`);
    }
    if (recordsByTaskId.has(taskId)) {
      throw new Error(`Batch session response included task "${taskId}" more than once.`);
    }
    recordsByTaskId.set(taskId, agentSessions);
  }
  const missingTaskId = taskIds.find((taskId) => !recordsByTaskId.has(taskId));
  if (missingTaskId) {
    throw new Error(`Batch session response omitted task "${missingTaskId}".`);
  }
  return recordsByTaskId;
};
