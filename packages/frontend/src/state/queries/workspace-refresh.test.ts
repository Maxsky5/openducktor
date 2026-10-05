import { describe, expect, test } from "bun:test";
import type {
  WorkspaceTextFileReadResult,
  WorkspaceFileTreeContext,
  WorkspaceFileTreeRefreshInput,
  WorkspaceFileTreeRefreshResult,
} from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  filesystemQueryKeys,
  refreshWorkspaceFileQueries,
  workspaceFileTreeQueryOptions,
  workspaceTextFileQueryOptions,
  type WorkspaceFileTreeView,
} from "./filesystem";
import {
  renewWorkspaceReadContext,
  scheduleWorkspaceRefresh,
  workspaceReadContext,
  type WorkspaceGitRefresh,
} from "./workspace-refresh";

const context: WorkspaceFileTreeContext = {
  rootPath: "/repo",
  gitDirectory: "/repo/.git",
  branch: "main",
  head: "head",
  targetBranch: null,
  targetRevision: null,
  indexVersion: "index",
  sparsePolicy: "policy",
};
const entry = (path: string, gitStatus: "modified" | null = null) => ({
  path,
  kind: "file" as const,
  size: null,
  mtimeMs: null,
  gitStatus,
});
const snapshot: WorkspaceFileTreeRefreshResult = {
  kind: "snapshot",
  rootPath: "/repo",
  context,
  cursor: { viewId: "view", revision: 0 },
  entries: [entry("file.txt"), entry("other.txt")],
};
const deferred = <A>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const createHost = (
  refresh: (input: WorkspaceFileTreeRefreshInput) => Promise<WorkspaceFileTreeRefreshResult>,
  read = async () => "disk",
) => ({
  filesystemRefreshTree: refresh,
  filesystemListDirectory: async () => {
    throw new Error("unexpected directory read");
  },
  filesystemWriteTextFile: async () => {
    throw new Error("unexpected write");
  },
  filesystemReadTextFile: async () => ({
    kind: "text" as const,
    rootPath: "/repo",
    relativePath: "file.txt",
    contents: await read(),
    size: 4,
    mtimeMs: null,
    revision: "revision",
  }),
});
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

const gitJob = (
  run: () => Promise<void>,
  consumer: WorkspaceGitRefresh["consumer"] = run,
  context = "main",
  priority = 2,
): WorkspaceGitRefresh => ({ consumer, context, priority, mayFetch: false, run });

describe("workspace file refresh Query ownership", () => {
  test.each([false, true])(
    "reads a full tree after a full refresh while inactive (disabled observer: %s)",
    async (disabled) => {
      const queryClient = client();
      const modes: string[] = [];
      const options = workspaceFileTreeQueryOptions(
        "/repo",
        null,
        createHost(async (input) => {
          modes.push(input.mode);
          return snapshot;
        }),
      );
      let stop: (() => void) | undefined;
      const observer = disabled
        ? new QueryObserver(queryClient, { ...options, enabled: false })
        : undefined;
      try {
        await queryClient.fetchQuery(options);
        stop = observer?.subscribe(() => {});
        await refreshWorkspaceFileQueries(queryClient, "/repo", "full");
        expect(modes).toEqual(["full"]);
        observer?.setOptions({ ...options, enabled: true });
        await queryClient.fetchQuery(options);
        expect(modes).toEqual(["full", "full"]);
      } finally {
        stop?.();
        queryClient.clear();
      }
    },
  );
  test("runs one Git read for a burst from the same consumer", async () => {
    const queryClient = client();
    let files = 0,
      git = 0;
    const refreshFiles = async () => {
      files += 1;
    };
    const consumer = {};
    const signals = Array.from({ length: 3 }, () =>
      scheduleWorkspaceRefresh(
        queryClient,
        "/repo",
        "incremental",
        refreshFiles,
        gitJob(async () => {
          git += 1;
        }, consumer),
      ),
    );
    await Promise.all(signals);
    expect(files).toBe(1);
    expect(git).toBe(1);
    queryClient.clear();
  });

  test("keeps separate consumers and contexts, and keeps the strongest pending Git request", async () => {
    const queryClient = client();
    const consumer = {},
      otherConsumer = {};
    const calls: string[] = [];
    const schedule = (
      owner: WorkspaceGitRefresh["consumer"],
      context: string,
      priority: number,
      label: string,
      mode: "full" | "incremental" = "incremental",
    ) =>
      scheduleWorkspaceRefresh(
        queryClient,
        "/repo",
        mode,
        async () => {
          calls.push("files");
        },
        gitJob(
          async () => {
            calls.push(label);
          },
          owner,
          context,
          priority,
        ),
      );
    const signals = [
      schedule(consumer, "main", 1, "scheduled"),
      schedule(consumer, "main", 2, "soft"),
      schedule(consumer, "main", 3, "hard", "full"),
      schedule(consumer, "main", 2, "later soft"),
      schedule(otherConsumer, "main", 2, "other consumer"),
      schedule(consumer, "other branch", 2, "other context"),
    ];
    await Promise.all(signals);
    expect(calls).toEqual(["hard", "other consumer", "other context", "files"]);
    queryClient.clear();
  });

  test("groups trailing signals and reports Git failures after the pending batch completes", async () => {
    const queryClient = client();
    const consumer = {},
      started = deferred<void>(),
      release = deferred<void>();
    let files = 0,
      git = 0;
    const refreshFiles = async () => {
      files += 1;
      if (files === 1) {
        started.resolve();
        await release.promise;
      }
    };
    const signal = () =>
      scheduleWorkspaceRefresh(
        queryClient,
        "/repo",
        "incremental",
        refreshFiles,
        gitJob(async () => {
          git += 1;
          if (git === 1) throw new Error("Git failed");
        }, consumer),
      );
    const first = signal();
    const failed = first.catch((error: Error) => error);
    await started.promise;
    const second = signal(),
      third = signal();
    expect(second).toBe(first);
    expect(third).toBe(first);
    release.resolve();
    expect(await failed).toEqual(new Error("Git failed"));
    expect(files).toBe(2);
    expect(git).toBe(2);
    expect(workspaceReadContext(queryClient, "/repo")).toBeUndefined();
    queryClient.clear();
  });

  test("waits for a scheduled fetch before reading the new target", async () => {
    const queryClient = client();
    const started = deferred<void>(),
      release = deferred<void>();
    let target = "old";
    const seen: string[] = [];
    const sweep = scheduleWorkspaceRefresh(
      queryClient,
      "/repo",
      "incremental",
      async () => {
        seen.push(target);
      },
      {
        ...gitJob(async () => {
          started.resolve();
          await release.promise;
          target = "new";
          renewWorkspaceReadContext(queryClient, "/repo");
        }),
        mayFetch: true,
      },
    );
    try {
      await started.promise;
      expect(seen).toEqual([]);
      release.resolve();
      await sweep;
      expect(seen).toEqual(["new"]);
    } finally {
      release.resolve();
      await sweep;
      queryClient.clear();
    }
  });
  test("rejects a snapshot from a different selected branch without a second read", async () => {
    const queryClient = client();
    let reads = 0;
    const host = createHost(async () => {
      reads += 1;
      return snapshot;
    });
    const options = workspaceFileTreeQueryOptions("/repo", null, host, "other");
    try {
      await expect(queryClient.fetchQuery(options)).rejects.toThrow("branch");
      expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
      expect(reads).toBe(1);
    } finally {
      queryClient.clear();
    }
  });

  test.each([
    { branchKey: "main", branch: "main", head: "head" },
    { branchKey: "branch:main", branch: "main", head: "head" },
    { branchKey: "detached:revision", branch: null, head: "revision" },
    { branchKey: "detached", branch: null, head: "revision" },
  ])("accepts the selected branch identity $branchKey", async ({ branchKey, branch, head }) => {
    const queryClient = client();
    const host = createHost(async () => ({ ...snapshot, context: { ...context, branch, head } }));
    try {
      const view = await queryClient.fetchQuery(
        workspaceFileTreeQueryOptions("/repo", null, host, branchKey),
      );
      expect(view.context).toMatchObject({ branch, head });
    } finally {
      queryClient.clear();
    }
  });

  test("a queued full refresh cancels old tree and selected-content reads before Git completes", async () => {
    const queryClient = client();
    const oldTree = deferred<WorkspaceFileTreeRefreshResult>(),
      oldText = deferred<string>(),
      gitStarted = deferred<void>(),
      releaseGit = deferred<void>();
    const host = createHost(
      () => oldTree.promise,
      () => oldText.promise,
    );
    const treeOptions = workspaceFileTreeQueryOptions("/repo", null, host, "main");
    const textOptions = workspaceTextFileQueryOptions("/repo", "file.txt", host);
    const treeRead = queryClient.fetchQuery(treeOptions).catch(() => undefined);
    const textRead = queryClient.fetchQuery(textOptions).catch(() => undefined);
    let sweep: Promise<void> | undefined;
    try {
      sweep = refreshWorkspaceFileQueries(
        queryClient,
        "/repo",
        "full",
        gitJob(async () => {
          gitStarted.resolve();
          await releaseGit.promise;
        }),
      );
      await gitStarted.promise;
      oldTree.resolve(snapshot);
      oldText.resolve("previous branch content");
      await Promise.all([treeRead, textRead]);
      expect(queryClient.getQueryData(treeOptions.queryKey)).toBeUndefined();
      expect(queryClient.getQueryData(textOptions.queryKey)).toBeUndefined();
    } finally {
      releaseGit.resolve();
      await sweep;
      queryClient.clear();
    }
  });

  test("a full refresh supersedes an active incremental read without reporting cancellation as a failure", async () => {
    const queryClient = client();
    const started = deferred<void>(),
      oldRead = deferred<WorkspaceFileTreeRefreshResult>();
    const inputs: WorkspaceFileTreeRefreshInput[] = [];
    const host = createHost(async (input) => {
      inputs.push(input);
      if (input.mode === "incremental") {
        started.resolve();
        return oldRead.promise;
      }
      return snapshot;
    });
    const options = workspaceFileTreeQueryOptions("/repo", null, host, "main");
    await queryClient.fetchQuery(options);
    const observer = new QueryObserver(queryClient, { ...options, refetchOnMount: false });
    const stop = observer.subscribe(() => {});
    try {
      const routine = refreshWorkspaceFileQueries(queryClient, "/repo");
      await started.promise;
      const full = refreshWorkspaceFileQueries(queryClient, "/repo", "full");
      expect(full).toBe(routine);
      await full;
      oldRead.resolve({ ...snapshot, entries: [entry("obsolete.txt")] });
      await oldRead.promise;
      expect(inputs.map((input) => input.mode)).toEqual(["full", "incremental", "full"]);
      expect(queryClient.getQueryData<WorkspaceFileTreeView>(options.queryKey)?.entries).toEqual(
        snapshot.entries,
      );
      expect(queryClient.getQueryState(options.queryKey)?.status).toBe("success");
    } finally {
      oldRead.resolve(snapshot);
      stop();
      queryClient.clear();
    }
  });

  test("applies patches, keeps unchanged entries, and makes reset recovery distinct from failed reads", async () => {
    const queryClient = client();
    const inputs: WorkspaceFileTreeRefreshInput[] = [];
    let response: WorkspaceFileTreeRefreshResult = snapshot;
    let failure: Error | undefined;
    const host = createHost(async (input) => {
      inputs.push(input);
      if (failure) throw failure;
      return response;
    });
    const options = { ...workspaceFileTreeQueryOptions("/repo", null, host), staleTime: 0 };
    try {
      await queryClient.fetchQuery(options);
      response = {
        kind: "patch",
        rootPath: "/repo",
        context,
        base: { viewId: "view", revision: 0 },
        cursor: { viewId: "view", revision: 1 },
        upserts: [entry("file.txt", "modified"), entry("new.txt")],
        removals: ["other.txt"],
      };
      const patched = await queryClient.fetchQuery(options);
      expect(patched.entries).toEqual([entry("file.txt", "modified"), entry("new.txt")]);
      expect(inputs[1]?.mode).toBe("incremental");
      const cachedEntries = queryClient.getQueryData<WorkspaceFileTreeView>(
        options.queryKey,
      )!.entries;
      response = {
        kind: "unchanged",
        rootPath: "/repo",
        context,
        base: { viewId: "view", revision: 1 },
        cursor: { viewId: "view", revision: 1 },
      };
      const same = await queryClient.fetchQuery(options);
      expect(same.entries).toBe(cachedEntries);
      expect(queryClient.getQueryData<WorkspaceFileTreeView>(options.queryKey)?.entries).toBe(
        cachedEntries,
      );
      failure = new Error("Git status failed");
      await expect(queryClient.fetchQuery(options)).rejects.toThrow("Git status failed");
      expect(inputs).toHaveLength(4);
      expect(queryClient.getQueryState(options.queryKey)?.status).toBe("error");
      failure = undefined;
      let recoveryCalls = 0;
      host.filesystemRefreshTree = async (input) => {
        inputs.push(input);
        recoveryCalls += 1;
        return recoveryCalls === 1 ? { kind: "reset_required", reason: "missing_view" } : snapshot;
      };
      const recovered = await queryClient.fetchQuery(options);
      expect(inputs.at(-1)?.mode).toBe("full");
      expect(inputs.at(-1)?.refreshId).not.toBe(inputs.at(-2)?.refreshId);
      expect(recovered.entries).toEqual(snapshot.entries);
      expect(queryClient.getQueryState(options.queryKey)?.status).toBe("success");
    } finally {
      queryClient.clear();
    }
  });

  test("queues later signals and refreshes selected content when the tree is unchanged", async () => {
    const queryClient = client();
    const started = deferred<void>(),
      release = deferred<void>();
    const inputs: WorkspaceFileTreeRefreshInput[] = [];
    let reads = 0,
      disk = "before",
      updates = 0;
    const host = createHost(
      async (input) => {
        inputs.push(input);
        if (input.mode === "full") return snapshot;
        updates += 1;
        if (updates === 1) {
          started.resolve();
          await release.promise;
        }
        return {
          kind: "unchanged",
          rootPath: "/repo",
          context,
          base: input.base,
          cursor: input.base,
        };
      },
      async () => {
        reads += 1;
        return disk;
      },
    );
    const treeOptions = workspaceFileTreeQueryOptions("/repo", null, host);
    const textOptions = workspaceTextFileQueryOptions("/repo", "file.txt", host);
    await Promise.all([queryClient.fetchQuery(treeOptions), queryClient.fetchQuery(textOptions)]);
    const tree = new QueryObserver(queryClient, { ...treeOptions, refetchOnMount: false }),
      text = new QueryObserver(queryClient, { ...textOptions, refetchOnMount: false });
    const stops = [tree.subscribe(() => {}), text.subscribe(() => {})];
    const ids: string[] = [];
    try {
      const a = refreshWorkspaceFileQueries(
        queryClient,
        "/repo",
        "incremental",
        gitJob(async () => {
          ids.push(workspaceReadContext(queryClient, "/repo")!.refreshId);
        }),
      );
      await started.promise;
      disk = "latest";
      const b = refreshWorkspaceFileQueries(queryClient, "/repo");
      const c = refreshWorkspaceFileQueries(queryClient, "/repo");
      expect(b).toBe(a);
      expect(c).toBe(a);
      release.resolve();
      await a;
      expect(inputs.map((input) => input.mode)).toEqual(["full", "incremental", "incremental"]);
      expect(inputs[1]?.refreshId).not.toBe(inputs[2]?.refreshId);
      expect(ids).toEqual([inputs[1]!.refreshId]);
      expect(reads).toBe(3);
      expect(queryClient.getQueryData<{ contents: string }>(textOptions.queryKey)?.contents).toBe(
        "latest",
      );
      expect(
        queryClient.getQueryData<WorkspaceFileTreeView>(treeOptions.queryKey)?.entries,
      ).toEqual(snapshot.entries);
    } finally {
      for (const stop of stops) stop();
      queryClient.clear();
    }
  });

  test("shares only post-write Git reads with the full file refresh", async () => {
    const queryClient = client();
    const inputs: WorkspaceFileTreeRefreshInput[] = [];
    const host = createHost(async (input) => {
      inputs.push(input);
      return snapshot;
    });
    const options = workspaceFileTreeQueryOptions("/repo", null, host);
    await queryClient.fetchQuery(options);
    const observer = new QueryObserver(queryClient, { ...options, refetchOnMount: false });
    const stop = observer.subscribe(() => {});
    let beforeWrite: string | undefined, afterWrite: string | undefined;
    try {
      await refreshWorkspaceFileQueries(
        queryClient,
        "/repo",
        "full",
        gitJob(async () => {
          beforeWrite = workspaceReadContext(queryClient, "/repo")?.refreshId;
          expect(inputs).toHaveLength(1);
          renewWorkspaceReadContext(queryClient, "/repo");
          afterWrite = workspaceReadContext(queryClient, "/repo")?.refreshId;
        }),
      );
      expect(beforeWrite).toBeDefined();
      expect(afterWrite).toBeDefined();
      expect(afterWrite).not.toBe(beforeWrite);
      expect(inputs[1]).toMatchObject({ mode: "full", refreshId: afterWrite });
      expect(workspaceReadContext(queryClient, "/repo")).toBeUndefined();
    } finally {
      stop();
      queryClient.clear();
    }
  });

  test("marks inactive views stale and rejects superseded selected-content reads", async () => {
    const queryClient = client();
    const old = deferred<string>(),
      started = deferred<void>();
    let reads = 0;
    const host = createHost(
      async () => snapshot,
      async () => {
        reads += 1;
        started.resolve();
        return old.promise;
      },
    );
    const treeOptions = workspaceFileTreeQueryOptions("/repo", null, host, "main");
    const textOptions = workspaceTextFileQueryOptions("/repo", "file.txt", host);
    try {
      await queryClient.fetchQuery(treeOptions);
      const pending = queryClient.fetchQuery(textOptions).catch(() => undefined);
      await started.promise;
      await refreshWorkspaceFileQueries(queryClient, "/repo");
      const saved: WorkspaceTextFileReadResult = {
        kind: "text",
        rootPath: "/repo",
        relativePath: "file.txt",
        contents: "saved",
        size: 5,
        mtimeMs: null,
        revision: "saved",
      };
      queryClient.setQueryData(filesystemQueryKeys.textFile("/repo", "file.txt"), saved);
      old.resolve("old content");
      await pending;
      expect(queryClient.getQueryData(textOptions.queryKey)).toMatchObject({ contents: "saved" });
      expect(reads).toBe(1);
      expect(queryClient.getQueryState(treeOptions.queryKey)?.isInvalidated).toBe(true);
      expect(filesystemQueryKeys.tree("/repo", null, "main")).not.toEqual(
        filesystemQueryKeys.tree("/repo", null, "other"),
      );
    } finally {
      queryClient.clear();
    }
  });
});
