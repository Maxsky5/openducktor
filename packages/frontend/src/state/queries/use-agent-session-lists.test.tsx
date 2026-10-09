import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createAgentSessionViewSync } from "./agent-session-view-sync";
import { agentSessionQueryKeys, removeAgentSessionListQueries } from "./agent-sessions";
import {
  useAgentSessionListQueries,
  useAgentSessionLists,
  type AgentSessionListTarget,
} from "./use-agent-session-lists";

const record: AgentSessionRecord = {
  externalSessionId: "session",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-10-04T12:00:00Z",
  selectedModel: null,
};
type Props = Omit<Parameters<typeof useAgentSessionLists>[0], "queryClient">;
const createHarness = (props: Props) => {
  let client!: QueryClient;
  const harness = createHookHarness(
    (input: Props) => {
      client = useQueryClient();
      return useAgentSessionLists({ ...input, queryClient: client });
    },
    props,
    { wrapper: IsolatedQueryWrapper },
  );
  return { ...harness, queryClient: () => client };
};

describe("useAgentSessionLists", () => {
  for (const disabled of [
    { repoPath: "/repo", enabled: false },
    { repoPath: null, enabled: true },
  ]) {
    test(`keeps reads disabled for ${JSON.stringify(disabled)}`, async () => {
      const batch = mock(async () => []);
      const harness = createHarness({
        ...disabled,
        taskIds: ["a"],
        readPort: { agentSessionsListForTasks: batch },
      });
      try {
        await harness.mount();
        expect(harness.getLatest()).toEqual({ data: { a: [] }, error: null, isPending: true });
        expect(batch).not.toHaveBeenCalled();
      } finally {
        await harness.unmount();
      }
    });
  }

  test("keeps tasks with the same ID in separate workspace batches through snapshot recovery", async () => {
    const batch = mock(async (repoPath: string, ids: string[]) =>
      ids.map((taskId) => ({
        taskId,
        agentSessions: [{ ...record, workingDirectory: repoPath }],
      })),
    );
    const targets: AgentSessionListTarget[] = [
      { repoPath: "/other-repo", taskId: " shared " },
      { repoPath: "/repo", taskId: "shared" },
      { repoPath: "/other-repo", taskId: "shared" },
    ];
    let client!: QueryClient;
    const port = { agentSessionsListForTasks: batch, tasksExistingIds: async () => [] };
    const harness = createHookHarness(
      () => {
        client = useQueryClient();
        return useAgentSessionListQueries({
          targets,
          enabled: true,
          queryClient: client,
          readPort: port,
          combine: (reads, readTargets) => ({
            pending: reads.some((read) => read.isPending || read.isFetching || read.isStale),
            data: readTargets.map((target, index) => ({
              repoPath: target.repoPath,
              taskId: target.taskId,
              records: reads[index]?.data,
            })),
          }),
        });
      },
      {},
      { wrapper: IsolatedQueryWrapper },
    );
    try {
      await harness.mount();
      await harness.waitFor((state) => !state.pending);
      expect(batch).toHaveBeenCalledTimes(2);
      const expected = [
        {
          repoPath: "/other-repo",
          taskId: "shared",
          records: [{ ...record, workingDirectory: "/other-repo" }],
        },
        {
          repoPath: "/repo",
          taskId: "shared",
          records: [{ ...record, workingDirectory: "/repo" }],
        },
      ];
      expect(harness.getLatest().data).toEqual(expected);
      const sync = createAgentSessionViewSync({
        queryClient: client,
        readPort: port,
        removeTaskSessions: () => {},
        refreshLiveSessions: async () => {},
      });
      await harness.run(async () => {
        sync.stopPending("snapshot");
        await sync.reconcileStreamSnapshot("/repo", ["shared"]);
      });
      await harness.waitFor((state) => !state.pending);
      expect(harness.getLatest().data).toEqual(expected);
      expect(batch).toHaveBeenCalledTimes(4);
      expect(batch.mock.calls.filter(([repoPath]) => repoPath === "/repo")).toHaveLength(2);
      expect(batch.mock.calls.filter(([repoPath]) => repoPath === "/other-repo")).toHaveLength(2);
    } finally {
      await harness.unmount();
    }
  });

  test("batches cold observers and keeps deleted tasks empty while they stay mounted", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `task-${i}`);
    const batch = mock(async (_repo: string, taskIds: string[]) =>
      taskIds.map((taskId) => ({ taskId, agentSessions: [record] })),
    );
    const props = {
      repoPath: "/repo",
      enabled: true,
      taskIds: ids,
      readPort: { agentSessionsListForTasks: batch },
    };
    const harness = createHarness(props);
    try {
      await harness.mount();
      await harness.waitFor((state) => !state.isPending);
      expect(batch).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().data["task-0"]).toEqual([record]);
      await harness.run(async () => {
        await removeAgentSessionListQueries(harness.queryClient(), "/repo", ["task-0"]);
      });
      await harness.update(props);
      expect(harness.getLatest().data["task-0"]).toEqual([]);
      expect(harness.getLatest().error).toBeNull();
      expect(batch).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("preserves failed mounted demand for a later event without retrying on render or remount", async () => {
    let fail = true;
    const batch = mock(async () => {
      if (fail) throw new Error("host unavailable");
      return [{ taskId: "a", agentSessions: [record] }];
    });
    const props: Props = {
      repoPath: "/repo",
      enabled: true,
      taskIds: ["a"],
      readPort: { agentSessionsListForTasks: batch },
    };
    const harness = createHarness(props);
    try {
      await harness.mount();
      await harness.waitFor((state) => state.error !== null);
      await harness.update(props);
      await harness.update({ ...props, enabled: false });
      await harness.update(props);
      expect(batch).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isPending).toBe(false);
      const sync = createAgentSessionViewSync({
        queryClient: harness.queryClient(),
        readPort: {
          ...props.readPort!,
          tasksExistingIds: async () => {
            throw new Error("unexpected task existence read");
          },
        },
        refreshLiveSessions: async () => {},
        removeTaskSessions: () => {},
      });
      fail = false;
      await harness.run(async () => {
        await sync.reconcileExternalEvent({
          kind: "tasks_updated",
          eventId: "new-event",
          repoPath: "/repo",
          taskIds: ["a"],
          removedTaskIds: [],
          statusChanges: [],
          taskSnapshots: [],
          emittedAt: "2026-10-04T12:00:00Z",
        });
      });
      await harness.waitFor((state) => !state.isPending && state.error === null);
      expect(harness.getLatest().data.a).toEqual([record]);
      expect(batch).toHaveBeenCalledTimes(2);
      await harness.update({ ...props, enabled: false });
      await sync.reconcileExternalEvent({
        kind: "tasks_updated",
        eventId: "disabled-event",
        repoPath: "/repo",
        taskIds: ["a"],
        removedTaskIds: [],
        statusChanges: [],
        taskSnapshots: [],
        emittedAt: "2026-10-04T12:00:00Z",
      });
      expect(batch).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps loaded records visible but incomplete during refresh and after failure", async () => {
    let release!: () => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refresh = false;
    const batch = mock(async () => {
      if (refresh) {
        started();
        await wait;
        throw new Error("refresh unavailable");
      }
      return [{ taskId: "a", agentSessions: [record] }];
    });
    const props: Props = {
      repoPath: "/repo",
      enabled: true,
      taskIds: ["a"],
      readPort: { agentSessionsListForTasks: batch },
    };
    const harness = createHarness(props);
    try {
      await harness.mount();
      await harness.waitFor((state) => !state.isPending);
      const sync = createAgentSessionViewSync({
        queryClient: harness.queryClient(),
        readPort: {
          ...props.readPort!,
          tasksExistingIds: async () => {
            throw new Error("unexpected task existence read");
          },
        },
        refreshLiveSessions: async () => {},
        removeTaskSessions: () => {},
      });
      refresh = true;
      const completion = sync
        .reconcileExternalEvent({
          kind: "tasks_updated",
          eventId: "refresh",
          repoPath: "/repo",
          taskIds: ["a"],
          removedTaskIds: [],
          statusChanges: [],
          taskSnapshots: [],
          emittedAt: "2026-10-04T12:00:00Z",
        })
        .then(
          () => null,
          (cause: unknown) => cause,
        );
      await start;
      await harness.waitFor((state) => state.isPending);
      expect(harness.getLatest().data.a).toEqual([record]);
      release();
      expect(await completion).toBeInstanceOf(Error);
      await harness.waitFor((state) => state.error !== null);
      expect(harness.getLatest().data.a).toEqual([record]);
      expect(
        harness.queryClient().getQueryState(agentSessionQueryKeys.list("/repo", "a"))
          ?.isInvalidated,
      ).toBe(true);
    } finally {
      release();
      await harness.unmount();
    }
  });
});
