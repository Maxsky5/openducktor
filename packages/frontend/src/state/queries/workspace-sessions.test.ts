import { workspaceComparisonChoices } from "../workspace-comparison-choices";
import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  updateWorkspaceSessionQueries,
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
} from "./workspace-sessions";

const session = (id: string, updatedAt = 1000): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1000,
  updatedAt,
  speed: "standard",
  archivedAt: null,
});

describe("Workspace Session query cache", () => {
  test("a cancelled read that later rejects cannot remove the next read's event buffer", async () => {
    const client = new QueryClient();
    const old = Promise.withResolvers<WorkspaceSession[]>();
    const next = Promise.withResolvers<WorkspaceSession[]>();
    let reads = 0;
    const options = workspaceSessionListQueryOptions("A", false, {
      workspaceSessionListActive: () => (++reads === 1 ? old.promise : next.promise),
      workspaceSessionListArchived: async () => [],
    });
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
    const client = new QueryClient();
    const first = session("workspace-A");
    const second = session("workspace-B");
    client.setQueryData(workspaceSessionQueryKeys.list("A", false), [first]);
    client.setQueryData(workspaceSessionQueryKeys.list("B", false), [second]);
    const port = {
      workspaceSessionListActive: () => new Promise<WorkspaceSession[]>(() => {}),
      workspaceSessionListArchived: async () => [],
    };
    const observer = new QueryObserver(client, workspaceSessionListQueryOptions("A", false, port));
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(observer.getCurrentResult().data).toEqual([first]);
      observer.setOptions(workspaceSessionListQueryOptions("B", false, port));
      expect(observer.getCurrentResult().data).toEqual([second]);
      observer.setOptions(workspaceSessionListQueryOptions("A", false, port));
      expect(observer.getCurrentResult().data).toEqual([first]);
      expect(observer.getCurrentResult().isFetching).toBe(true);
      expect(observer.getCurrentResult().isPending).toBe(false);
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  test("only a confirmed archive clears its session choice, including an unloaded list", () => {
    const client = new QueryClient();
    const store = workspaceComparisonChoices(client);
    const first = { workspaceId: "A", sessionId: "first" };
    const other = { workspaceId: "B", sessionId: "first" };
    const choice = { branch: "release" };
    store.set(first, choice);
    store.set(other, choice);
    updateWorkspaceSessionQueries(client, "A", session("first"));
    expect(store.get(first)).toEqual(choice);
    updateWorkspaceSessionQueries(client, "A", { ...session("first"), archivedAt: 3000 });
    expect(store.get(first)).toBeUndefined();
    expect(store.get(other)).toEqual(choice);
    client.clear();
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
    const client = new QueryClient();
    try {
      const entry = session("first");
      client.setQueryData(workspaceSessionQueryKeys.list("A", false), [entry]);
      let resolveRead!: (value: WorkspaceSession[]) => void;
      const read = client
        .fetchQuery(
          workspaceSessionListQueryOptions("A", false, {
            workspaceSessionListActive: () =>
              new Promise((resolve) => {
                resolveRead = resolve;
              }),
            workspaceSessionListArchived: async () => [],
          }),
        )
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
    const client = new QueryClient();
    const entry = session("first");
    let resolveOld!: (value: WorkspaceSession[]) => void;
    let reads = 0;
    const observer = new QueryObserver(
      client,
      workspaceSessionListQueryOptions("A", false, {
        workspaceSessionListActive: () => {
          reads += 1;
          if (reads === 1)
            return new Promise((resolve) => {
              resolveOld = resolve;
            });
          return Promise.resolve([entry]);
        },
        workspaceSessionListArchived: async () => [],
      }),
    );
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
      const client = new QueryClient();
      const baseline = Promise.withResolvers<WorkspaceSession[]>();
      const entry = session("first");
      const updated = { ...entry, manualTitle: "Updated at commit" };
      const key = workspaceSessionQueryKeys.list("A", false);
      if (cached) client.setQueryData<WorkspaceSession[]>(key, [entry]);
      try {
        const read = client.fetchQuery(
          workspaceSessionListQueryOptions("A", false, {
            workspaceSessionListActive: () => baseline.promise,
            workspaceSessionListArchived: async () => [],
          }),
        );
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
