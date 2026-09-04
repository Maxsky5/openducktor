import { describe, expect, test } from "bun:test";
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
    expect(result.failures).toEqual([]);
    expect(calls).toEqual(["status", "permissions", "questions"]);
    expect(reading).toBe(false);
  });

  test("requests the full session list when OpenCode fills its first page", async () => {
    const calls: string[] = [];
    const listLimits: number[] = [];
    const sessions = Array.from({ length: 101 }, (_, index) =>
      createOpencodeSessionFixture({
        id: `session-${index + 1}`,
        directory: "/worktree",
      }),
    );
    const baseClient = makeClient(calls);
    const client: OpencodeClient = {
      ...baseClient,
      session: {
        ...baseClient.session,
        list: async (input) => {
          const limit = input?.limit ?? 100;
          listLimits.push(limit);
          return { data: sessions.slice(0, limit), error: undefined };
        },
      },
    };

    const result = await listOpencodeRuntimeSnapshotSources({
      createClient: () => client,
      runtimeEndpoint: "http://runtime-1",
      now: () => "2026-07-16T10:02:00.000Z",
      readDirectory: async (_directory, read) => read(),
    });

    expect(listLimits).toEqual([100, 200]);
    expect(result.sources).toHaveLength(101);
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
      now: () => "2026-07-16T10:02:00.000Z",
      readDirectory: async (_directory, read) => read(),
    });

    expect(result.sources).toEqual([
      expect.objectContaining({ externalSessionId: "healthy-session" }),
    ]);
    expect(result.failures).toEqual([
      {
        externalSessionId: "failed-session",
        workingDirectory: "/failed",
        message: "status failed",
      },
    ]);
  });
});
