import { describe, expect, test } from "bun:test";
import { BdPersistence } from "./bd-persistence";
import type { BdRuntimeClient } from "./bd-runtime-client";
import type { RawIssue } from "./contracts";

type FakeClientState = {
  calls: string[][];
  ensureInitializedCalls: number;
};

const createClient = (
  handlers: {
    runBdJson: (args: string[]) => Promise<unknown>;
    updateTask?: (args: string[]) => Promise<unknown>;
    ensureInitialized?: () => Promise<void>;
  },
  state: FakeClientState,
): BdRuntimeClient => {
  return {
    runBdJson: async (args: string[]) => {
      state.calls.push([...args]);
      return handlers.runBdJson(args);
    },
    updateTask: async (args: string[]) => {
      state.calls.push([...args]);
      if (handlers.updateTask) {
        return handlers.updateTask(args);
      }
      return handlers.runBdJson(args);
    },
    ensureInitialized: async () => {
      state.ensureInitializedCalls += 1;
      if (handlers.ensureInitialized) {
        await handlers.ensureInitialized();
      }
    },
  } as unknown as BdRuntimeClient;
};

describe("BdPersistence", () => {
  test("ensureInitialized delegates to runtime client", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => ({}),
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");
    await persistence.ensureInitialized();

    expect(state.ensureInitializedCalls).toBe(1);
  });

  test("showRawIssue validates payload and returns first issue", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const issue: RawIssue = {
      id: "task-1",
      title: "Task 1",
      status: "open",
      issue_type: "feature",
      metadata: {},
    };

    const client = createClient(
      {
        runBdJson: async () => [issue],
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");
    const result = await persistence.showRawIssue("task-1");

    expect(result).toEqual(issue);
    expect(state.calls).toEqual([["show", "task-1"]]);
  });

  test("showRawIssue throws when issue is missing", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => [],
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");

    await expect(persistence.showRawIssue("missing")).rejects.toThrow("Task not found: missing");
  });

  test("showRawIssue throws when payload entry is not an object", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => [null],
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");
    await expect(persistence.showRawIssue("task-1")).rejects.toThrow(
      "Invalid issue payload for task task-1",
    );
  });

  test("listTasks maps issues to task cards and respects metadata namespace", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => [
          {
            id: "task-1",
            title: "Task 1",
            status: "in_progress",
            issue_type: "feature",
            metadata: {
              openducktor: {
                qaRequired: false,
              },
            },
          },
          "ignored",
        ],
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");
    const tasks = await persistence.listTasks();

    expect(tasks).toEqual([
      {
        id: "task-1",
        title: "Task 1",
        status: "in_progress",
        issueType: "feature",
        aiReviewEnabled: false,
      },
    ]);
    expect(state.calls).toEqual([["list", "--all", "-n", "500"]]);
  });

  test("listTasks throws when bd payload is not an array", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => ({ invalid: true }),
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");
    await expect(persistence.listTasks()).rejects.toThrow("bd list did not return an array");
  });

  test("listTasks surfaces invalid Beads task status instead of coercing it", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => [
          {
            id: "task-2",
            title: "Broken status",
            status: { raw: "open" },
            issue_type: "task",
            metadata: {},
          },
        ],
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");

    await expect(persistence.listTasks()).rejects.toThrow(
      'Invalid Beads status for task task-2: received {"raw":"open"}.',
    );
  });

  test("listTasks surfaces invalid Beads issue types instead of coercing them", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => [
          {
            id: "task-3",
            title: "Broken issue type",
            status: "open",
            issue_type: "decision",
            metadata: {},
          },
        ],
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");

    await expect(persistence.listTasks()).rejects.toThrow(
      'Invalid Beads issue type for task task-3: received "decision".',
    );
  });

  test("listTasks ignores non-task Beads issue types before strict parsing", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => [
          {
            id: "task-4",
            title: "Task 4",
            status: "open",
            issue_type: "task",
            metadata: {},
          },
          {
            id: "event-1",
            title: "Calendar event",
            status: "open",
            issue_type: "event",
            metadata: {},
          },
          {
            id: "gate-1",
            title: "Review gate",
            status: "open",
            issue_type: "gate",
            metadata: {},
          },
        ],
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");

    await expect(persistence.listTasks()).resolves.toEqual([
      {
        id: "task-4",
        title: "Task 4",
        status: "open",
        issueType: "task",
        aiReviewEnabled: true,
      },
    ]);
  });

  test("writeNamespace updates metadata under namespace key", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => ({}),
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");
    await persistence.writeNamespace(
      "task-1",
      {
        external: { keep: true },
      },
      {
        documents: {
          spec: [],
        },
      },
    );

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]?.slice(0, 3)).toEqual(["update", "task-1", "--metadata"]);
    const metadataJson = state.calls[0]?.[3] ?? "{}";
    expect(JSON.parse(metadataJson)).toEqual({
      external: { keep: true },
      openducktor: {
        documents: {
          spec: [],
        },
      },
    });
  });

  test("updateTask writes status and metadata in a single bd update call", async () => {
    const state: FakeClientState = {
      calls: [],
      ensureInitializedCalls: 0,
    };
    const client = createClient(
      {
        runBdJson: async () => ({}),
      },
      state,
    );

    const persistence = new BdPersistence(client, "openducktor");
    await persistence.updateTask("task-1", {
      metadataRoot: { openducktor: { documents: { qaReports: [] } } },
      status: "human_review",
    });

    expect(state.calls).toEqual([
      [
        "update",
        "task-1",
        "--status",
        "human_review",
        "--metadata",
        JSON.stringify({ openducktor: { documents: { qaReports: [] } } }),
      ],
    ]);
  });
});
