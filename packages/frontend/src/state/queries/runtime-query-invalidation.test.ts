import { expect, mock, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import {
  invalidateRuntimeQueries,
  invalidateRuntimeSessionQueries,
} from "./runtime-query-invalidation";

const repoCatalogKey = ["runtime-catalog", "catalog", "/repo", "opencode", "/repo"];
const worktreeCatalogKey = ["runtime-catalog", "catalog", "/repo", "opencode", "/repo/worktree"];
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
  ["agent-session-history", "/repo", "opencode", "/repo/worktree", "session"],
];

test("a stopped runtime invalidates session and catalog reads and cancels the old read", async () => {
  const client = new QueryClient();
  for (const key of [...sessionKeys, repoCatalogKey, worktreeCatalogKey, fileSearchKey]) {
    client.setQueryData(key, ["cached"]);
  }
  const oldRead = Promise.withResolvers<string[]>();
  const pending = client
    .fetchQuery({ queryKey: sessionKeys[0]!, queryFn: () => oldRead.promise })
    .catch(() => undefined);

  await invalidateRuntimeQueries(client, { repoPath: "/repo", runtimeKind: "opencode" }, "stopped");
  oldRead.resolve(["obsolete"]);

  expect(await pending).toEqual(["cached"]);
  for (const key of [...sessionKeys, repoCatalogKey, worktreeCatalogKey]) {
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  }
  expect(client.getQueryData<string[]>(repoCatalogKey)).toEqual(["cached"]);
  expect(client.getQueryState(fileSearchKey)?.isInvalidated).toBe(false);
});

test("a ready runtime refetches an active catalog read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(repoCatalogKey, ["cached"]);
  const readCatalog = mock(async () => ["replacement"]);
  const observer = new QueryObserver(client, { queryKey: repoCatalogKey, queryFn: readCatalog });
  const unsubscribe = observer.subscribe(() => {});

  try {
    await invalidateRuntimeQueries(client, { repoPath: "/repo", runtimeKind: "opencode" }, "ready");

    await waitFor(() => expect(readCatalog).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(client.getQueryData<string[]>(repoCatalogKey)).toEqual(["replacement"]),
    );
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("a runtime change leaves another runtime and its catalogs untouched", async () => {
  const client = new QueryClient();
  const otherCatalogKey = ["runtime-catalog", "catalog", "/repo", "codex", "/repo"];
  const otherSessionKey = ["agent-session-todos", "/repo", "codex", "/repo", "session"];
  for (const key of [otherCatalogKey, otherSessionKey]) client.setQueryData(key, ["cached"]);

  await invalidateRuntimeQueries(client, { repoPath: "/repo", runtimeKind: "opencode" }, "ready");

  expect(client.getQueryState(otherCatalogKey)?.isInvalidated).toBe(false);
  expect(client.getQueryState(otherSessionKey)?.isInvalidated).toBe(false);
});

test("the runtime ensure callback invalidates session reads and keeps catalogs cached", async () => {
  const client = new QueryClient();
  const catalogKeys = [repoCatalogKey, worktreeCatalogKey];
  for (const key of [...catalogKeys, ...sessionKeys]) client.setQueryData(key, ["cached"]);

  await invalidateRuntimeSessionQueries(
    client,
    { repoPath: "/repo", runtimeKind: "opencode" },
    "stopped",
  );

  for (const key of sessionKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of catalogKeys) {
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(client.getQueryData<string[]>(key)).toEqual(["cached"]);
  }

  await invalidateRuntimeSessionQueries(
    client,
    { repoPath: "/repo", runtimeKind: "opencode" },
    "ready",
  );
  await expect(
    client.fetchQuery({ queryKey: sessionKeys[1]!, queryFn: async () => ["replacement"] }),
  ).resolves.toEqual(["replacement"]);
});
