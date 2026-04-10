import { describe, expect, test } from "bun:test";
import type { DevServerGroupState, DevServerScriptState } from "@openducktor/contracts";
import {
  appendDevServerTerminalChunk,
  createDevServerTerminalBufferStore,
  getDevServerTerminalBuffer,
  MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS,
  replaceDevServerTerminalBuffer,
  syncDevServerTerminalBufferStore,
  trimDevServerTerminalChunks,
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
  bufferedTerminalChunks: [],
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
    const chunks = Array.from(
      { length: MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS + 2 },
      (_, index) => ({
        scriptId: "frontend",
        sequence: index,
        data: `line-${index}`,
        timestamp: `2026-03-25T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
      }),
    );

    const trimmed = trimDevServerTerminalChunks(chunks);

    expect(trimmed).toHaveLength(MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS);
    expect(trimmed[0]?.data).toBe("line-2");
    expect(trimmed.at(-1)?.data).toBe(`line-${MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS + 1}`);
  });

  test("stores raw ANSI chunks and rotates in ring order", () => {
    const store = createDevServerTerminalBufferStore();

    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      sequence: 0,
      data: "\u001b[32mready\u001b[0m\r\n",
      timestamp: "2026-03-25T10:00:00.000Z",
    });

    const initialBuffer = getDevServerTerminalBuffer(store, "frontend");
    expect(initialBuffer?.entries[0]?.data).toBe("\u001b[32mready\u001b[0m\r\n");

    for (let index = 1; index <= MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS; index += 1) {
      appendDevServerTerminalChunk(store, {
        scriptId: "frontend",
        sequence: index,
        data: `line-${index}`,
        timestamp: `2026-03-25T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
      });
    }

    const buffer = getDevServerTerminalBuffer(store, "frontend");
    expect(buffer?.entries.length).toBe(MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS);
    expect(buffer?.entries[0]?.data).toBe("line-1");
    expect(buffer?.entries.at(-1)?.data).toBe(`line-${MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS}`);
  });

  test("ignores duplicate or out-of-order chunks by sequence", () => {
    const store = createDevServerTerminalBufferStore();

    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      sequence: 4,
      data: "latest",
      timestamp: "2026-03-25T10:00:00.000Z",
    });
    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      sequence: 3,
      data: "older",
      timestamp: "2026-03-25T10:00:01.000Z",
    });

    const buffer = getDevServerTerminalBuffer(store, "frontend");
    expect(buffer?.entries).toHaveLength(1);
    expect(buffer?.entries[0]?.data).toBe("latest");
  });

  test("returned buffer snapshots stay stable after later appends", () => {
    const store = createDevServerTerminalBufferStore();

    for (let index = 0; index < MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS; index += 1) {
      appendDevServerTerminalChunk(store, {
        scriptId: "frontend",
        sequence: index,
        data: `line-${index}`,
        timestamp: `2026-03-25T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
      });
    }

    const previousSnapshot = getDevServerTerminalBuffer(store, "frontend");
    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      sequence: MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS,
      data: "latest",
      timestamp: "2026-03-25T10:01:00.000Z",
    });

    expect(previousSnapshot?.entries[0]?.data).toBe("line-0");
    expect(previousSnapshot?.entries.at(-1)?.data).toBe(
      `line-${MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS - 1}`,
    );
  });

  test("replaces and prunes script buffers when syncing state", () => {
    const store = createDevServerTerminalBufferStore();
    appendDevServerTerminalChunk(store, {
      scriptId: "stale",
      sequence: 0,
      data: "stale",
      timestamp: "2026-03-25T10:00:00.000Z",
    });

    syncDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            scriptId: "frontend",
            bufferedTerminalChunks: [
              {
                scriptId: "frontend",
                sequence: 7,
                data: "frontend failed\r\n",
                timestamp: "2026-03-25T10:01:00.000Z",
              },
            ],
          }),
        ],
      }),
    );

    expect(getDevServerTerminalBuffer(store, "stale")).toBeNull();
    const syncedBuffer = getDevServerTerminalBuffer(store, "frontend");
    expect(syncedBuffer?.entries[0]?.data).toBe("frontend failed\r\n");
    expect(syncedBuffer?.resetToken).toBe(1);

    replaceDevServerTerminalBuffer(store, "frontend", [
      {
        scriptId: "frontend",
        sequence: 8,
        data: "restarted\r\n",
        timestamp: "2026-03-25T10:02:00.000Z",
      },
    ]);

    const replacedBuffer = getDevServerTerminalBuffer(store, "frontend");
    expect(replacedBuffer?.entries[0]?.data).toBe("restarted\r\n");
    expect(replacedBuffer?.resetToken).toBe(2);
  });
});
