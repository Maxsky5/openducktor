import type { AgentSessionRecord, TaskAgentSessions } from "@openducktor/contracts";
import { CancelledError, type QueryClient } from "@tanstack/react-query";
import type { AgentSessionReadPort } from "./agent-sessions";

type Waiter = {
  taskId: string;
  readPort: AgentSessionReadPort;
  /** The task changed after the request for this waiter started. */
  stale: boolean;
  resolve: (records: AgentSessionRecord[]) => void;
  reject: (cause: unknown) => void;
};

type WorkspaceQueue = {
  queued: Set<Waiter>;
  sent: Set<Waiter> | null;
  sendScheduled: boolean;
};

export type AgentSessionListBatch = {
  /** Read one task list. Reads of a workspace that start together share one host request. */
  load: (
    repoPath: string,
    taskId: string,
    readPort: AgentSessionReadPort,
  ) => Promise<AgentSessionRecord[]>;
  /** Reads already sent for these tasks read again, so they cannot return older records. */
  markStale: (repoPath: string, taskIds: string[]) => void;
  /** Complete the pending reads of a task with its committed records. */
  settle: (repoPath: string, records: TaskAgentSessions) => void;
  /** Cancel the pending reads of these tasks. */
  drop: (repoPath: string, taskIds: string[]) => void;
  /** Cancel every pending read of every workspace. */
  dropAll: () => void;
};

const batches = new WeakMap<QueryClient, AgentSessionListBatch>();

/** Each workspace of a QueryClient has at most one session-list request in progress. */
export const getAgentSessionListBatch = (queryClient: QueryClient): AgentSessionListBatch => {
  let batch = batches.get(queryClient);
  if (!batch) {
    batch = createAgentSessionListBatch();
    batches.set(queryClient, batch);
  }
  return batch;
};

const createAgentSessionListBatch = (): AgentSessionListBatch => {
  const workspaces = new Map<string, WorkspaceQueue>();

  const workspace = (repoPath: string): WorkspaceQueue => {
    let queue = workspaces.get(repoPath);
    if (!queue) {
      queue = { queued: new Set(), sent: null, sendScheduled: false };
      workspaces.set(repoPath, queue);
    }
    return queue;
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
    for (const waiter of sent) queue.queued.delete(waiter);
    queue.sent = sent;
    const taskIds = [...new Set([...sent].map((waiter) => waiter.taskId))].sort();
    try {
      const recordsByTaskId = toRecordsByTaskId(
        taskIds,
        await first.readPort.agentSessionsListForTasks(repoPath, taskIds),
      );
      for (const waiter of sent) {
        if (waiter.stale) {
          waiter.stale = false;
          queue.queued.add(waiter);
        } else {
          waiter.resolve(recordsByTaskId.get(waiter.taskId)!);
        }
      }
    } catch (cause) {
      for (const waiter of sent) waiter.reject(cause);
    } finally {
      queue.sent = null;
      schedule(repoPath, queue);
    }
  };

  return {
    load: (repoPath, taskId, readPort) =>
      new Promise((resolve, reject) => {
        const queue = workspace(repoPath);
        queue.queued.add({ taskId, readPort, stale: false, resolve, reject });
        schedule(repoPath, queue);
      }),
    markStale: (repoPath, taskIds) => {
      const changed = new Set(taskIds);
      for (const waiter of workspaces.get(repoPath)?.sent ?? []) {
        if (changed.has(waiter.taskId)) waiter.stale = true;
      }
    },
    settle: (repoPath, records) => {
      const queue = workspaces.get(repoPath);
      if (!queue) return;
      for (const waiter of waiters(queue)) {
        if (waiter.taskId !== records.taskId) continue;
        remove(queue, waiter);
        waiter.resolve(records.agentSessions);
      }
    },
    drop: (repoPath, taskIds) => {
      const queue = workspaces.get(repoPath);
      if (queue) cancel(queue, new Set(taskIds));
    },
    dropAll: () => {
      for (const queue of workspaces.values()) cancel(queue, null);
    },
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
