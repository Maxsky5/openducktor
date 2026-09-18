import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { invalidateRuntimeSessionQueries } from "./runtime-query-invalidation";

test("runtime lifecycle invalidates session reads and keeps cached catalogs", async () => {
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

  const oldRead = Promise.withResolvers<string[]>();
  const pending = client
    .fetchQuery({ queryKey: sessionKeys[0]!, queryFn: () => oldRead.promise })
    .catch(() => undefined);
  await invalidateRuntimeSessionQueries(
    client,
    { repoPath: "/repo", runtimeKind: "opencode" },
    "stopped",
  );
  oldRead.resolve(["obsolete"]);
  expect(await pending).toEqual(["cached"]);

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

test("session invalidation leaves another runtime and its catalogs untouched", async () => {
  const client = new QueryClient();
  const unrelated = ["runtime-catalog", "catalog", "/repo", "codex", "/repo"];
  const sessionKey = ["agent-session-todos", "/repo", "codex", "/repo", "session"];
  for (const key of [unrelated, sessionKey]) client.setQueryData(key, ["cached"]);

  await invalidateRuntimeSessionQueries(
    client,
    { repoPath: "/repo", runtimeKind: "opencode" },
    "ready",
  );

  expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(false);
});
