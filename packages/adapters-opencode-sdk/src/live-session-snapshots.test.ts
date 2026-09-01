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
    ).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("runs directory calls through the guarded read", async () => {
    const calls: string[] = [];
    let reading = false;
    const snapshots = await listOpencodeRuntimeSnapshotSources({
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

    expect(snapshots).toHaveLength(1);
    expect(calls).toEqual(["status", "permissions", "questions"]);
    expect(reading).toBe(false);
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

    await expect(listing).rejects.toThrow("status failed");
    expect(settledBeforeQuestionFinished).toBe(false);
    expect(reading).toBe(false);
    expect(calls).toEqual(["status", "permissions", "questions"]);
  });
});
