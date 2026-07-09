import { describe, expect, test } from "bun:test";
import type {
  DevServerGroupState,
  DevServerScriptState,
  DevServerTerminalChunk,
} from "@openducktor/contracts";
import {
  appendDevServerTerminalChunk,
  createDevServerTerminalBufferStore,
  getDevServerTerminalBuffer,
  getDevServerTerminalBufferReplacementContext,
  MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS,
  reconcileDevServerTerminalBufferStore,
  replaceDevServerTerminalBuffer,
  shouldReplaceDevServerTerminalBufferFromScript,
  syncDevServerTerminalBufferStore,
  trimDevServerTerminalChunks,
} from "./dev-server-log-buffer";

const testRunOrder = (runId: string) => ({
  hostInstanceId: "host-1",
  generation: Number(runId.split(":").at(-1)),
});

const buildScript = (overrides: Partial<DevServerScriptState> = {}): DevServerScriptState => {
  const bufferedRun = overrides.bufferedTerminalChunks?.[0];
  const runId =
    overrides.runId ??
    bufferedRun?.runId ??
    (overrides.pid === null || overrides.pid === undefined ? null : "frontend:1");
  return {
    scriptId: "frontend",
    name: "Frontend",
    command: "bun run dev",
    status: "stopped",
    runId,
    runOrder: bufferedRun?.runOrder ?? (runId === null ? null : testRunOrder(runId)),
    pid: null,
    startedAt: null,
    exitCode: null,
    lastError: null,
    bufferedTerminalChunks: [],
    ...overrides,
  };
};

const buildState = (overrides: Partial<DevServerGroupState> = {}): DevServerGroupState => ({
  repoPath: "/repo",
  taskId: "task-7",
  worktreePath: "/tmp/worktree/task-7",
  scripts: [buildScript()],
  updatedAt: "2026-03-25T10:00:00.000Z",
  ...overrides,
});

const buildChunk = (
  sequence: number,
  overrides: Partial<DevServerTerminalChunk> = {},
): DevServerTerminalChunk => {
  const runId = overrides.runId ?? "frontend:1";
  return {
    scriptId: "frontend",
    runId,
    runOrder: testRunOrder(runId),
    sequence,
    data: `line-${sequence}\r\n`,
    timestamp: `2026-03-25T10:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
    ...overrides,
  };
};

describe("dev-server-log-buffer", () => {
  test("trims snapshots to the configured maximum", () => {
    const chunks = Array.from(
      { length: MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS + 2 },
      (_, index) => ({
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
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
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
      sequence: 0,
      data: "\u001b[32mready\u001b[0m\r\n",
      timestamp: "2026-03-25T10:00:00.000Z",
    });

    const initialBuffer = getDevServerTerminalBuffer(store, "frontend");
    expect(initialBuffer?.entries[0]?.data).toBe("\u001b[32mready\u001b[0m\r\n");

    for (let index = 1; index <= MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS; index += 1) {
      appendDevServerTerminalChunk(store, {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
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
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
      sequence: 4,
      data: "latest",
      timestamp: "2026-03-25T10:00:00.000Z",
    });
    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
      sequence: 3,
      data: "older",
      timestamp: "2026-03-25T10:00:01.000Z",
    });

    const buffer = getDevServerTerminalBuffer(store, "frontend");
    expect(buffer?.entries).toHaveLength(1);
    expect(buffer?.entries[0]?.data).toBe("latest");
  });

  test("accepts lower sequence chunks from a new run after resetting old output", () => {
    const store = createDevServerTerminalBufferStore();

    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
      sequence: 100,
      data: "old-run",
      timestamp: "2026-03-25T10:00:00.000Z",
    });
    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      runId: "frontend:2",
      runOrder: { hostInstanceId: "host-1", generation: 2 },
      sequence: 0,
      data: "new-run",
      timestamp: "2026-03-25T10:01:00.000Z",
    });

    const buffer = getDevServerTerminalBuffer(store, "frontend");
    expect(buffer?.entries).toHaveLength(1);
    expect(buffer?.entries[0]?.data).toBe("new-run");
    expect(buffer?.lastSequence).toBe(0);
  });

  test("accepts sequential live chunks after replay gaps", () => {
    const store = createDevServerTerminalBufferStore();

    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
      sequence: 1,
      data: "oversized-live",
      timestamp: "2026-03-25T10:00:00.000Z",
    });
    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
      sequence: 2,
      data: "later-live",
      timestamp: "2026-03-25T10:00:01.000Z",
    });

    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => entry.data),
    ).toEqual(["oversized-live", "later-live"]);
  });

  test("returned buffer snapshots stay stable after later appends", () => {
    const store = createDevServerTerminalBufferStore();

    for (let index = 0; index < MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS; index += 1) {
      appendDevServerTerminalChunk(store, {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: index,
        data: `line-${index}`,
        timestamp: `2026-03-25T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
      });
    }

    const previousSnapshot = getDevServerTerminalBuffer(store, "frontend");
    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
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
      runId: "stale:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
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
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
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
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 8,
        data: "restarted\r\n",
        timestamp: "2026-03-25T10:02:00.000Z",
      },
    ]);

    const replacedBuffer = getDevServerTerminalBuffer(store, "frontend");
    expect(replacedBuffer?.entries[0]?.data).toBe("restarted\r\n");
    expect(replacedBuffer?.resetToken).toBe(2);
  });

  test("replaces a populated buffer when an authoritative snapshot is newer", () => {
    const store = createDevServerTerminalBufferStore();
    replaceDevServerTerminalBuffer(store, "frontend", [
      {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 0,
        data: "stale\r\n",
        timestamp: "2026-03-25T10:00:00.000Z",
      },
    ]);

    const nextScript = buildScript({
      bufferedTerminalChunks: [
        {
          scriptId: "frontend",
          runId: "frontend:1",
          runOrder: { hostInstanceId: "host-1", generation: 1 },
          sequence: 1,
          data: "fresh\r\n",
          timestamp: "2026-03-25T10:01:00.000Z",
        },
      ],
    });

    expect(
      shouldReplaceDevServerTerminalBufferFromScript(
        getDevServerTerminalBufferReplacementContext(store, "frontend"),
        nextScript,
      ),
    ).toBe(true);
  });

  test("accepts a missing same-run replay prefix without replacing newer local output", () => {
    const store = createDevServerTerminalBufferStore();
    replaceDevServerTerminalBuffer(store, "frontend", [
      {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 2,
        data: "local-live\r\n",
        timestamp: "2026-03-25T10:02:00.000Z",
      },
    ]);

    const staleScript = buildScript({
      bufferedTerminalChunks: [
        {
          scriptId: "frontend",
          runId: "frontend:1",
          runOrder: { hostInstanceId: "host-1", generation: 1 },
          sequence: 1,
          data: "stale\r\n",
          timestamp: "2026-03-25T10:01:00.000Z",
        },
      ],
    });

    expect(
      shouldReplaceDevServerTerminalBufferFromScript(
        getDevServerTerminalBufferReplacementContext(store, "frontend"),
        staleScript,
      ),
    ).toBe(true);
  });

  test("merges a delayed same-run replay prefix with an already observed live suffix", () => {
    const store = createDevServerTerminalBufferStore();
    syncDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: [
              buildChunk(10, {
                data: "live-10\r\n",
                timestamp: "2026-03-25T10:00:10.000Z",
              }),
            ],
          }),
        ],
      }),
    );

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: Array.from({ length: 10 }, (_, sequence) =>
              buildChunk(sequence, { data: `replay-${sequence}\r\n` }),
            ),
          }),
        ],
      }),
    );

    expect(didChange).toBe(true);
    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => entry.data),
    ).toEqual([
      "replay-0\r\n",
      "replay-1\r\n",
      "replay-2\r\n",
      "replay-3\r\n",
      "replay-4\r\n",
      "replay-5\r\n",
      "replay-6\r\n",
      "replay-7\r\n",
      "replay-8\r\n",
      "replay-9\r\n",
      "live-10\r\n",
    ]);
  });

  test("merges same-run replay after a live chunk arrives before state hydration", () => {
    const store = createDevServerTerminalBufferStore();
    appendDevServerTerminalChunk(
      store,
      buildChunk(10, {
        data: "live-10\r\n",
        timestamp: "2026-03-25T10:00:10.000Z",
      }),
    );

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: Array.from({ length: 10 }, (_, sequence) =>
              buildChunk(sequence, { data: `replay-${sequence}\r\n` }),
            ),
          }),
        ],
      }),
    );

    expect(didChange).toBe(true);
    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => entry.data),
    ).toEqual([
      "replay-0\r\n",
      "replay-1\r\n",
      "replay-2\r\n",
      "replay-3\r\n",
      "replay-4\r\n",
      "replay-5\r\n",
      "replay-6\r\n",
      "replay-7\r\n",
      "replay-8\r\n",
      "replay-9\r\n",
      "live-10\r\n",
    ]);
  });

  test("rejects stale previous-run replay after a new-run live chunk arrives before state", () => {
    const store = createDevServerTerminalBufferStore();
    appendDevServerTerminalChunk(
      store,
      buildChunk(5, {
        runId: "frontend:2",
        runOrder: { hostInstanceId: "host-1", generation: 2 },
        data: "new-run-5\r\n",
        timestamp: "2026-03-25T10:10:05.000Z",
      }),
    );

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: Array.from({ length: 101 }, (_, sequence) =>
              buildChunk(sequence, { data: `old-run-${sequence}\r\n` }),
            ),
          }),
        ],
      }),
    );
    appendDevServerTerminalChunk(
      store,
      buildChunk(6, {
        runId: "frontend:2",
        runOrder: { hostInstanceId: "host-1", generation: 2 },
        data: "new-run-6\r\n",
        timestamp: "2026-03-25T10:10:06.000Z",
      }),
    );

    expect(didChange).toBe(false);
    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => entry.data),
    ).toEqual(["new-run-5\r\n", "new-run-6\r\n"]);
  });

  test("keeps current-run live output when a delayed previous-run replay arrives", () => {
    const store = createDevServerTerminalBufferStore();
    syncDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
            pid: 5252,
            startedAt: "2026-03-25T10:10:00.000Z",
            bufferedTerminalChunks: [
              buildChunk(10, {
                runId: "frontend:2",
                runOrder: { hostInstanceId: "host-1", generation: 2 },
                data: "new-run-10\r\n",
                timestamp: "2026-03-25T10:10:10.000Z",
              }),
            ],
          }),
        ],
      }),
    );

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: Array.from({ length: 10 }, (_, sequence) =>
              buildChunk(sequence, { data: `old-run-${sequence}\r\n` }),
            ),
          }),
        ],
      }),
    );

    expect(didChange).toBe(false);
    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => entry.data),
    ).toEqual(["new-run-10\r\n"]);
  });

  test("rejects a delayed previous-run live chunk after a newer run is visible", () => {
    const store = createDevServerTerminalBufferStore();
    appendDevServerTerminalChunk(
      store,
      buildChunk(0, {
        runId: "frontend:2",
        runOrder: testRunOrder("frontend:2"),
        data: "new-run\r\n",
      }),
    );
    appendDevServerTerminalChunk(
      store,
      buildChunk(100, {
        runId: "frontend:1",
        runOrder: testRunOrder("frontend:1"),
        data: "delayed-old-run\r\n",
      }),
    );

    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => entry.data),
    ).toEqual(["new-run\r\n"]);
  });

  test("accepts a replacement host epoch once and rejects delayed state from the retired host", () => {
    const store = createDevServerTerminalBufferStore();
    syncDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            runId: "host-1-run",
            runOrder: { hostInstanceId: "host-1", generation: 8 },
            bufferedTerminalChunks: [
              buildChunk(8, {
                runId: "host-1-run",
                runOrder: { hostInstanceId: "host-1", generation: 8 },
                data: "old-host\r\n",
              }),
            ],
          }),
        ],
      }),
    );

    const replacementState = buildState({
      scripts: [
        buildScript({
          runId: "host-2-run",
          runOrder: { hostInstanceId: "host-2", generation: 1 },
          bufferedTerminalChunks: [
            buildChunk(0, {
              runId: "host-2-run",
              runOrder: { hostInstanceId: "host-2", generation: 1 },
              data: "replacement-host\r\n",
            }),
          ],
        }),
      ],
    });
    expect(reconcileDevServerTerminalBufferStore(store, replacementState)).toBe(true);

    const delayedOldState = buildState({
      scripts: [
        buildScript({
          runId: "host-1-delayed-run",
          runOrder: { hostInstanceId: "host-1", generation: 9 },
          bufferedTerminalChunks: [
            buildChunk(9, {
              runId: "host-1-delayed-run",
              runOrder: { hostInstanceId: "host-1", generation: 9 },
              data: "delayed-old-host\r\n",
            }),
          ],
        }),
      ],
    });
    expect(reconcileDevServerTerminalBufferStore(store, delayedOldState)).toBe(false);
    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => entry.data),
    ).toEqual(["replacement-host\r\n"]);
  });

  test("replaces an old run with a newer authoritative run when its clock moved backward", () => {
    const store = createDevServerTerminalBufferStore();
    syncDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: [
              buildChunk(100, {
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
                data: "old-run-100\r\n",
                timestamp: "2026-03-25T10:00:00.000Z",
              }),
            ],
          }),
        ],
      }),
    );

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
            pid: 4242,
            startedAt: "2026-03-25T09:59:59.000Z",
            bufferedTerminalChunks: [
              buildChunk(0, {
                runId: "frontend:2",
                runOrder: { hostInstanceId: "host-1", generation: 2 },
                data: "new-run-0\r\n",
                timestamp: "2026-03-25T09:59:59.000Z",
              }),
            ],
          }),
        ],
      }),
    );

    expect(didChange).toBe(true);
    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => entry.data),
    ).toEqual(["new-run-0\r\n"]);
  });

  test("does not merge equal-startedAt replay from a different process run", () => {
    const store = createDevServerTerminalBufferStore();
    syncDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
            pid: 5252,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: [
              buildChunk(10, {
                runId: "frontend:2",
                runOrder: { hostInstanceId: "host-1", generation: 2 },
                data: "current-run-10\r\n",
                timestamp: "2026-03-25T10:00:10.000Z",
              }),
            ],
          }),
        ],
      }),
    );

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: Array.from({ length: 10 }, (_, sequence) =>
              buildChunk(sequence, { data: `same-time-old-run-${sequence}\r\n` }),
            ),
          }),
        ],
      }),
    );

    expect(didChange).toBe(false);
    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => entry.data),
    ).toEqual(["current-run-10\r\n"]);
  });

  test("deduplicates overlapping same-run replay while preserving the live suffix", () => {
    const store = createDevServerTerminalBufferStore();
    syncDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: Array.from({ length: 6 }, (_, offset) =>
              buildChunk(5 + offset, { data: `live-${5 + offset}\r\n` }),
            ),
          }),
        ],
      }),
    );

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: Array.from({ length: 10 }, (_, sequence) =>
              buildChunk(sequence, { data: `replay-${sequence}\r\n` }),
            ),
          }),
        ],
      }),
    );

    expect(didChange).toBe(true);
    expect(
      getDevServerTerminalBuffer(store, "frontend")?.entries.map((entry) => [
        entry.sequence,
        entry.data,
      ]),
    ).toEqual([
      [0, "replay-0\r\n"],
      [1, "replay-1\r\n"],
      [2, "replay-2\r\n"],
      [3, "replay-3\r\n"],
      [4, "replay-4\r\n"],
      [5, "live-5\r\n"],
      [6, "live-6\r\n"],
      [7, "live-7\r\n"],
      [8, "live-8\r\n"],
      [9, "live-9\r\n"],
      [10, "live-10\r\n"],
    ]);
  });

  test("does not reset again when a capped replay merge is already reflected locally", () => {
    const store = createDevServerTerminalBufferStore();
    syncDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            bufferedTerminalChunks: [
              buildChunk(MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS, {
                data: "live-2000\r\n",
                timestamp: "2026-03-25T10:40:00.000Z",
              }),
            ],
          }),
        ],
      }),
    );
    const cappedReplay = Array.from(
      { length: MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS },
      (_, sequence) => buildChunk(sequence, { data: `replay-${sequence}\r\n` }),
    );
    const replayState = buildState({
      scripts: [
        buildScript({
          status: "running",
          pid: 4242,
          startedAt: "2026-03-25T10:00:00.000Z",
          bufferedTerminalChunks: cappedReplay,
        }),
      ],
    });

    expect(reconcileDevServerTerminalBufferStore(store, replayState)).toBe(true);
    const resetTokenAfterMerge = getDevServerTerminalBuffer(store, "frontend")?.resetToken;

    expect(reconcileDevServerTerminalBufferStore(store, replayState)).toBe(false);
    const buffer = getDevServerTerminalBuffer(store, "frontend");
    expect(buffer?.resetToken).toBe(resetTokenAfterMerge);
    expect(buffer?.entries).toHaveLength(MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS);
    expect(buffer?.entries[0]?.sequence).toBe(1);
    expect(buffer?.entries.at(-1)?.sequence).toBe(MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS);
  });

  test("replaces a populated buffer when an authoritative snapshot clears replay", () => {
    const store = createDevServerTerminalBufferStore();
    replaceDevServerTerminalBuffer(store, "frontend", [
      {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 2,
        data: "stale\r\n",
        timestamp: "2026-03-25T10:02:00.000Z",
      },
    ]);

    const clearedScript = buildScript({
      runId: "frontend:1",
      runOrder: testRunOrder("frontend:1"),
      bufferedTerminalChunks: [],
    });

    expect(
      shouldReplaceDevServerTerminalBufferFromScript(
        getDevServerTerminalBufferReplacementContext(store, "frontend"),
        clearedScript,
      ),
    ).toBe(true);
  });

  test("replaces a lower-sequence snapshot from a newer trimmed restart", () => {
    const store = createDevServerTerminalBufferStore();
    replaceDevServerTerminalBuffer(
      store,
      "frontend",
      Array.from({ length: MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS }, (_, offset) => ({
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 4_000 + offset,
        data: `old-run-${offset}\r\n`,
        timestamp: `2026-03-25T10:00:${String(offset % 60).padStart(2, "0")}.000Z`,
      })),
    );

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            pid: 5252,
            startedAt: "2026-03-25T10:31:00.000Z",
            bufferedTerminalChunks: Array.from(
              { length: MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS },
              (_, offset) => ({
                scriptId: "frontend",
                runId: "frontend:2",
                runOrder: { hostInstanceId: "host-1", generation: 2 },
                sequence: 150 + offset,
                data: `new-run-${offset}\r\n`,
                timestamp: `2026-03-25T10:31:${String(offset % 60).padStart(2, "0")}.000Z`,
              }),
            ),
          }),
        ],
      }),
    );

    expect(didChange).toBe(true);
    const buffer = getDevServerTerminalBuffer(store, "frontend");
    expect(buffer?.entries[0]?.sequence).toBe(150);
    expect(buffer?.entries[0]?.data).toBe("new-run-0\r\n");
    expect(buffer?.entries.at(-1)?.sequence).toBe(2_149);
  });

  test("clears live-only output when a newer run has no replay yet", () => {
    const store = createDevServerTerminalBufferStore();
    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
      sequence: 4_000,
      data: "old-live-only\r\n",
      timestamp: "2026-03-25T10:00:00.000Z",
    });

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:2",
            runOrder: testRunOrder("frontend:2"),
            pid: 5252,
            startedAt: "2026-03-25T10:31:00.000Z",
            bufferedTerminalChunks: [],
          }),
        ],
      }),
    );

    expect(didChange).toBe(true);
    expect(getDevServerTerminalBuffer(store, "frontend")?.entries).toEqual([]);
  });

  test("clears old snapshot and live output when a newer run has no replay yet", () => {
    const store = createDevServerTerminalBufferStore();
    replaceDevServerTerminalBuffer(store, "frontend", [
      {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 3_999,
        data: "old-snapshot\r\n",
        timestamp: "2026-03-25T10:00:00.000Z",
      },
    ]);
    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
      sequence: 4_000,
      data: "old-live-only\r\n",
      timestamp: "2026-03-25T10:00:01.000Z",
    });

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            status: "running",
            runId: "frontend:2",
            runOrder: testRunOrder("frontend:2"),
            pid: 5252,
            startedAt: "2026-03-25T10:31:00.000Z",
            bufferedTerminalChunks: [],
          }),
        ],
      }),
    );

    expect(didChange).toBe(true);
    expect(getDevServerTerminalBuffer(store, "frontend")?.entries).toEqual([]);
  });

  test("drops a stale snapshot prefix while preserving a newer live-only suffix", () => {
    const store = createDevServerTerminalBufferStore();
    replaceDevServerTerminalBuffer(store, "frontend", [
      {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 0,
        data: "snapshot\r\n",
        timestamp: "2026-03-25T10:00:00.000Z",
      },
    ]);
    appendDevServerTerminalChunk(store, {
      scriptId: "frontend",
      runId: "frontend:1",
      runOrder: { hostInstanceId: "host-1", generation: 1 },
      sequence: 1,
      data: "live-only\r\n",
      timestamp: "2026-03-25T10:00:01.000Z",
    });

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            runId: "frontend:1",
            runOrder: testRunOrder("frontend:1"),
            bufferedTerminalChunks: [],
          }),
        ],
      }),
    );

    expect(didChange).toBe(true);
    expect(getDevServerTerminalBuffer(store, "frontend")?.entries).toEqual([
      {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 1,
        data: "live-only\r\n",
        timestamp: "2026-03-25T10:00:01.000Z",
      },
    ]);
    expect(
      shouldReplaceDevServerTerminalBufferFromScript(
        getDevServerTerminalBufferReplacementContext(store, "frontend"),
        buildScript({
          runId: "frontend:1",
          runOrder: testRunOrder("frontend:1"),
          bufferedTerminalChunks: [],
        }),
      ),
    ).toBe(false);
    expect(getDevServerTerminalBufferReplacementContext(store, "frontend")?.snapshot).toEqual({
      count: 0,
      firstSequence: null,
      lastSequence: null,
    });
  });

  test("derives snapshot metadata from the stored buffer after replacement", () => {
    const store = createDevServerTerminalBufferStore();

    replaceDevServerTerminalBuffer(store, "frontend", [
      {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 2,
        data: "latest\r\n",
        timestamp: "2026-03-25T10:00:02.000Z",
      },
      {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 1,
        data: "older\r\n",
        timestamp: "2026-03-25T10:00:01.000Z",
      },
    ]);

    expect(getDevServerTerminalBufferReplacementContext(store, "frontend")?.snapshot).toEqual({
      count: 1,
      firstSequence: 2,
      lastSequence: 2,
    });
  });

  test("does not bump reset token when replacing an empty buffer with another empty replay", () => {
    const store = createDevServerTerminalBufferStore();

    replaceDevServerTerminalBuffer(store, "frontend", []);
    expect(getDevServerTerminalBuffer(store, "frontend")?.resetToken).toBe(0);

    replaceDevServerTerminalBuffer(store, "frontend", []);
    expect(getDevServerTerminalBuffer(store, "frontend")?.resetToken).toBe(0);
  });

  test("reconciles the store with authoritative snapshots while pruning removed scripts", () => {
    const store = createDevServerTerminalBufferStore();
    replaceDevServerTerminalBuffer(store, "frontend", [
      {
        scriptId: "frontend",
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 0,
        data: "stale\r\n",
        timestamp: "2026-03-25T10:00:00.000Z",
      },
    ]);
    replaceDevServerTerminalBuffer(store, "removed", [
      {
        scriptId: "removed",
        runId: "removed:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
        sequence: 0,
        data: "removed\r\n",
        timestamp: "2026-03-25T10:00:00.000Z",
      },
    ]);

    const didChange = reconcileDevServerTerminalBufferStore(
      store,
      buildState({
        scripts: [
          buildScript({
            bufferedTerminalChunks: [
              {
                scriptId: "frontend",
                runId: "frontend:1",
                runOrder: { hostInstanceId: "host-1", generation: 1 },
                sequence: 2,
                data: "fresh\r\n",
                timestamp: "2026-03-25T10:02:00.000Z",
              },
            ],
          }),
        ],
      }),
    );

    expect(didChange).toBe(true);
    expect(getDevServerTerminalBuffer(store, "removed")).toBeNull();
    expect(getDevServerTerminalBuffer(store, "frontend")?.entries[0]?.data).toBe("fresh\r\n");
  });
});
