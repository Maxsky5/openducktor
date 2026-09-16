import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  dropWorkspaceQueries,
  loadWorkspaceCatalogFromQuery,
  markWorkspaceCachesChanged,
  workspaceQueryKeys,
} from "./workspace";

test("workspace catalog refresh replaces fresh cached data", async () => {
  const queryClient = new QueryClient();
  const cached = {
    openWorkspaces: [],
    closedWorkspaces: [],
    incompleteRemovals: [],
    onboardingCompleted: false,
  };
  const current = { ...cached, onboardingCompleted: true };
  const workspaceCatalogGet = mock(async () => current);
  queryClient.setQueryData(workspaceQueryKeys.catalog(), cached);

  const result = await loadWorkspaceCatalogFromQuery(queryClient, { workspaceCatalogGet });

  expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);
  expect(result).toBe(current);
  expect(queryClient.getQueryData<typeof current>(workspaceQueryKeys.catalog())).toEqual(current);
});

describe("dropWorkspaceQueries", () => {
  test("removes all workspace ID session queries and keeps other workspaces", async () => {
    const queryClient = new QueryClient();
    const targetKeys = [
      ["workspace-sessions", "ws", "active"],
      ["workspace-sessions", "ws", "archived"],
      ["workspace-session-archive-preview", "ws", "session-1"],
    ] as const;
    const otherKey = ["workspace-sessions", "other", "active"] as const;
    for (const key of targetKeys) queryClient.setQueryData(key, ["target"]);
    queryClient.setQueryData(otherKey, ["other"]);

    await dropWorkspaceQueries(queryClient, { workspaceId: "ws", repoPath: "/repos/ws" });

    for (const key of targetKeys) expect(queryClient.getQueryData(key)).toBeUndefined();
    expect(queryClient.getQueryData<string[]>(otherKey)).toEqual(["other"]);
  });

  test("does not let a canceled session read restore removed data", async () => {
    const queryClient = new QueryClient();
    const key = ["workspace-sessions", "ws", "active"] as const;
    let finish!: (value: string[]) => void;
    const read = queryClient
      .fetchQuery({
        queryKey: key,
        queryFn: () =>
          new Promise<string[]>((resolve) => {
            finish = resolve;
          }),
      })
      .catch(() => undefined);

    await Promise.resolve();
    const removal = dropWorkspaceQueries(queryClient, {
      workspaceId: "ws",
      repoPath: "/repos/ws",
    });
    finish(["stale"]);
    await removal;
    await read;

    expect(queryClient.getQueryData(key)).toBeUndefined();
  });
});

describe("markWorkspaceCachesChanged", () => {
  test("runs both invalidations and removes stale settings when the catalog refresh fails", async () => {
    const queryClient = new QueryClient();
    const invalidations: Array<{ queryKey: readonly unknown[]; throwOnError: boolean }> = [];
    queryClient.invalidateQueries = mock(async (filters, options) => {
      invalidations.push({
        queryKey: filters.queryKey ?? [],
        throwOnError: options?.throwOnError ?? false,
      });
      if (filters.queryKey?.[1] === "catalog") {
        throw new Error("catalog refresh failed");
      }
    });
    const removeQueries = mock(queryClient.removeQueries.bind(queryClient));
    queryClient.removeQueries = removeQueries;

    await expect(markWorkspaceCachesChanged(queryClient, { throwOnError: true })).rejects.toThrow(
      "catalog refresh failed",
    );

    expect(invalidations).toEqual([
      { queryKey: workspaceQueryKeys.catalog(), throwOnError: true },
      { queryKey: workspaceQueryKeys.settingsSnapshot(), throwOnError: true },
    ]);
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: workspaceQueryKeys.settingsSnapshot(),
      exact: true,
      type: "inactive",
    });
  });
});
