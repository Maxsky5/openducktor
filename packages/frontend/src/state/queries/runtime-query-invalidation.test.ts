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
const mcpCheckKey = ["checks", "workspace-runtime-mcp", "/other"];

test("a stopped kind invalidates its reads in every workspace and cancels the old read", async () => {
  const client = new QueryClient();
  for (const key of [...sessionKeys, repoCatalogKey, otherWorkspaceCatalogKey, fileSearchKey]) {
    client.setQueryData(key, ["cached"]);
  }
  client.setQueryData(importKey, ["cached"]);
  client.setQueryData(mcpCheckKey, ["connected on the old runtime"]);
  client.setQueryData(["checks", "task-store", "/repo"], ["cached"]);
  const oldRead = Promise.withResolvers<string[]>();
  const pending = client
    .fetchQuery({ queryKey: sessionKeys[0]!, queryFn: () => oldRead.promise })
    .catch(() => undefined);

  await invalidateRuntimeKindQueries(client, "opencode", "stopped");
  oldRead.resolve(["obsolete"]);

  expect(await pending).toEqual(["cached"]);
  for (const key of [
    ...sessionKeys,
    repoCatalogKey,
    otherWorkspaceCatalogKey,
    importKey,
    mcpCheckKey,
  ]) {
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
