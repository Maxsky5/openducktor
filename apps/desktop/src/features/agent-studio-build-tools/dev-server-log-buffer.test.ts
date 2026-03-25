import { describe, expect, test } from "bun:test";
import type { DevServerGroupState, DevServerScriptState } from "@openducktor/contracts";
import {
  appendDevServerLogLine,
  createDevServerLogBufferStore,
  getDevServerLogBuffer,
  getDevServerLogEntryAt,
  MAX_BUFFERED_DEV_SERVER_LOG_LINES,
  replaceDevServerLogBuffer,
  syncDevServerLogBufferStore,
  trimDevServerLogLines,
} from "./dev-server-log-buffer";

const buildScript = (overrides: Partial<DevServerScriptState> = {}): DevServerScriptState => ({
  scriptId: "frontend",
  name: "Frontend",
  command: "bun run dev",
  status: "stopped",
  pid: null,
  startedAt: null,
  exitCode: null,
  lastError: null,
  bufferedLogLines: [],
  ...overrides,
});

const buildState = (overrides: Partial<DevServerGroupState> = {}): DevServerGroupState => ({
  repoPath: "/repo",
  taskId: "task-7",
  worktreePath: "/tmp/worktree/task-7",
  scripts: [buildScript()],
  updatedAt: "2026-03-25T10:00:00.000Z",
  ...overrides,
});

describe("dev-server-log-buffer", () => {
  test("trims snapshots to the configured maximum", () => {
    const lines = Array.from({ length: MAX_BUFFERED_DEV_SERVER_LOG_LINES + 2 }, (_, index) => ({
      scriptId: "frontend",
      stream: "stdout" as const,
      text: `line-${index}`,
      timestamp: `2026-03-25T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
    }));

    const trimmed = trimDevServerLogLines(lines);

    expect(trimmed).toHaveLength(MAX_BUFFERED_DEV_SERVER_LOG_LINES);
    expect(trimmed[0]?.text).toBe("line-2");
    expect(trimmed.at(-1)?.text).toBe(`line-${MAX_BUFFERED_DEV_SERVER_LOG_LINES + 1}`);
  });

  test("stores sanitized log entries and rotates in ring order", () => {
    const store = createDevServerLogBufferStore();

    appendDevServerLogLine(store, {
      scriptId: "frontend",
      stream: "stdout",
      text: "\u001b[32mready\u001b[0m",
      timestamp: "2026-03-25T10:00:00.000Z",
    });

    for (let index = 1; index <= MAX_BUFFERED_DEV_SERVER_LOG_LINES; index += 1) {
      appendDevServerLogLine(store, {
        scriptId: "frontend",
        stream: "stdout",
        text: `line-${index}`,
        timestamp: `2026-03-25T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
      });
    }

    const buffer = getDevServerLogBuffer(store, "frontend");
    expect(buffer?.size).toBe(MAX_BUFFERED_DEV_SERVER_LOG_LINES);
    expect(buffer).not.toBeNull();
    if (!buffer) {
      throw new Error("Expected frontend log buffer to exist.");
    }

    expect(getDevServerLogEntryAt(buffer, 0)?.text).toBe("line-1");
    expect(getDevServerLogEntryAt(buffer, buffer.size - 1)?.text).toBe(
      `line-${MAX_BUFFERED_DEV_SERVER_LOG_LINES}`,
    );
  });

  test("replaces and prunes script buffers when syncing state", () => {
    const store = createDevServerLogBufferStore();
    appendDevServerLogLine(store, {
      scriptId: "stale",
      stream: "stdout",
      text: "stale",
      timestamp: "2026-03-25T10:00:00.000Z",
    });

    syncDevServerLogBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            scriptId: "frontend",
            bufferedLogLines: [
              {
                scriptId: "frontend",
                stream: "stderr",
                text: "frontend failed",
                timestamp: "2026-03-25T10:01:00.000Z",
              },
            ],
          }),
        ],
      }),
    );

    expect(getDevServerLogBuffer(store, "stale")).toBeNull();
    const syncedBuffer = getDevServerLogBuffer(store, "frontend");
    expect(syncedBuffer).not.toBeNull();
    if (!syncedBuffer) {
      throw new Error("Expected frontend log buffer after sync.");
    }

    expect(getDevServerLogEntryAt(syncedBuffer, 0)?.text).toBe("frontend failed");

    replaceDevServerLogBuffer(store, "frontend", [
      {
        scriptId: "frontend",
        stream: "system",
        text: "restarted",
        timestamp: "2026-03-25T10:02:00.000Z",
      },
    ]);

    const replacedBuffer = getDevServerLogBuffer(store, "frontend");
    expect(replacedBuffer).not.toBeNull();
    if (!replacedBuffer) {
      throw new Error("Expected frontend log buffer after replace.");
    }

    expect(getDevServerLogEntryAt(replacedBuffer, 0)?.text).toBe("restarted");
  });
});
