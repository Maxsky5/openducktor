import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../test-support/test-client-connection";
import {
  updateWorkspaceSessionQueries,
  workspaceSessionIdsQueryOptions,
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
} from "./workspace-sessions";
import { workspaceSessionArchivePreviewQueryOptions } from "./workspace-session-archive";
import { observeWorkspaceSessionRecords } from "./workspace-session-updates";
import { connectionReconnectedEvent } from "../recovery/connection-control-events";
import type { WorkspaceSessionUpdateListener } from "../connection/host-connection";

const session = (id: string, updatedAt = 1000): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  targetBranch: null,
  createdAt: 1000,
  updatedAt,
  archivedAt: null,
});

describe("Workspace Session query cache", () => {
  test("a lost record stream invalidates archive previews after reconnect", () => {
    const listeners: WorkspaceSessionUpdateListener[] = [];
    const { queryClient: client } = createTestClientConnection({
      host: createTestHostConnection({
        subscribeWorkspaceSessionUpdates: async (listener) => {
          listeners.push(listener);
          return () => {};
        },
      }),
    });
    const key = workspaceSessionArchivePreviewQueryOptions("workspace", "chat").queryKey;
    client.setQueryData(key, {
      branchName: "feature/chat",
      worktreeExists: true,
      hasUncommittedChanges: false,
      sharedWith: [],
      taskOwners: [],
    });
    const stop = observeWorkspaceSessionRecords(client, () => {});
    try {
      const publish = listeners[0];
      if (!publish) throw new Error("Expected a workspace session subscription.");
      publish(connectionReconnectedEvent(false, { hostChanged: false, missedEventNames: [] }));
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      publish(connectionReconnectedEvent(true, { hostChanged: false, missedEventNames: [] }));
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    } finally {
      stop();
      client.clear();
    }
  });

  test("archive previews refresh for ownership and title changes, and keep activity updates local", () => {
    const client = new QueryClient();
    const entry = session("source");
    const key = workspaceSessionArchivePreviewQueryOptions(
      "other-workspace",
      "other-chat",
    ).queryKey;
    const preview = {
      branchName: "feature/chat",
      worktreeExists: true,
      hasUncommittedChanges: false,
      sharedWith: [{ workspaceId: "A", sessionId: entry.id, title: "Untitled session" }],
      taskOwners: [],
    };
    client.setQueryData(workspaceSessionQueryKeys.list("A", false), [entry]);
    try {
      for (const changed of [
        { ...entry, updatedAt: 2000, lastActivityAt: 2000 },
        {
          ...entry,
          selectedModel: { runtimeKind: "codex" as const, providerId: "codex", modelId: "model" },
        },
      ]) {
        client.setQueryData(key, preview);
        updateWorkspaceSessionQueries(client, "A", changed);
        expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      }
      for (const changed of [
        { ...entry, manualTitle: "Renamed source" },
        { ...entry, archivedAt: 3000 },
        {
          ...entry,
          executionTarget: { kind: "local_repo_root" as const, workingDirectory: "/other" },
        },
        session("new-owner"),
      ]) {
        client.setQueryData(key, preview);
        updateWorkspaceSessionQueries(client, "A", changed);
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      }
    } finally {
      client.clear();
    }
  });

  test.each(["pending", "handoff"] as const)(
    "keeps chat IDs from events during the %s of a complete read",
    async (phase) => {
      const baseline = Promise.withResolvers<string[]>();
      const { queryClient: client } = createTestClientConnection({
        client: { workspaceSessionIdsList: () => baseline.promise },
      });
      const options = workspaceSessionIdsQueryOptions("A");
      client.setQueryData(workspaceSessionQueryKeys.ids("B"), ["other"]);
      try {
        const read = client.fetchQuery(options);
        if (phase === "handoff") {
          baseline.resolve(["existing"]);
          await Promise.resolve();
        }
        updateWorkspaceSessionQueries(client, "A", {
          ...session("new"),
          archivedAt: 2000,
        });
        expect(client.getQueryData<string[]>(options.queryKey)).toBeUndefined();
        if (phase === "pending") baseline.resolve(["existing"]);
        await read;
        expect(client.getQueryData<string[]>(options.queryKey)).toEqual(["existing", "new"]);
        updateWorkspaceSessionQueries(client, "A", session("new"));
        expect(client.getQueryData<string[]>(options.queryKey)).toEqual(["existing", "new"]);
        updateWorkspaceSessionQueries(client, "A", session("late"));
        expect(client.getQueryData<string[]>(options.queryKey)).toEqual([
          "existing",
          "new",
          "late",
        ]);
        expect(client.getQueryData<string[]>(workspaceSessionQueryKeys.ids("B"))).toEqual([
          "other",
        ]);
      } finally {
        client.clear();
      }
    },
  );

  test("a record event cannot make a failed complete ID read current", async () => {
    let unavailable = true;
    const { queryClient: client } = createTestClientConnection({
      client: {
        workspaceSessionIdsList: async () => {
          if (unavailable) throw new Error("IDs unavailable");
          return ["existing", "new"];
        },
      },
    });
    const key = workspaceSessionQueryKeys.ids("A");
    client.setQueryData(key, ["existing"]);
    try {
      await client.fetchQuery(workspaceSessionIdsQueryOptions("A")).catch(() => undefined);
      updateWorkspaceSessionQueries(client, "A", session("new"));
      expect(client.getQueryState(key)?.status).toBe("error");
      expect(client.getQueryData<string[]>(key)).toEqual(["existing"]);
      unavailable = false;
      await client.fetchQuery(workspaceSessionIdsQueryOptions("A"));
      expect(client.getQueryState(key)?.status).toBe("success");
      expect(client.getQueryData<string[]>(key)).toEqual(["existing", "new"]);
    } finally {
      client.clear();
    }
  });

  test("a cancelled read that later rejects cannot remove the next read's event buffer", async () => {
    const old = Promise.withResolvers<WorkspaceSession[]>();
    const next = Promise.withResolvers<WorkspaceSession[]>();
    let reads = 0;
    const { queryClient: client } = createTestClientConnection({
      client: {
        workspaceSessionListActive: () => (++reads === 1 ? old.promise : next.promise),
      },
    });
    const options = workspaceSessionListQueryOptions("A", false);
    try {
      const cancelled = client.fetchQuery(options).catch(() => undefined);
      await client.cancelQueries({ queryKey: options.queryKey });
      await cancelled;
      const current = client.fetchQuery(options);
      old.reject(new Error("Old host read failed"));
      await Promise.resolve();
      const entry = session("current");
      updateWorkspaceSessionQueries(client, "A", entry);
      next.resolve([]);
      await current;
      expect(client.getQueryData<WorkspaceSession[]>(options.queryKey)).toEqual([entry]);
    } finally {
      client.clear();
    }
  });

  test("returning to a Workspace shows its cached list while its background read is pending", () => {
    const { queryClient: client } = createTestClientConnection({
      client: {
        workspaceSessionListActive: () => new Promise<WorkspaceSession[]>(() => {}),
      },
    });
    const first = session("workspace-A");
    const second = session("workspace-B");
    client.setQueryData(workspaceSessionQueryKeys.list("A", false), [first]);
    client.setQueryData(workspaceSessionQueryKeys.list("B", false), [second]);
    const observer = new QueryObserver(client, workspaceSessionListQueryOptions("A", false));
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(observer.getCurrentResult().data).toEqual([first]);
      observer.setOptions(workspaceSessionListQueryOptions("B", false));
      expect(observer.getCurrentResult().data).toEqual([second]);
      observer.setOptions(workspaceSessionListQueryOptions("A", false));
      expect(observer.getCurrentResult().data).toEqual([first]);
      expect(observer.getCurrentResult().isFetching).toBe(true);
      expect(observer.getCurrentResult().isPending).toBe(false);
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  test("updates only the owning workspace and moves archive membership without changing activity", () => {
    const client = new QueryClient();
    try {
      const first = session("first");
      const second = session("second", 2000);
      client.setQueryData(workspaceSessionQueryKeys.list("A", false), [second, first]);
      client.setQueryData(workspaceSessionQueryKeys.list("A", true), []);
      client.setQueryData(workspaceSessionQueryKeys.list("B", false), [first]);
      updateWorkspaceSessionQueries(client, "A", { ...first, archivedAt: 3000 });
      expect(
        client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("A", false)),
      ).toEqual([second]);
      expect(
        client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("A", true)),
      ).toEqual([{ ...first, archivedAt: 3000 }]);
      expect(
        client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("B", false)),
      ).toEqual([first]);
      updateWorkspaceSessionQueries(client, "A", first);
      expect(
        client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("A", false)),
      ).toEqual([second, first]);
      expect(
        client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("A", true)),
      ).toEqual([]);
    } finally {
      client.clear();
    }
  });

  test("a late background read cannot overwrite newer metadata", async () => {
    let resolveRead!: (value: WorkspaceSession[]) => void;
    const { queryClient: client } = createTestClientConnection({
      client: {
        workspaceSessionListActive: () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      },
    });
    try {
      const entry = session("first");
      client.setQueryData(workspaceSessionQueryKeys.list("A", false), [entry]);
      const read = client
        .fetchQuery(workspaceSessionListQueryOptions("A", false))
        .catch(() => undefined);
      const updated = { ...entry, manualTitle: "New name" };
      updateWorkspaceSessionQueries(client, "A", updated);
      resolveRead([entry]);
      await read;
      expect(
        client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("A", false)),
      ).toEqual([updated]);
    } finally {
      client.clear();
    }
  });

  test("an event during the initial read joins the complete baseline without another read", async () => {
    const entry = session("first");
    let resolveOld!: (value: WorkspaceSession[]) => void;
    let reads = 0;
    const { queryClient: client } = createTestClientConnection({
      client: {
        workspaceSessionListActive: () => {
          reads += 1;
          if (reads === 1)
            return new Promise((resolve) => {
              resolveOld = resolve;
            });
          return Promise.resolve([entry]);
        },
      },
    });
    const observer = new QueryObserver(client, workspaceSessionListQueryOptions("A", false));
    let ready!: () => void;
    const loaded = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const unsubscribe = observer.subscribe((result) => {
      if (result.isSuccess) ready();
    });
    try {
      updateWorkspaceSessionQueries(client, "A", entry);
      resolveOld([]);
      await loaded;
      expect(reads).toBe(1);
      expect(
        client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("A", false)),
      ).toEqual([entry]);
      expect(workspaceSessionListQueryOptions("A").gcTime).toBe(Infinity);
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  test.each([false, true])(
    "keeps metadata between read completion and cache commit, cached=%s",
    async (cached) => {
      const baseline = Promise.withResolvers<WorkspaceSession[]>();
      const { queryClient: client } = createTestClientConnection({
        client: { workspaceSessionListActive: () => baseline.promise },
      });
      const entry = session("first");
      const updated = { ...entry, manualTitle: "Updated at commit" };
      const key = workspaceSessionQueryKeys.list("A", false);
      if (cached) client.setQueryData<WorkspaceSession[]>(key, [entry]);
      try {
        const read = client.fetchQuery(workspaceSessionListQueryOptions("A", false));
        baseline.resolve(cached ? [entry] : []);
        await Promise.resolve();
        updateWorkspaceSessionQueries(client, "A", updated);
        await read;
        expect(client.getQueryData<WorkspaceSession[]>(key)).toEqual([updated]);
      } finally {
        client.clear();
      }
    },
  );
});
