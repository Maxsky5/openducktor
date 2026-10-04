import { describe, expect, test } from "bun:test";
import type { AgentSessionScope } from "@openducktor/contracts";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { listOpencodeRuntimeSnapshotSources } from "./live-session-snapshots";
import { createOpencodeSessionFixture } from "./opencode-protocol-test-fixtures";

describe("OpenCode live session snapshots", () => {
  const makeClient = (calls: string[]): OpencodeClient => {
    const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:12345" });
    return {
      ...baseClient,
      session: {
        ...baseClient.session,
        get: async ({ sessionID, directory }) => ({
          data: createOpencodeSessionFixture({
            id: sessionID,
            directory: directory ?? "/worktree",
          }),
          error: undefined,
        }),
        children: async () => ({ data: [], error: undefined }),
        list: async () => ({
          data: [
            createOpencodeSessionFixture({
              id: "session-1",
              directory: "/worktree",
            }),
          ],
          error: undefined,
        }),
        status: async () => {
          calls.push("status");
          return { data: {}, error: undefined };
        },
      },
      permission: {
        ...baseClient.permission,
        list: async () => {
          calls.push("permissions");
          return { data: [], error: undefined };
        },
      },
      question: {
        ...baseClient.question,
        list: async () => {
          calls.push("questions");
          return { data: [], error: undefined };
        },
      },
    };
  };

  test("skips a directory when the guarded read returns null", async () => {
    const calls: string[] = [];
    expect(
      await listOpencodeRuntimeSnapshotSources({
        createClient: () => makeClient(calls),
        runtimeEndpoint: "http://runtime-1",
        roots: [
          {
            repoPath: "/worktree",
            runtimeKind: "opencode",
            externalSessionId: "session-1",
            workingDirectory: "/worktree",
          },
        ],
        now: () => "2026-07-16T10:02:00.000Z",
        readDirectory: async () => null,
      }),
    ).toEqual({ sources: [], failures: [] });
    expect(calls).toEqual([]);
  });

  test("runs directory calls through the guarded read", async () => {
    const calls: string[] = [];
    let reading = false;
    const result = await listOpencodeRuntimeSnapshotSources({
      createClient: () => makeClient(calls),
      runtimeEndpoint: "http://runtime-1",
      roots: [
        {
          repoPath: "/worktree",
          runtimeKind: "opencode",
          externalSessionId: "session-1",
          workingDirectory: "/worktree",
        },
      ],
      now: () => "2026-07-16T10:02:00.000Z",
      readDirectory: async (_directory, read) => {
        reading = true;
        try {
          return await read();
        } finally {
          reading = false;
        }
      },
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.sessionAssociation).toEqual({ kind: "unbound" });
    expect(result.failures).toEqual([]);
    expect(calls).toEqual(["status", "permissions", "questions"]);
    expect(reading).toBe(false);
  });

  test("does not enumerate or admit unowned sessions", async () => {
    const calls: string[] = [];
    const client = makeClient(calls);
    client.session.list = async () => {
      throw new Error("Broad enumeration is forbidden");
    };
    const result = await listOpencodeRuntimeSnapshotSources({
      createClient: () => client,
      runtimeEndpoint: "http://runtime-1",
      now: () => "2026-07-16T10:02:00.000Z",
      roots: [],
      readDirectory: async (_directory, read) => read(),
    });
    expect(result).toEqual({ sources: [], failures: [] });
    expect(calls).toEqual([]);
  });

  test.each<{
    name: string;
    scopes: [AgentSessionScope, AgentSessionScope];
    owners: [string, string];
  }>([
    {
      name: "tasks",
      scopes: [
        { kind: "workflow", taskId: "task-a", role: "builder" },
        { kind: "workflow", taskId: "task-b", role: "builder" },
      ],
      owners: ["task 'task-a'", "task 'task-b'"],
    },
    {
      name: "roles",
      scopes: [
        { kind: "workflow", taskId: "task-a", role: "qa" },
        { kind: "workflow", taskId: "task-a", role: "builder" },
      ],
      owners: ["role 'qa'", "role 'builder'"],
    },
    {
      name: "repository and workflow scopes",
      scopes: [{ kind: "repository" }, { kind: "workflow", taskId: "task-a", role: "builder" }],
      owners: ["repository scope", "task 'task-a'"],
    },
  ])("rejects conflicting $name before attachment in either order", async ({ scopes, owners }) => {
    for (const orderedScopes of [scopes, [...scopes].reverse()]) {
      const attached: string[] = [];
      const result = await listOpencodeRuntimeSnapshotSources({
        createClient: () => makeClient([]),
        runtimeEndpoint: "http://runtime-1",
        roots: [
          ...orderedScopes.map((sessionScope) => ({
            repoPath: "/worktree",
            runtimeKind: "opencode" as const,
            externalSessionId: "conflicting-session",
            workingDirectory: "/worktree",
            sessionScope,
          })),
          {
            repoPath: "/worktree",
            runtimeKind: "opencode",
            externalSessionId: "healthy-session",
            workingDirectory: "/worktree",
            sessionScope: { kind: "repository" },
          },
        ],
        attachSession: async (session) => {
          attached.push(session.id);
        },
        now: () => "2026-07-16T10:02:00.000Z",
        readDirectory: async (_directory, read) => read(),
      });
      expect(attached).toEqual(["healthy-session"]);
      expect(result.sources).toEqual([
        expect.objectContaining({ externalSessionId: "healthy-session" }),
      ]);
      expect(result.failures).toHaveLength(2);
      for (const failure of result.failures) {
        expect(failure.externalSessionId).toBe("conflicting-session");
        expect(failure.message).toContain("Conflicting owners");
        for (const owner of owners) expect(failure.message).toContain(owner);
      }
    }
  });

  test("attaches matching duplicate roots once", async () => {
    const attached: string[] = [];
    const root = {
      repoPath: "/worktree",
      runtimeKind: "opencode" as const,
      externalSessionId: "session-1",
      workingDirectory: "/worktree",
      sessionScope: { kind: "workflow" as const, taskId: "task-a", role: "qa" as const },
    };
    const result = await listOpencodeRuntimeSnapshotSources({
      createClient: () => makeClient([]),
      runtimeEndpoint: "http://runtime-1",
      roots: [root, { ...root, sessionScope: { ...root.sessionScope } }],
      attachSession: async (session) => {
        attached.push(session.id);
      },
      now: () => "2026-07-16T10:02:00.000Z",
      readDirectory: async (_directory, read) => read(),
    });
    expect(attached).toEqual(["session-1"]);
    expect(result.sources).toEqual([
      expect.objectContaining({ sessionAssociation: root.sessionScope }),
    ]);
    expect(result.failures).toEqual([]);
  });

  test("keeps the directory guard until all started calls settle", async () => {
    const calls: string[] = [];
    let finishQuestion = () => undefined;
    const questionGate = new Promise<void>((resolve) => {
      finishQuestion = resolve;
    });
    const baseClient = makeClient(calls);
    const client: OpencodeClient = {
      ...baseClient,
      session: {
        ...baseClient.session,
        status: async () => {
          calls.push("status");
          throw new Error("status failed");
        },
      },
      question: {
        ...baseClient.question,
        list: async () => {
          calls.push("questions");
          await questionGate;
          return { data: [], error: undefined };
        },
      },
    };
    let reading = false;
    let settled = false;
    const listing = listOpencodeRuntimeSnapshotSources({
      createClient: () => client,
      runtimeEndpoint: "http://runtime-1",
      roots: [
        {
          repoPath: "/worktree",
          runtimeKind: "opencode",
          externalSessionId: "session-1",
          workingDirectory: "/worktree",
        },
      ],
      now: () => "2026-07-16T10:02:00.000Z",
      readDirectory: async (_directory, read) => {
        reading = true;
        try {
          return await read();
        } finally {
          reading = false;
        }
      },
    }).finally(() => {
      settled = true;
    });
    await Bun.sleep(0);
    const settledBeforeQuestionFinished = settled;
    finishQuestion();

    await expect(listing).resolves.toEqual({
      sources: [],
      failures: [
        {
          repoPath: "/worktree",
          externalSessionId: "session-1",
          workingDirectory: "/worktree",
          message: "status failed",
        },
      ],
    });
    expect(settledBeforeQuestionFinished).toBe(false);
    expect(reading).toBe(false);
    expect(calls).toEqual(["status", "permissions", "questions"]);
  });

  test("keeps snapshots from healthy directories when another directory read fails", async () => {
    const baseClient = makeClient([]);
    const client: OpencodeClient = {
      ...baseClient,
      session: {
        ...baseClient.session,
        list: async () => ({
          data: [
            createOpencodeSessionFixture({ id: "healthy-session", directory: "/healthy" }),
            createOpencodeSessionFixture({ id: "failed-session", directory: "/failed" }),
          ],
          error: undefined,
        }),
        status: async ({ directory }) => {
          if (directory === "/failed") {
            throw new Error("status failed");
          }
          return { data: {}, error: undefined };
        },
      },
    };

    const result = await listOpencodeRuntimeSnapshotSources({
      createClient: () => client,
      runtimeEndpoint: "http://runtime-1",
      roots: [
        {
          repoPath: "/healthy",
          runtimeKind: "opencode",
          externalSessionId: "healthy-session",
          workingDirectory: "/healthy",
        },
        {
          repoPath: "/healthy",
          runtimeKind: "opencode",
          externalSessionId: "failed-session",
          workingDirectory: "/failed",
        },
      ],
      now: () => "2026-07-16T10:02:00.000Z",
      readDirectory: async (_directory, read) => read(),
    });

    expect(result.sources).toEqual([
      expect.objectContaining({ externalSessionId: "healthy-session" }),
    ]);
    expect(result.failures).toEqual([
      {
        repoPath: "/healthy",
        externalSessionId: "failed-session",
        workingDirectory: "/failed",
        message: "status failed",
      },
    ]);
  });
});
