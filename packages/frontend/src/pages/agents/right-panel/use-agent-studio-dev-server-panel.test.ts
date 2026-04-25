import { describe, expect, test } from "bun:test";
import type {
  DevServerEvent,
  DevServerGroupState,
  DevServerScriptState,
} from "@openducktor/contracts";
import {
  applyDevServerEventToState,
  isDevServerPanelExpanded,
  selectDefaultDevServerTab,
} from "./use-agent-studio-dev-server-panel";

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
  updatedAt: "2026-03-19T15:30:00.000Z",
  ...overrides,
});

describe("useAgentStudioDevServerPanel helpers", () => {
  test("applies terminal chunk events without cloning buffered replay into query state", () => {
    const initialChunks = Array.from({ length: 2_000 }, (_, index) => ({
      scriptId: "frontend",
      sequence: index,
      data: `line-${index}`,
      timestamp: `2026-03-19T15:30:${String(index % 60).padStart(2, "0")}.000Z`,
    }));
    const state = buildState({
      scripts: [buildScript({ bufferedTerminalChunks: initialChunks })],
    });
    const event: DevServerEvent = {
      type: "terminal_chunk",
      repoPath: "/repo",
      taskId: "task-7",
      terminalChunk: {
        scriptId: "frontend",
        sequence: 2000,
        data: "latest-chunk",
        timestamp: "2026-03-19T15:31:00.000Z",
      },
    };

    const nextState = applyDevServerEventToState(state, event);

    expect(nextState?.scripts).toBe(state.scripts);
    expect(nextState?.scripts[0]?.bufferedTerminalChunks).toBe(initialChunks);
    expect(nextState?.updatedAt).toBe("2026-03-19T15:31:00.000Z");
  });

  test("selects the remembered tab when it still exists", () => {
    const selected = selectDefaultDevServerTab(
      [buildScript({ scriptId: "frontend" }), buildScript({ scriptId: "backend" })],
      "backend",
    );

    expect(selected).toBe("backend");
  });

  test("falls back to the most recently started script", () => {
    const selected = selectDefaultDevServerTab(
      [
        buildScript({ scriptId: "frontend", startedAt: "2026-03-19T15:29:00.000Z" }),
        buildScript({ scriptId: "backend", startedAt: "2026-03-19T15:30:00.000Z" }),
      ],
      null,
    );

    expect(selected).toBe("backend");
  });

  test("expands when start or restart is pending or a script is failed", () => {
    expect(isDevServerPanelExpanded([buildScript()], true)).toBe(true);
    expect(isDevServerPanelExpanded([buildScript({ status: "failed" })], false)).toBe(true);
    expect(isDevServerPanelExpanded([buildScript()], false)).toBe(false);
  });
});
