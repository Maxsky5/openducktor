import { expect, mock, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { invalidateRuntimeKindQueries } from "./runtime-query-invalidation";

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

    await waitFor(() => expect(readCatalog).toHaveBeenCalledTimes(1));
    await waitFor(() =>
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

test("a ready runtime retries failed session metadata reads and keeps successful ones", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const failedKey = [
    "agent-session-metadata",
    "/repo",
    "opencode",
    "/repo",
    "failed",
    "t",
    "build",
  ];
  const loadedKey = [
    "agent-session-metadata",
    "/repo",
    "opencode",
    "/repo",
    "loaded",
    "t",
    "build",
  ];
  const otherRuntimeKey = ["agent-session-metadata", "/repo", "codex", "/repo", "other", "t", "qa"];
  const reads = { failed: 0, loaded: 0, other: 0 };
  const observe = (key: string[], name: keyof typeof reads, fail: boolean) =>
    new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        reads[name] += 1;
        if (fail && reads[name] === 1) throw new Error("runtime unavailable");
        return { lastActivityAt: reads[name] };
      },
    }).subscribe(() => {});
  const unsubscribers = [
    observe(failedKey, "failed", true),
    observe(loadedKey, "loaded", false),
    observe(otherRuntimeKey, "other", true),
  ];

  try {
    await waitFor(() => expect(client.getQueryState(failedKey)?.status).toBe("error"));
    await waitFor(() => expect(client.getQueryState(otherRuntimeKey)?.status).toBe("error"));
    await waitFor(() => expect(client.getQueryState(loadedKey)?.status).toBe("success"));

    await invalidateRuntimeSessionQueries(
      client,
      { repoPath: "/repo", runtimeKind: "opencode" },
      "ready",
    );

    await waitFor(() => expect(client.getQueryState(failedKey)?.status).toBe("success"));
    expect(reads).toEqual({ failed: 2, loaded: 1, other: 1 });
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
  }
});

test("a ready runtime restarts a session metadata read that is still in flight", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["agent-session-metadata", "/repo", "opencode", "/repo", "pending", "t", "build"];
  let reads = 0;
  let failFirstRead: (cause: Error) => void = () => {};
  const unsubscribe = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: () => {
      reads += 1;
      if (reads > 1) return Promise.resolve({ lastActivityAt: reads });
      return new Promise<never>((_resolve, reject) => {
        failFirstRead = reject;
      });
    },
  }).subscribe(() => {});

  try {
    await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe("fetching"));

    await invalidateRuntimeSessionQueries(
      client,
      { repoPath: "/repo", runtimeKind: "opencode" },
      "ready",
    );
    failFirstRead(new Error("runtime unavailable"));

    await waitFor(() => expect(client.getQueryState(key)?.status).toBe("success"));
    expect(reads).toBe(2);
  } finally {
    unsubscribe();
  }
});
