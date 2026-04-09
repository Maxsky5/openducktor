import { describe, expect, test } from "bun:test";
import { devServerEventSchema, devServerGroupStateSchema } from "./dev-server-schemas";

describe("dev-server-schemas", () => {
  test("parses terminal chunk events with ordered replay metadata", () => {
    const parsed = devServerEventSchema.parse({
      type: "terminal_chunk",
      repoPath: "/repo",
      taskId: "task-7",
      terminalChunk: {
        scriptId: "frontend",
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

  test("defaults missing buffered terminal chunks to an empty replay", () => {
    const parsed = devServerGroupStateSchema.parse({
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
    });

    expect(parsed.scripts[0]?.bufferedTerminalChunks).toEqual([]);
  });
});
