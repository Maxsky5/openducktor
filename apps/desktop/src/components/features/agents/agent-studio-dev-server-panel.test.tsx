import { describe, expect, test } from "bun:test";
import type { DevServerScriptState } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentStudioDevServerPanel,
  type AgentStudioDevServerPanelModel,
} from "./agent-studio-dev-server-panel";

const baseModel = (
  overrides: Partial<AgentStudioDevServerPanelModel> = {},
): AgentStudioDevServerPanelModel => ({
  mode: "stopped",
  isExpanded: false,
  isLoading: false,
  repoPath: "/repo",
  taskId: "task-7",
  worktreePath: "/tmp/worktree/task-7",
  scripts: [],
  selectedScriptId: null,
  selectedScript: null,
  error: null,
  isStartPending: false,
  isStopPending: false,
  isRestartPending: false,
  onSelectScript: () => {},
  onStart: () => {},
  onStop: () => {},
  onRestart: () => {},
  ...overrides,
});

const runningScript: DevServerScriptState = {
  scriptId: "frontend",
  name: "Frontend",
  command: "bun run dev",
  status: "running",
  pid: 4321,
  startedAt: "2026-03-19T15:30:00.000Z",
  exitCode: null,
  lastError: null,
  bufferedLogLines: [
    {
      scriptId: "frontend",
      stream: "system",
      text: "Starting `bun run dev`",
      timestamp: "2026-03-19T15:30:00.000Z",
    },
    {
      scriptId: "frontend",
      stream: "stdout",
      text: "ready on http://localhost:5173",
      timestamp: "2026-03-19T15:30:01.000Z",
    },
  ],
};

const backendScript: DevServerScriptState = {
  scriptId: "backend",
  name: "Backend",
  command: "bun run api",
  status: "running",
  pid: 999,
  startedAt: "2026-03-19T15:31:00.000Z",
  exitCode: null,
  lastError: null,
  bufferedLogLines: [
    {
      scriptId: "backend",
      stream: "stdout",
      text: "api ready",
      timestamp: "2026-03-19T15:31:01.000Z",
    },
  ],
};

describe("AgentStudioDevServerPanel", () => {
  test("renders compact start row while stopped", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioDevServerPanel, { model: baseModel() }),
    );

    expect(html).toContain("Start dev servers");
    expect(html).toContain("Start the configured builder dev servers for this task worktree.");
    expect(html).not.toContain("Restart");
  });

  test("renders disabled compact row when no worktree is available", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioDevServerPanel, {
        model: baseModel({
          mode: "disabled",
          worktreePath: null,
        }),
      }),
    );

    expect(html).toContain(
      "Create or resume a Builder worktree before starting repository dev servers.",
    );
    expect(html).toContain("disabled");
  });

  test("renders expanded terminal tabs and logs while active", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioDevServerPanel, {
        model: baseModel({
          mode: "active",
          isExpanded: true,
          scripts: [runningScript],
          selectedScriptId: runningScript.scriptId,
          selectedScript: runningScript,
        }),
      }),
    );

    expect(html).toContain("Builder dev servers");
    expect(html).toContain("Stop");
    expect(html).toContain("Restart");
    expect(html).toContain("Frontend");
    expect(html).toContain("ready on http://localhost:5173");
    expect(html).toContain("[stdout]");
  });

  test("renders only the selected script log content", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioDevServerPanel, {
        model: baseModel({
          mode: "active",
          isExpanded: true,
          scripts: [runningScript, backendScript],
          selectedScriptId: backendScript.scriptId,
          selectedScript: backendScript,
        }),
      }),
    );

    expect(html).toContain("Backend");
    expect(html).toContain("api ready");
    expect(html).not.toContain("ready on http://localhost:5173");
  });
});
