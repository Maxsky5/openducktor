import type { GitReadContext } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";

type Mode = "full" | "incremental";
export type WorkspaceGitRefresh = {
  consumer: object;
  context: string;
  priority: number;
  mayFetch: boolean;
  run: () => Promise<void>;
};
type Batch = { mode: Mode; git: WorkspaceGitRefresh[] };
type Scheduler = {
  pending: Batch | null;
  promise: Promise<void> | null;
  readContext: GitReadContext | undefined;
  mode: Mode;
};
const schedulers = new WeakMap<QueryClient, Map<string, Scheduler>>();
/** Share pending signals per root and run one more batch for signals received during a read. */
export const scheduleWorkspaceRefresh = (
  client: QueryClient,
  root: string,
  mode: Mode,
  refreshFiles: () => Promise<void>,
  refreshGit?: WorkspaceGitRefresh,
): Promise<void> => {
  const scheduler = schedulerFor(client, root);
  if (!scheduler.pending) scheduler.pending = { mode, git: [] };
  if (mode === "full") {
    scheduler.pending.mode = mode;
    // A new context needs its own read ID, even while an earlier refresh waits.
    scheduler.readContext = undefined;
    scheduler.mode = "full";
  }
  if (refreshGit) {
    const jobs = scheduler.pending.git;
    const index = jobs.findIndex(
      (job) => job.consumer === refreshGit.consumer && job.context === refreshGit.context,
    );
    if (index === -1) jobs.push(refreshGit);
    else if (refreshGit.priority > jobs[index]!.priority) jobs[index] = refreshGit;
  }
  if (scheduler.promise) return scheduler.promise;
  const promise = Promise.resolve()
    .then(async () => {
      let failure: unknown;
      while (scheduler.pending) {
        const batch = scheduler.pending;
        scheduler.pending = null;
        scheduler.mode = batch.mode;
        scheduler.readContext = { refreshId: crypto.randomUUID() };
        // Fetch can move the target revision. File reads must use its new value.
        const beforeFiles = batch.git.filter((job) => batch.mode === "full" || job.mayFetch);
        if (beforeFiles.length > 0) {
          const gitResults = await Promise.allSettled(beforeFiles.map((refresh) => refresh.run()));
          for (const result of gitResults)
            if (result.status === "rejected") failure = result.reason;
        }
        const reads = await Promise.allSettled([
          refreshFiles(),
          ...batch.git
            .filter((job) => batch.mode === "incremental" && !job.mayFetch)
            .map((refresh) => refresh.run()),
        ]);
        for (const result of reads) if (result.status === "rejected") failure = result.reason;
        scheduler.readContext = undefined;
        scheduler.mode = "incremental";
      }
      if (failure !== undefined) throw failure;
    })
    .finally(() => {
      scheduler.promise = null;
      scheduler.readContext = undefined;
      scheduler.mode = "incremental";
      // Drop the finished scheduler. Query keeps the file data.
      schedulers.get(client)?.delete(root);
    });
  scheduler.promise = promise;
  return promise;
};

export const workspaceReadContext = (
  client: QueryClient,
  root: string,
): GitReadContext | undefined => schedulers.get(client)?.get(root)?.readContext;
export const workspaceRefreshMode = (client: QueryClient, root: string): Mode =>
  schedulers.get(client)?.get(root)?.mode ?? "incremental";

export const renewWorkspaceReadContext = (client: QueryClient, root: string): void => {
  const scheduler = schedulers.get(client)?.get(root);
  if (scheduler?.readContext) scheduler.readContext = { refreshId: crypto.randomUUID() };
};

const schedulerFor = (client: QueryClient, root: string): Scheduler => {
  let roots = schedulers.get(client);
  if (!roots) {
    roots = new Map();
    schedulers.set(client, roots);
  }
  let scheduler = roots.get(root);
  if (!scheduler) {
    scheduler = { pending: null, promise: null, readContext: undefined, mode: "incremental" };
    roots.set(root, scheduler);
  }
  return scheduler;
};
