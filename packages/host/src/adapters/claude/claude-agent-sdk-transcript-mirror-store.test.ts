import { describe, expect, test } from "bun:test";
import { createClaudeTranscriptMirrorStore } from "./claude-agent-sdk-transcript-mirror-store";

describe("createClaudeTranscriptMirrorStore", () => {
  test("stores SDK transcript entries by SessionKey and ignores duplicate UUID replays", async () => {
    const appendedCounts: number[] = [];
    const store = createClaudeTranscriptMirrorStore({
      onAppend: ({ entries }) => appendedCounts.push(entries.length),
    });
    store.registerSessionDirectory({ dir: "/repo", sessionId: "session-1" });
    const key = { projectKey: "repo", sessionId: "session-1" };

    await store.append(key, [
      { type: "assistant", uuid: "assistant-1", message: { role: "assistant", content: [] } },
    ]);
    await store.append(key, [
      { type: "assistant", uuid: "assistant-1", message: { role: "assistant", content: [] } },
      { type: "result", uuid: "result-1", result: "done" },
    ]);

    expect(await store.load(key)).toEqual([
      { type: "assistant", uuid: "assistant-1", message: { role: "assistant", content: [] } },
      { type: "result", uuid: "result-1", result: "done" },
    ]);
    expect(store.entriesForSession({ sessionId: "session-1" })).toHaveLength(2);
    expect(store.hasSession("session-1")).toBe(true);
    expect(appendedCounts).toEqual([1, 1]);
  });

  test("finds structured tool use results from mirrored SDK transcript entries", async () => {
    const store = createClaudeTranscriptMirrorStore();
    store.registerSessionDirectory({ dir: "/repo", sessionId: "session-1" });

    await store.append({ projectKey: "repo", sessionId: "session-1" }, [
      {
        type: "user",
        uuid: "user-1",
        parent_tool_use_id: "tool-edit-1",
        message: { role: "user", content: [] },
        toolUseResult: {
          filePath: "/repo/file.ts",
          structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [] }],
        },
      },
    ]);

    expect(
      store.findToolUseResult({ sessionId: "session-1", toolUseId: "tool-edit-1" })?.toolUseResult,
    ).toMatchObject({ filePath: "/repo/file.ts" });
    expect(store.findToolUseResult({ sessionId: "session-1", toolUseId: "missing" })).toBeNull();
  });

  test("indexes SDK-native snake_case tool use results", async () => {
    const store = createClaudeTranscriptMirrorStore();
    store.registerSessionDirectory({ dir: "/repo", sessionId: "session-1" });

    await store.append({ projectKey: "repo", sessionId: "session-1" }, [
      {
        type: "user",
        uuid: "user-1",
        parent_tool_use_id: "tool-write-1",
        message: { role: "user", content: [] },
        tool_use_result: {
          filePath: "/repo/file.ts",
        },
      },
    ]);

    expect(
      store.findToolUseResult({ sessionId: "session-1", toolUseId: "tool-write-1" })?.toolUseResult,
    ).toEqual({ filePath: "/repo/file.ts" });
  });

  test("does not mix subagent tool results into main-session live lookups", async () => {
    const store = createClaudeTranscriptMirrorStore();
    store.registerSessionDirectory({ dir: "/repo", sessionId: "session-1" });

    await store.append(
      { projectKey: "repo", sessionId: "session-1", subpath: "subagents/agent-worker" },
      [
        {
          type: "user",
          uuid: "subagent-user-1",
          parent_tool_use_id: "tool-edit-1",
          message: { role: "user", content: [] },
          toolUseResult: {
            filePath: "/repo/subagent.ts",
          },
        },
      ],
    );

    expect(
      store.findToolUseResult({ sessionId: "session-1", toolUseId: "tool-edit-1" }),
    ).toBeNull();
  });

  test("deletes every retained artifact and rejects late appends for a closed session", async () => {
    const store = createClaudeTranscriptMirrorStore();
    store.registerSessionDirectory({ dir: "/repo", sessionId: "session-1" });
    await store.append({ projectKey: "repo", sessionId: "session-1" }, [
      {
        type: "user",
        uuid: "user-1",
        parent_tool_use_id: "tool-edit-1",
        message: { role: "user", content: [] },
        toolUseResult: { filePath: "/repo/file.ts" },
      },
    ]);
    await store.append(
      { projectKey: "repo", sessionId: "session-1", subpath: "subagents/worker" },
      [
        {
          type: "assistant",
          uuid: "assistant-1",
          message: { role: "assistant", content: [] },
        },
      ],
    );

    store.deleteSession("session-1");
    await store.append({ projectKey: "repo", sessionId: "session-1" }, [
      { type: "result", uuid: "late-result", result: "late" },
    ]);

    expect(store.hasSession("session-1")).toBe(false);
    expect(store.entriesForSession({ sessionId: "session-1" })).toEqual([]);
    expect(
      store.findToolUseResult({ sessionId: "session-1", toolUseId: "tool-edit-1" }),
    ).toBeNull();
    expect(await store.load({ projectKey: "repo", sessionId: "session-1" })).toBeNull();
  });
});
