import { expect, mock, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { waitForExpectation } from "../test-support/wait-for-expectation";
import {
  invalidateRuntimeKindQueries,
  refetchFailedRuntimeQueries,
} from "./runtime-query-invalidation";

const repoCatalogKey = ["runtime-catalog", "catalog", "/repo", "opencode", "/repo"];
const otherWorkspaceCatalogKey = ["runtime-catalog", "catalog", "/other", "opencode", "/other/wt"];
const fileSearchKey = [
  "runtime-catalog",
  "file-search",
  "/repo",
  "opencode",
  "/repo/worktree",
  "file",
];
const sessionKeys = [
  ["agent-session-todos", "/repo", "opencode", "/repo/worktree", "session"],
  ["agent-session-history", "/other", "opencode", "/other", "session"],
  ["agent-session-context", "/repo", "opencode", "/repo", "session", null, null, null],
];
const importKey = ["workspace-session-external", "workspace-1", "opencode", "catalog-1", "", null];

test("a stopped kind invalidates its reads in every workspace and cancels the old read", async () => {
  const client = new QueryClient();
  for (const key of [...sessionKeys, repoCatalogKey, otherWorkspaceCatalogKey, fileSearchKey]) {
    client.setQueryData(key, ["cached"]);
  }
  client.setQueryData(importKey, ["cached"]);
  client.setQueryData(["checks", "task-store", "/repo"], ["cached"]);
  const oldRead = Promise.withResolvers<string[]>();
  const pending = client
    .fetchQuery({ queryKey: sessionKeys[0]!, queryFn: () => oldRead.promise })
    .catch(() => undefined);

  await invalidateRuntimeKindQueries(client, "opencode", "stopped");
  oldRead.resolve(["obsolete"]);

  expect(await pending).toEqual(["cached"]);
  for (const key of [...sessionKeys, repoCatalogKey, otherWorkspaceCatalogKey, importKey]) {
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  }
  expect(client.getQueryState(["checks", "task-store", "/repo"])?.isInvalidated).toBe(false);
  expect(client.getQueryData<string[]>(repoCatalogKey)).toEqual(["cached"]);
  expect(client.getQueryState(fileSearchKey)?.isInvalidated).toBe(false);
});

test("a ready kind refetches an active catalog read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(repoCatalogKey, ["cached"]);
  const readCatalog = mock(async () => ["replacement"]);
  const observer = new QueryObserver(client, { queryKey: repoCatalogKey, queryFn: readCatalog });
  const unsubscribe = observer.subscribe(() => {});

  try {
    await invalidateRuntimeKindQueries(client, "opencode", "ready");

    await waitForExpectation(() => expect(readCatalog).toHaveBeenCalledTimes(1));
    await waitForExpectation(() =>
      expect(client.getQueryData<string[]>(repoCatalogKey)).toEqual(["replacement"]),
    );
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("a change of one kind leaves the reads of another kind untouched", async () => {
  const client = new QueryClient();
  const otherKeys = [
    ["runtime-catalog", "catalog", "/repo", "codex", "/repo"],
    ["agent-session-todos", "/repo", "codex", "/repo", "session"],
    ["workspace-session-external", "workspace-1", "codex", "catalog-1", "", null],
  ];
  for (const key of otherKeys) client.setQueryData(key, ["cached"]);

  await invalidateRuntimeKindQueries(client, "opencode", "stopped");

  for (const key of otherKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});

test("a return reads again only the shown runtime reads that failed", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const todosKey = sessionKeys[0]!;
  const checksKey = ["checks", "task-store", "/repo"];
  const reads = { catalog: 0, todos: 0, checks: 0, hidden: 0 };
  const observe = (queryKey: unknown[], read: keyof typeof reads, fails: () => boolean) => {
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: async () => {
        reads[read] += 1;
        if (fails()) throw new Error(`${read} unavailable`);
        return [read];
      },
      staleTime: Infinity,
    });
    return observer.subscribe(() => {});
  };
  let failing = true;
  const unsubscribes = [
    observe(repoCatalogKey, "catalog", () => false),
    observe(todosKey, "todos", () => failing),
    observe(checksKey, "checks", () => failing),
  ];
  // A failed read without a view stays as it is.
  await client
    .fetchQuery({
      queryKey: otherWorkspaceCatalogKey,
      queryFn: async () => {
        reads.hidden += 1;
        throw new Error("hidden unavailable");
      },
    })
    .catch(() => undefined);

  try {
    await waitForExpectation(() => expect(client.getQueryState(todosKey)?.status).toBe("error"));
    await waitForExpectation(() => expect(client.getQueryState(checksKey)?.status).toBe("error"));
    failing = false;

    await refetchFailedRuntimeQueries(client);

    expect(reads).toEqual({ catalog: 1, todos: 2, checks: 1, hidden: 1 });
    expect(client.getQueryState(todosKey)?.error).toBeNull();
    expect(client.getQueryData(todosKey)).toEqual(["todos"]);
  } finally {
    for (const unsubscribe of unsubscribes) unsubscribe();
    client.clear();
  }
});

test("a runtime read that runs at a return or a wake and then fails reads again", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const todosKey = sessionKeys[0]!;
  const sleepingRead = Promise.withResolvers<string[]>();
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: todosKey,
    queryFn: () => {
      reads += 1;
      return reads === 1 ? sleepingRead.promise : Promise.resolve(["after wake"]);
    },
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});

  try {
    await waitForExpectation(() => expect(reads).toBe(1));
    const wake = refetchFailedRuntimeQueries(client);
    // The read that ran during sleep times out after the wake.
    sleepingRead.reject(new Error("timed out"));
    await wake;

    expect(reads).toBe(2);
    expect(client.getQueryState(todosKey)?.error).toBeNull();
    expect(client.getQueryData(todosKey)).toEqual(["after wake"]);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("a slow running runtime read does not delay the re-read of another failed read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const catalogRead = Promise.withResolvers<string[]>();
  const todosKey = sessionKeys[0]!;
  let todosReads = 0;
  const unsubscribes = [
    new QueryObserver(client, {
      queryKey: repoCatalogKey,
      queryFn: () => catalogRead.promise,
    }).subscribe(() => {}),
    new QueryObserver(client, {
      queryKey: todosKey,
      queryFn: async () => {
        todosReads += 1;
        if (todosReads === 1) throw new Error("todos unavailable");
        return ["todos"];
      },
    }).subscribe(() => {}),
  ];

  try {
    await waitForExpectation(() => expect(client.getQueryState(todosKey)?.status).toBe("error"));
    const refetch = refetchFailedRuntimeQueries(client);

    await waitForExpectation(() => expect(client.getQueryData(todosKey)).toEqual(["todos"]));
    expect(client.getQueryState(repoCatalogKey)?.fetchStatus).toBe("fetching");
    catalogRead.resolve(["catalog"]);
    await refetch;
  } finally {
    for (const unsubscribe of unsubscribes) unsubscribe();
    client.clear();
  }
});
