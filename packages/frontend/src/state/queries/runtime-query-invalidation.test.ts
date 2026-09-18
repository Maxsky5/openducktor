import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  invalidateRuntimeQueries,
  invalidateRuntimeSessionQueries,
} from "./runtime-query-invalidation";

test("runtime replacement invalidates its catalogs and session reads, including old in-flight reads", async () => {
  const client = new QueryClient();
  const keys = [
    ["runtime-catalog", "catalog", "/repo", "opencode", "/repo"],
    ["runtime-catalog", "catalog", "/repo", "opencode", "/repo/worktree"],
    ["runtime-catalog", "file-search", "/repo", "opencode", "/repo/worktree", "file"],
    ["agent-session-todos", "/repo", "opencode", "/repo/worktree", "session"],
    ["agent-session-history", "/repo", "opencode", "/repo/worktree", "session"],
  ];
  const unrelated = ["runtime-catalog", "catalog", "/repo", "codex", "/repo"];
  for (const key of [...keys, unrelated]) client.setQueryData(key, ["cached"]);
  const oldRead = Promise.withResolvers<string[]>();
  const pending = client
    .fetchQuery({ queryKey: keys[0]!, queryFn: () => oldRead.promise })
    .catch(() => undefined);
  await invalidateRuntimeQueries(client, { repoPath: "/repo", runtimeKind: "opencode" }, "stopped");
  oldRead.resolve(["obsolete"]);
  expect(await pending).toEqual(["cached"]);
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  expect(client.getQueryData<string[]>(keys[0]!)).toEqual(["cached"]);
  await invalidateRuntimeQueries(client, { repoPath: "/repo", runtimeKind: "opencode" }, "ready");
  await expect(
    client.fetchQuery({ queryKey: keys[0]!, queryFn: async () => ["replacement"] }),
  ).resolves.toEqual(["replacement"]);
});

test("session invalidation keeps cached catalogs for a reused runtime", async () => {
  const client = new QueryClient();
  const catalogKeys = [
    ["runtime-catalog", "catalog", "/repo", "opencode", "/repo"],
    ["runtime-catalog", "catalog", "/repo", "opencode", "/repo/worktree"],
    ["runtime-catalog", "file-search", "/repo", "opencode", "/repo/worktree", "file"],
  ];
  const sessionKeys = [
    ["agent-session-todos", "/repo", "opencode", "/repo/worktree", "session"],
    ["agent-session-history", "/repo", "opencode", "/repo/worktree", "session"],
  ];
  for (const key of [...catalogKeys, ...sessionKeys]) client.setQueryData(key, ["cached"]);

  await invalidateRuntimeSessionQueries(
    client,
    { repoPath: "/repo", runtimeKind: "opencode" },
    "ready",
  );

  for (const key of catalogKeys) {
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(client.getQueryData<string[]>(key)).toEqual(["cached"]);
  }
  for (const key of sessionKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});
