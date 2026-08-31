import { describe, expect, test } from "bun:test";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { listOpencodeRuntimeSnapshotSources } from "./live-session-snapshots";
import { createOpencodeSessionFixture } from "./opencode-protocol-test-fixtures";

describe("OpenCode live session snapshots", () => {
  test("does not read a directory that no longer exists", async () => {
    const calls: string[] = [];
    let readLocked = false;
    const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:12345" });
    const client: OpencodeClient = {
      ...baseClient,
      session: {
        ...baseClient.session,
        list: async () => ({
          data: [
            createOpencodeSessionFixture({
              id: "session-1",
              directory: "/missing-worktree",
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
    expect(
      await listOpencodeRuntimeSnapshotSources({
        createClient: () => client,
        runtimeEndpoint: "http://runtime-1",
        now: () => "2026-07-16T10:02:00.000Z",
        directoryExists: async () => {
          expect(readLocked).toBe(true);
          return false;
        },
        runDirectoryRead: async (_directory, read) => {
          readLocked = true;
          try {
            return await read();
          } finally {
            readLocked = false;
          }
        },
      }),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });
});
