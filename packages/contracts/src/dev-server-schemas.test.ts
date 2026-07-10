import { describe, expect, test } from "bun:test";
import {
  devServerEventSchema,
  devServerGroupStateSchema,
  devServerScriptStateSchema,
} from "./dev-server-schemas";

describe("dev-server-schemas", () => {
  test("parses terminal chunk events with ordered replay metadata", () => {
    const parsed = devServerEventSchema.parse({
      type: "terminal_chunk",
      repoPath: "/repo",
      taskId: "task-7",
      terminalChunk: {
        scriptId: "frontend",
        runIdentity: {
          runId: "frontend:1",
          runOrder: { hostInstanceId: "host-1", generation: 1 },
        },
        sequence: 12,
        data: "\u001b[32mready\u001b[0m\r\n",
        timestamp: "2026-03-25T10:00:00.000Z",
      },
    });

    expect(parsed.type).toBe("terminal_chunk");
    if (parsed.type !== "terminal_chunk") {
      throw new Error("Expected terminal_chunk event.");
    }

    expect(parsed.terminalChunk.sequence).toBe(12);
    expect(parsed.terminalChunk.data).toContain("\u001b[32m");
    expect(parsed.terminalChunk.data).toContain("\r\n");
  });

  test("rejects active scripts with missing run ownership", () => {
    expect(() =>
      devServerGroupStateSchema.parse({
        repoPath: "/repo",
        taskId: "task-7",
        worktreePath: "/tmp/worktree/task-7",
        scripts: [
          {
            scriptId: "frontend",
            name: "Frontend",
            command: "bun run dev",
            status: "running",
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            exitCode: null,
            lastError: null,
          },
        ],
        updatedAt: "2026-03-25T10:00:00.000Z",
      }),
    ).toThrow();
  });

  for (const status of ["starting", "stopping"] as const) {
    test(`rejects ${status} scripts with missing run ownership`, () => {
      const parsed = devServerScriptStateSchema.safeParse({
        scriptId: "frontend",
        name: "Frontend",
        command: "bun run dev",
        status,
        runIdentity: null,
        pid: null,
        startedAt: null,
        exitCode: null,
        lastError: null,
        bufferedTerminalChunks: [],
      });

      expect(parsed.success).toBe(false);
      if (parsed.success) {
        throw new Error(`Expected ${status} script without run ownership to be rejected.`);
      }
      expect(parsed.error.issues).toHaveLength(1);
      expect(parsed.error.issues[0]?.path).toEqual(["runIdentity"]);
    });
  }

  test("reports only the root ownership issue for failed scripts with buffered output", () => {
    const parsed = devServerScriptStateSchema.safeParse({
      scriptId: "frontend",
      name: "Frontend",
      command: "bun run dev",
      status: "failed",
      runIdentity: null,
      pid: null,
      startedAt: null,
      exitCode: 1,
      lastError: "Process exited",
      bufferedTerminalChunks: [
        {
          scriptId: "frontend",
          runIdentity: {
            runId: "frontend:1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
          },
          sequence: 0,
          data: "Process exited\r\n",
          timestamp: "2026-03-25T10:00:00.000Z",
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected failed script with buffered output and no owner to be rejected.");
    }
    expect(parsed.error.issues).toHaveLength(1);
    expect(parsed.error.issues[0]?.path).toEqual(["runIdentity"]);
  });

  test("requires stopped scripts to state null ownership explicitly", () => {
    const parsed = devServerGroupStateSchema.parse({
      repoPath: "/repo",
      taskId: "task-7",
      worktreePath: "/tmp/worktree/task-7",
      scripts: [
        {
          scriptId: "frontend",
          name: "Frontend",
          command: "bun run dev",
          status: "stopped",
          runIdentity: null,
          pid: null,
          startedAt: null,
          exitCode: null,
          lastError: null,
        },
      ],
      updatedAt: "2026-03-25T10:00:00.000Z",
    });

    expect(parsed.scripts[0]?.runIdentity).toBeNull();
    expect(parsed.scripts[0]?.bufferedTerminalChunks).toEqual([]);
  });

  test("rejects structurally incomplete run identity", () => {
    expect(() =>
      devServerGroupStateSchema.parse({
        repoPath: "/repo",
        taskId: "task-7",
        worktreePath: "/tmp/worktree/task-7",
        scripts: [
          {
            scriptId: "frontend",
            name: "Frontend",
            command: "bun run dev",
            status: "running",
            runIdentity: { runId: "frontend:1" },
            pid: 4242,
            startedAt: "2026-03-25T10:00:00.000Z",
            exitCode: null,
            lastError: null,
          },
        ],
        updatedAt: "2026-03-25T10:00:00.000Z",
      }),
    ).toThrow();
  });

  test("rejects buffered output that does not match script run ownership", () => {
    expect(() =>
      devServerGroupStateSchema.parse({
        repoPath: "/repo",
        taskId: "task-7",
        worktreePath: "/tmp/worktree/task-7",
        scripts: [
          {
            scriptId: "frontend",
            name: "Frontend",
            command: "bun run dev",
            status: "stopped",
            runIdentity: {
              runId: "frontend:2",
              runOrder: { hostInstanceId: "host-1", generation: 2 },
            },
            pid: null,
            startedAt: null,
            exitCode: 0,
            lastError: null,
            bufferedTerminalChunks: [
              {
                scriptId: "frontend",
                runIdentity: {
                  runId: "frontend:1",
                  runOrder: { hostInstanceId: "host-1", generation: 1 },
                },
                sequence: 0,
                data: "old output",
                timestamp: "2026-03-25T10:00:00.000Z",
              },
            ],
          },
        ],
        updatedAt: "2026-03-25T10:00:00.000Z",
      }),
    ).toThrow("Buffered terminal chunks must belong to the script's current run.");
  });
});
