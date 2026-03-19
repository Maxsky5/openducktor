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
  bufferedLogLines: [],
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
  test("applies log line events and preserves the latest 2000 lines", () => {
    const initialLogs = Array.from({ length: 2_000 }, (_, index) => ({
      scriptId: "frontend",
      stream: "stdout" as const,
      text: `line-${index}`,
      timestamp: `2026-03-19T15:30:${String(index % 60).padStart(2, "0")}.000Z`,
    }));
    const state = buildState({
      scripts: [buildScript({ bufferedLogLines: initialLogs })],
    });
    const event: DevServerEvent = {
      type: "log_line",
      repoPath: "/repo",
      taskId: "task-7",
      logLine: {
        scriptId: "frontend",
        stream: "stderr",
        text: "latest-line",
        timestamp: "2026-03-19T15:31:00.000Z",
      },
    };

    const nextState = applyDevServerEventToState(state, event);

    expect(nextState?.scripts[0]?.bufferedLogLines).toHaveLength(2_000);
    expect(nextState?.scripts[0]?.bufferedLogLines[0]?.text).toBe("line-1");
    expect(nextState?.scripts[0]?.bufferedLogLines.at(-1)?.text).toBe("latest-line");
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

  test("expands when start is pending or a script is failed", () => {
    expect(isDevServerPanelExpanded([buildScript()], true)).toBe(true);
    expect(isDevServerPanelExpanded([buildScript({ status: "failed" })], false)).toBe(true);
    expect(isDevServerPanelExpanded([buildScript()], false)).toBe(false);
  });
});
