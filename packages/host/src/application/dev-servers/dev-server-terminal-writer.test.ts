import { describe, expect, test } from "bun:test";
import type { DevServerEvent, DevServerRunIdentity } from "@openducktor/contracts";
import type { DevServerGroupRuntime } from "./dev-server-state";
import { createDevServerTerminalWriter } from "./dev-server-terminal-writer";

const activeRunIdentity: DevServerRunIdentity = {
  runId: "web:1",
  runOrder: { hostInstanceId: "host-1", generation: 1 },
};

const createRuntime = (runIdentity: DevServerRunIdentity | null): DevServerGroupRuntime => ({
  processes: new Map(),
  state: {
    repoPath: "/repo",
    taskId: "task-1",
    worktreePath: "/worktrees/task-1",
    scripts: [
      {
        scriptId: "web",
        name: "Web",
        command: "bun run dev",
        status: runIdentity === null ? "stopped" : "running",
        runIdentity,
        pid: runIdentity === null ? null : 4242,
        startedAt: runIdentity === null ? null : "2026-07-10T10:00:00.000Z",
        exitCode: null,
        lastError: null,
        bufferedTerminalChunks: [],
      },
    ],
    updatedAt: "2026-07-10T10:00:00.000Z",
  },
  terminalBufferedBytesByScriptId: new Map(),
  terminalNextSequenceByScriptId: new Map(),
  terminalRunGeneration: 1,
});

describe("createDevServerTerminalWriter", () => {
  test("publishes process output only for the active run", () => {
    const published: DevServerEvent[] = [];
    const runtime = createRuntime(activeRunIdentity);
    const writer = createDevServerTerminalWriter((event) => published.push(event));

    writer.pushProcessOutput(runtime, "web", activeRunIdentity.runId, "ready\n");
    writer.pushProcessOutput(runtime, "web", "web:stale", "stale\n");

    expect(runtime.state.scripts[0]?.bufferedTerminalChunks).toHaveLength(1);
    expect(runtime.state.scripts[0]?.bufferedTerminalChunks[0]).toMatchObject({
      scriptId: "web",
      runIdentity: activeRunIdentity,
      sequence: 0,
      data: "ready\r\n",
    });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "terminal_chunk",
      repoPath: "/repo",
      taskId: "task-1",
      terminalChunk: {
        scriptId: "web",
        runIdentity: activeRunIdentity,
        sequence: 0,
        data: "ready\r\n",
      },
    });
  });

  test("rejects system messages when the script has no active run", () => {
    const runtime = createRuntime(null);
    const writer = createDevServerTerminalWriter(() => {});

    expect(() => writer.appendSystemMessage(runtime, "web", "Process exited")).toThrow(
      "Dev server script has no active run identity: web",
    );
    expect(runtime.state.scripts[0]?.bufferedTerminalChunks).toEqual([]);
  });
});
