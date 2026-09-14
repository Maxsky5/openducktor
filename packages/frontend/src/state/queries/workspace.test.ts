import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { dropWorkspaceQueries } from "./workspace";

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
