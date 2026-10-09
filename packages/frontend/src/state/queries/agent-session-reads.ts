import type { AgentSessionRecord, TaskAgentSessions } from "@openducktor/contracts";
import { CancelledError, type Query, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { AgentSessionReadPort } from "./agent-sessions";

export type SessionReadCommit = {
  repoPath: string;
  ownershipChanged: boolean;
};

/** Share a read queue per QueryClient and keep each workspace's host requests in order. */
export function getSessionReads(queryClient: QueryClient): SessionReads {
  let reads = readers.get(queryClient);
  if (!reads) {
    reads = new SessionReads(queryClient);
    readers.set(queryClient, reads);
  }
  return reads;
}

type Waiter = {
  resolve: (records: AgentSessionRecord[]) => void;
  reject: (cause: unknown) => void;
  isCurrent: () => boolean;
  committed: Promise<boolean>;
  delivered: boolean;
};

type TaskRead = {
  revision: number;
  deleted: boolean;
  demand: number;
  waiters: Set<Waiter>;
  port: AgentSessionReadPort | null;
  commit: Promise<SessionReadCommit> | null;
  ownershipChanged: boolean;
  change: {
    resolve: (commits: SessionReadCommit[]) => void;
    reject: (cause: unknown) => void;
  } | null;
  refresh: { query: Query | undefined } | null;
};

type WorkspaceReads = {
  epoch: number;
  tasks: Map<string, TaskRead>;
  pending: Set<string>;
  running: boolean;
  deadline: number | null;
  timer: ReturnType<typeof setTimeout> | null;
};

const readers = new WeakMap<QueryClient, SessionReads>();

class SessionReads {
  private readonly workspaces = new Map<string, WorkspaceReads>();

  constructor(private readonly queryClient: QueryClient) {}

  /** Join the workspace batch. Keep it open until Query commits each delivered result. */
  read(
    repoPath: string,
    taskId: string,
    port: AgentSessionReadPort,
    signal: AbortSignal,
    change: boolean,
  ): Promise<AgentSessionRecord[]> {
    const workspace = this.workspace(repoPath);
    const task = this.task(repoPath, taskId);
    if (task.deleted) return Promise.resolve([]);
    const query = this.queryClient
      .getQueryCache()
      .find({ queryKey: listKey(repoPath, taskId), exact: true });
    const baseline = ownersKey(
      this.queryClient.getQueryData<AgentSessionRecord[]>(listKey(repoPath, taskId)) ?? [],
    );
    return new Promise((resolve, reject) => {
      let finishCommit!: (committed: boolean) => void;
      const committed = new Promise<boolean>((finish) => {
        finishCommit = finish;
      });
      const waiter: Waiter = {
        resolve,
        reject,
        committed,
        delivered: false,
        isCurrent: () =>
          !signal.aborted &&
          query ===
            this.queryClient
              .getQueryCache()
              .find({ queryKey: listKey(repoPath, taskId), exact: true }),
      };
      const finish = (success: boolean) => {
        // Carry ownership changes forward if a newer event interrupts this commit.
        if (
          waiter.delivered &&
          !task.deleted &&
          baseline !==
            ownersKey(
              this.queryClient.getQueryData<AgentSessionRecord[]>(listKey(repoPath, taskId)) ?? [],
            )
        )
          task.ownershipChanged = true;
        task.waiters.delete(waiter);
        unsubscribe();
        signal.removeEventListener("abort", abort);
        finishCommit(success);
      };
      const abort = () => {
        reject(new CancelledError({ revert: true }));
        finish(false);
      };
      const unsubscribe = this.queryClient.getQueryCache().subscribe((event) => {
        if (event.query !== query) return;
        if (event.type === "removed") {
          abort();
          return;
        }
        if (
          waiter.delivered &&
          event.type === "updated" &&
          (event.action.type === "success" || event.action.type === "error")
        )
          finish(event.action.type === "success");
      });
      signal.addEventListener("abort", abort, { once: true });
      task.port = port;
      task.waiters.add(waiter);
      workspace.pending.add(taskId);
      if (!change) workspace.deadline = Date.now();
      this.schedule(repoPath);
    });
  }

  /** A committed host record replaces pending reads without opening another host request. */
  update(repoPath: string, records: TaskAgentSessions): void {
    const task = this.task(repoPath, records.taskId);
    const key = listKey(repoPath, records.taskId);
    const previous = this.queryClient.getQueryData<AgentSessionRecord[]>(key) ?? [];
    task.revision += 1;
    for (const waiter of task.waiters) {
      if (!waiter.isCurrent()) continue;
      waiter.delivered = true;
      waiter.resolve(records.agentSessions);
    }
    this.queryClient.setQueryData(key, records.agentSessions);
    task.commit = Promise.resolve({
      repoPath,
      ownershipChanged:
        task.ownershipChanged || ownersKey(previous) !== ownersKey(records.agentSessions),
    });
    task.ownershipChanged = false;
  }

  commits(repoPath: string, taskIds: string[]): Promise<SessionReadCommit[]> {
    const commits = new Set(
      taskIds.flatMap((taskId) => {
        const task = this.task(repoPath, taskId);
        return !task.deleted && task.commit ? [task.commit] : [];
      }),
    );
    return Promise.all(commits);
  }

  /** A newer change owns the pending read without keeping the older stream event waiting. */
  refresh(
    repoPath: string,
    taskId: string,
    fetch: () => Promise<AgentSessionRecord[]>,
  ): Promise<SessionReadCommit[]> {
    const task = this.task(repoPath, taskId);
    task.change?.resolve([]);
    const completion = new Promise<SessionReadCommit[]>((resolve, reject) => {
      task.change = { resolve, reject };
    });
    const query = this.queryClient
      .getQueryCache()
      .find({ queryKey: listKey(repoPath, taskId), exact: true });
    if (!task.refresh || task.refresh.query !== query) {
      const refresh = { query };
      task.refresh = refresh;
      void this.refreshTask(repoPath, taskId, fetch, refresh);
    }
    return completion;
  }

  registerDemand(repoPath: string, taskIds: string[]): () => void {
    const tasks = taskIds.map((taskId) => this.task(repoPath, taskId));
    for (const task of tasks) task.demand += 1;
    return () => {
      for (const task of tasks) task.demand -= 1;
    };
  }

  hasDemand(repoPath: string, taskId: string): boolean {
    const task = this.task(repoPath, taskId);
    const query = this.queryClient
      .getQueryCache()
      .find({ queryKey: listKey(repoPath, taskId), exact: true });
    return (
      !task.deleted && (task.demand > 0 || task.waiters.size > 0 || query?.isActive() === true)
    );
  }

  invalidate(repoPath: string, taskIds: string[], batch = false): void {
    const workspace = this.workspace(repoPath);
    if (
      batch &&
      taskIds.some((taskId) => this.hasDemand(repoPath, taskId)) &&
      workspace.deadline === null
    )
      workspace.deadline = Date.now() + 50;
    for (const taskId of taskIds) {
      const task = this.task(repoPath, taskId);
      task.revision += 1;
      if ([...task.waiters].some((waiter) => waiter.delivered)) {
        void this.queryClient.cancelQueries({ queryKey: listKey(repoPath, taskId), exact: true });
      }
    }
  }

  isDeleted(repoPath: string, taskId: string): boolean {
    return this.task(repoPath, taskId).deleted;
  }

  knownTaskIds(repoPath: string): string[] {
    // The session store keeps tasks after Query drops their inactive records.
    return [...this.workspace(repoPath).tasks.keys()];
  }

  restore(repoPath: string, taskIds: string[]): void {
    for (const taskId of taskIds) this.task(repoPath, taskId).deleted = false;
  }

  delete(repoPath: string, taskIds: string[]): void {
    const workspace = this.workspace(repoPath);
    for (const taskId of taskIds) {
      const task = this.task(repoPath, taskId);
      task.revision += 1;
      task.deleted = true;
      task.ownershipChanged = false;
      task.change?.resolve([]);
      task.change = null;
      task.refresh = null;
      workspace.pending.delete(taskId);
      for (const waiter of task.waiters) waiter.resolve([]);
      task.waiters.clear();
    }
    this.schedule(repoPath);
  }

  /** Cancel old reads before a new stream snapshot can start. */
  cancel(): void {
    for (const query of this.queryClient
      .getQueryCache()
      .findAll({ queryKey: ["agent-sessions", "list"] })) {
      const repoPath = queryKeyStringSchema.safeParse(query.queryKey[2]);
      if (repoPath.success) this.workspace(repoPath.data);
    }
    for (const [repoPath, workspace] of this.workspaces) {
      workspace.epoch += 1;
      workspace.pending.clear();
      workspace.deadline = null;
      if (workspace.timer !== null) clearTimeout(workspace.timer);
      workspace.timer = null;
      for (const task of workspace.tasks.values()) {
        task.revision += 1;
        task.change?.reject(new CancelledError({ revert: true }));
        task.change = null;
        task.refresh = null;
        for (const waiter of task.waiters) waiter.reject(new CancelledError({ revert: true }));
        task.waiters.clear();
      }
      void this.queryClient.cancelQueries({ queryKey: ["agent-sessions", "list", repoPath] });
      void this.queryClient.invalidateQueries({
        queryKey: ["agent-sessions", "list", repoPath],
        refetchType: "none",
      });
    }
  }

  skipWait(repoPath: string): void {
    this.workspace(repoPath).deadline = Date.now();
    this.schedule(repoPath);
  }

  private workspace(repoPath: string): WorkspaceReads {
    let state = this.workspaces.get(repoPath);
    if (!state) {
      state = {
        epoch: 0,
        tasks: new Map(),
        pending: new Set(),
        running: false,
        deadline: null,
        timer: null,
      };
      this.workspaces.set(repoPath, state);
    }
    return state;
  }

  private task(repoPath: string, taskId: string): TaskRead {
    const workspace = this.workspace(repoPath);
    let task = workspace.tasks.get(taskId);
    if (!task) {
      task = {
        revision: 0,
        deleted: false,
        demand: 0,
        waiters: new Set(),
        port: null,
        commit: null,
        ownershipChanged: false,
        change: null,
        refresh: null,
      };
      workspace.tasks.set(taskId, task);
    }
    return task;
  }

  private async refreshTask(
    repoPath: string,
    taskId: string,
    fetch: () => Promise<AgentSessionRecord[]>,
    refresh: NonNullable<TaskRead["refresh"]>,
  ): Promise<void> {
    const task = this.task(repoPath, taskId);
    try {
      while (task.refresh === refresh) {
        const reading = fetch();
        refresh.query = this.queryClient
          .getQueryCache()
          .find({ queryKey: listKey(repoPath, taskId), exact: true });
        await reading;
        const revision = task.revision;
        const commits = await this.commits(repoPath, [taskId]);
        if (task.refresh !== refresh) return;
        // A change can arrive after Query finishes but before the batch commits.
        if (task.revision !== revision) continue;
        const change = task.change;
        task.change = null;
        task.refresh = null;
        change?.resolve(commits);
      }
    } catch (cause) {
      if (task.refresh !== refresh) return;
      const change = task.change;
      task.change = null;
      task.refresh = null;
      change?.reject(cause);
    }
  }

  private schedule(repoPath: string): void {
    const workspace = this.workspace(repoPath);
    if (workspace.timer !== null) clearTimeout(workspace.timer);
    workspace.timer = null;
    if (workspace.running || workspace.pending.size === 0) return;
    const delay = Math.max(0, (workspace.deadline ?? Date.now()) - Date.now());
    workspace.timer = setTimeout(() => {
      workspace.timer = null;
      void this.runBatch(repoPath);
    }, delay);
  }

  private async runBatch(repoPath: string): Promise<void> {
    const workspace = this.workspace(repoPath);
    if (workspace.running) return;
    const taskIds = [...workspace.pending]
      .filter((taskId) => {
        const task = this.task(repoPath, taskId);
        return !task.deleted && [...task.waiters].some((waiter) => waiter.isCurrent());
      })
      .sort();
    workspace.pending.clear();
    if (taskIds.length === 0) {
      workspace.deadline = null;
      return;
    }
    workspace.running = true;
    workspace.deadline = null;
    const epoch = workspace.epoch;
    const baseline = new Map(
      taskIds.map((taskId) => [
        taskId,
        {
          revision: this.task(repoPath, taskId).revision,
          query: this.queryClient
            .getQueryCache()
            .find({ queryKey: listKey(repoPath, taskId), exact: true }),
          state: this.queryClient.getQueryState(listKey(repoPath, taskId)),
        },
      ]),
    );
    let finishBatch!: (commit: SessionReadCommit) => void;
    const commit = new Promise<SessionReadCommit>((resolve) => {
      finishBatch = resolve;
    });
    for (const taskId of taskIds) this.task(repoPath, taskId).commit = commit;
    const delivered: { taskId: string; waiter: Waiter }[] = [];
    try {
      const port = this.task(repoPath, taskIds[0]!).port!;
      let response: Map<string, AgentSessionRecord[]> | null = null;
      let failure: unknown;
      try {
        response = checkResponse(taskIds, await port.agentSessionsListForTasks(repoPath, taskIds));
      } catch (cause) {
        failure = cause;
      }
      for (const taskId of taskIds) {
        const task = this.task(repoPath, taskId);
        if (workspace.epoch !== epoch || task.deleted) continue;
        const start = baseline.get(taskId)!;
        const currentQuery = this.queryClient
          .getQueryCache()
          .find({ queryKey: listKey(repoPath, taskId), exact: true });
        if (task.revision !== start.revision || currentQuery !== start.query) {
          // Shared Query reads still need fresh records after a newer event takes over.
          if (task.waiters.size > 0) workspace.pending.add(taskId);
          continue;
        }
        const currentState = this.queryClient.getQueryState<AgentSessionRecord[]>(
          listKey(repoPath, taskId),
        );
        const replaced =
          currentState?.dataUpdateCount !== start.state?.dataUpdateCount ||
          currentState?.errorUpdateCount !== start.state?.errorUpdateCount;
        for (const waiter of task.waiters) {
          if (!waiter.isCurrent()) continue;
          waiter.delivered = true;
          delivered.push({ taskId, waiter });
          if (replaced && currentState?.status === "error") waiter.reject(currentState.error);
          else if (replaced && currentState?.data !== undefined) waiter.resolve(currentState.data);
          else if (response) waiter.resolve(response.get(taskId)!);
          else waiter.reject(failure);
        }
      }
      const settled = await Promise.all(
        delivered.map(async ({ taskId, waiter }) => ((await waiter.committed) ? taskId : null)),
      );
      const committedTaskIds = [
        ...new Set(settled.filter((taskId): taskId is string => taskId !== null)),
      ].filter(
        (taskId) =>
          workspace.epoch === epoch &&
          this.task(repoPath, taskId).revision === baseline.get(taskId)!.revision &&
          this.queryClient
            .getQueryCache()
            .find({ queryKey: listKey(repoPath, taskId), exact: true }) ===
            baseline.get(taskId)!.query,
      );
      const ownershipChanged = committedTaskIds.some(
        (taskId) => this.task(repoPath, taskId).ownershipChanged,
      );
      for (const taskId of committedTaskIds) this.task(repoPath, taskId).ownershipChanged = false;
      finishBatch({ repoPath, ownershipChanged });
    } finally {
      workspace.running = false;
      this.schedule(repoPath);
    }
  }
}

const queryKeyStringSchema = z.string();

const listKey = (repoPath: string, taskId: string) =>
  ["agent-sessions", "list", repoPath, taskId] as const;

const ownersKey = (records: AgentSessionRecord[]): string =>
  JSON.stringify(
    records
      .map((record) => [
        record.externalSessionId,
        record.runtimeKind,
        record.workingDirectory,
        record.role,
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );

function checkResponse(
  taskIds: string[],
  response: TaskAgentSessions[],
): Map<string, AgentSessionRecord[]> {
  const requested = new Set(taskIds);
  const records = new Map<string, AgentSessionRecord[]>();
  for (const result of response) {
    if (!requested.has(result.taskId))
      throw new Error(`Batch session response included unexpected task "${result.taskId}".`);
    if (records.has(result.taskId))
      throw new Error(`Batch session response included task "${result.taskId}" more than once.`);
    records.set(result.taskId, result.agentSessions);
  }
  for (const taskId of taskIds)
    if (!records.has(taskId)) throw new Error(`Batch session response omitted task "${taskId}".`);
  return records;
}
