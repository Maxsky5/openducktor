import { describe, expect, test } from "bun:test";
import {
  devServerCommandInputSchema,
  devServerEventSchema,
  devServerScriptStateSchema,
} from "./dev-server-schemas";

const script = {
  scriptId: "web",
  name: "Web",
  command: "bun run dev",
  startedCommand: null,
  status: "stopped",
  terminalId: null,
  pid: null,
  startedAt: null,
  exitCode: null,
  lastError: null,
};

describe("dev-server metadata contracts", () => {
  test("exposes a terminal ID without terminal output in snapshots or status events", () => {
    const active = {
      ...script,
      status: "running",
      startedCommand: "bun run dev",
      terminalId: "terminal-1",
      pid: 42,
    };
    const event = devServerEventSchema.parse({
      type: "script_status_changed",
      repoPath: "/repo",
      owner: { kind: "task", taskId: "task-1" },
      script: active,
      revision: 1,
      updatedAt: "now",
    });
    expect(event).toMatchObject({ script: { terminalId: "terminal-1" } });
    expect(
      devServerScriptStateSchema.safeParse({ ...active, bufferedTerminalChunks: [] }).success,
    ).toBe(false);
    expect(
      devServerEventSchema.safeParse({
        type: "terminal_chunk",
        repoPath: "/repo",
        owner: { kind: "task", taskId: "task-1" },
      }).success,
    ).toBe(false);
  });

  for (const status of ["starting", "running", "stopping"] as const) {
    test(`requires a terminal ID and started command for ${status} scripts`, () => {
      const result = devServerScriptStateSchema.safeParse({ ...script, status });
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Expected a missing terminal ID to fail.");
      expect(result.error.issues.map((issue) => issue.path)).toEqual([["terminalId"]]);
      const active = { ...script, status, terminalId: "terminal-1" };
      expect(devServerScriptStateSchema.safeParse(active).success).toBe(false);
      expect(
        devServerScriptStateSchema.parse({ ...active, startedCommand: "bun run dev" }),
      ).toMatchObject({ terminalId: "terminal-1", startedCommand: "bun run dev" });
    });
  }

  test("requires the started command for retained output after a process exits", () => {
    expect(
      devServerScriptStateSchema.safeParse({
        ...script,
        status: "failed",
        terminalId: "terminal-1",
      }).success,
    ).toBe(false);
    expect(
      devServerScriptStateSchema.parse({
        ...script,
        status: "failed",
        terminalId: "terminal-1",
        startedCommand: "bun run dev",
      }).terminalId,
    ).toBe("terminal-1");
  });

  test("requires explicit null fields for a script without a run", () => {
    expect(devServerScriptStateSchema.parse(script)).toEqual(script);
    const { terminalId: _terminalId, ...missingTerminal } = script;
    const { startedCommand: _startedCommand, ...missingCommand } = script;
    for (const missing of [missingTerminal, missingCommand])
      expect(devServerScriptStateSchema.safeParse(missing).success).toBe(false);
  });

  test("retains the launched command when configuration changes", () => {
    const active = {
      ...script,
      command: "bun run dev:next",
      startedCommand: "bun run dev",
      terminalId: "terminal-1",
    };
    expect(devServerScriptStateSchema.parse(active)).toMatchObject({
      command: "bun run dev:next",
      startedCommand: "bun run dev",
    });
    expect(devServerScriptStateSchema.safeParse({ ...active, startedCommand: null }).success).toBe(
      false,
    );
  });

  test("rejects empty terminal IDs", () => {
    expect(devServerScriptStateSchema.safeParse({ ...script, terminalId: "" }).success).toBe(false);
  });

  test("requires a tagged owner on every dev server command", () => {
    expect(
      devServerCommandInputSchema.safeParse({ repoPath: "/repo", taskId: "task-7" }).success,
    ).toBe(false);
    const owner = { kind: "workspace_session", workspaceId: "ws", sessionId: "session" };
    expect(devServerCommandInputSchema.parse({ repoPath: "/repo", owner }).owner).toEqual(owner);
  });
});
