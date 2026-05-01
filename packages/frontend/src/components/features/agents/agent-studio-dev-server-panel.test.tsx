import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerScriptState } from "@openducktor/contracts";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import {
  AgentStudioDevServerPanel,
  type AgentStudioDevServerPanelModel,
  DEV_SERVER_DISABLED_REASON,
  DEV_SERVER_EMPTY_REASON,
} from "./agent-studio-dev-server-panel";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const buildTerminalBuffer = (script: DevServerScriptState): AgentStudioDevServerTerminalBuffer => ({
  entries: script.bufferedTerminalChunks,
  lastSequence: script.bufferedTerminalChunks.at(-1)?.sequence ?? null,
  resetToken: 0,
});

const baseModel = (
  overrides: Partial<AgentStudioDevServerPanelModel> = {},
): AgentStudioDevServerPanelModel => ({
  mode: "stopped",
  isExpanded: false,
  isLoading: false,
  disabledReason: null,
  repoPath: "/repo",
  taskId: "task-7",
  worktreePath: "/tmp/worktree/task-7",
  scripts: [],
  selectedScriptId: null,
  selectedScript: null,
  selectedScriptTerminalBuffer: null,
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
  bufferedTerminalChunks: [
    {
      scriptId: "frontend",
      sequence: 0,
      data: "Starting `bun run dev`\r\n",
      timestamp: "2026-03-19T15:30:00.000Z",
    },
    {
      scriptId: "frontend",
      sequence: 1,
      data: "ready on http://localhost:5173\r\n",
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
  bufferedTerminalChunks: [
    {
      scriptId: "backend",
      sequence: 0,
      data: "api ready\r\n",
      timestamp: "2026-03-19T15:31:01.000Z",
    },
  ],
};

const failedScript: DevServerScriptState = {
  scriptId: "failed",
  name: "Failed server",
  command: "bun run broken",
  status: "failed",
  pid: null,
  startedAt: null,
  exitCode: 1,
  lastError: "Process exited",
  bufferedTerminalChunks: [
    {
      scriptId: "failed",
      sequence: 0,
      data: "Process exited\r\n",
      timestamp: "2026-03-19T15:32:01.000Z",
    },
  ],
};

describe("AgentStudioDevServerPanel", () => {
  test("renders compact start row while stopped", () => {
    const view = render(<AgentStudioDevServerPanel model={baseModel()} />);

    try {
      expect(screen.getByTestId("agent-studio-dev-server-start-button").textContent).toContain(
        "Start dev servers",
      );
      expect(screen.queryByTestId("agent-studio-dev-server-compact-message")).toBeNull();
      expect(screen.queryByTestId("agent-studio-dev-server-disabled-start-trigger")).toBeNull();
      expect(
        screen.queryByText("Start the configured builder dev servers for this task worktree."),
      ).toBeNull();
      expect(screen.queryByText("Restart")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("renders disabled compact row when no worktree is available", () => {
    const view = render(
      <AgentStudioDevServerPanel
        model={baseModel({
          mode: "disabled",
          disabledReason: DEV_SERVER_DISABLED_REASON,
          worktreePath: null,
        })}
      />,
    );

    try {
      const button = screen.getByTestId(
        "agent-studio-dev-server-start-button",
      ) as HTMLButtonElement;

      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      const disabledReasonId = button.getAttribute("aria-describedby");
      expect(disabledReasonId).toBeTruthy();
      expect(button.getAttribute("class")).toContain("cursor-not-allowed");
      expect(button.getAttribute("class")).toContain("opacity-50");
      expect(screen.queryByTestId("agent-studio-dev-server-disabled-start-trigger")).toBeNull();
      expect(screen.queryByTestId("agent-studio-dev-server-compact-message")).toBeNull();
      expect(document.getElementById(disabledReasonId ?? "")?.textContent).toContain(
        DEV_SERVER_DISABLED_REASON,
      );
    } finally {
      view.unmount();
    }
  });

  test("renders empty compact row with a tooltip instead of inline copy", () => {
    const view = render(
      <AgentStudioDevServerPanel
        model={baseModel({
          mode: "empty",
          disabledReason: DEV_SERVER_EMPTY_REASON,
          worktreePath: null,
        })}
      />,
    );

    try {
      const button = screen.getByTestId(
        "agent-studio-dev-server-start-button",
      ) as HTMLButtonElement;

      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      const disabledReasonId = button.getAttribute("aria-describedby");
      expect(disabledReasonId).toBeTruthy();
      expect(button.getAttribute("class")).toContain("cursor-not-allowed");
      expect(button.getAttribute("class")).toContain("opacity-50");
      expect(screen.queryByTestId("agent-studio-dev-server-disabled-start-trigger")).toBeNull();
      expect(screen.queryByTestId("agent-studio-dev-server-compact-message")).toBeNull();
      expect(document.getElementById(disabledReasonId ?? "")?.textContent).toContain(
        DEV_SERVER_EMPTY_REASON,
      );
    } finally {
      view.unmount();
    }
  });

  test("renders expanded terminal tabs and terminal surface while active", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioDevServerPanel, {
        model: baseModel({
          mode: "active",
          isExpanded: true,
          scripts: [runningScript],
          selectedScriptId: runningScript.scriptId,
          selectedScript: runningScript,
          selectedScriptTerminalBuffer: buildTerminalBuffer(runningScript),
        }),
      }),
    );

    expect(html).toContain("Stop");
    expect(html).toContain("Restart");
    expect(html).toContain("Frontend");
    expect(html).toContain("bun run dev");
    expect(html).toContain("Copy working directory");
    expect(html).toContain("/tmp/worktree/task-7");
    expect(html).toContain("inline-flex max-w-full items-center gap-1.5");
    expect(html).toContain("bg-[var(--dev-server-terminal-panel)]");
    expect(html).toContain('data-testid="agent-studio-dev-server-terminal"');
  });

  test("renders the expanded panel immediately when start is pending", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioDevServerPanel, {
        model: baseModel({
          mode: "stopped",
          isExpanded: true,
          isStartPending: true,
          scripts: [runningScript],
          selectedScriptId: runningScript.scriptId,
          selectedScript: runningScript,
          selectedScriptTerminalBuffer: buildTerminalBuffer(runningScript),
        }),
      }),
    );

    expect(html).toContain("Stop");
    expect(html).toContain("Restart");
    expect(html).toContain("Frontend");
    expect(html).not.toContain("Start dev servers");
  });

  test("renders only the selected script terminal content frame", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioDevServerPanel, {
        model: baseModel({
          mode: "active",
          isExpanded: true,
          scripts: [runningScript, backendScript],
          selectedScriptId: backendScript.scriptId,
          selectedScript: backendScript,
          selectedScriptTerminalBuffer: buildTerminalBuffer(backendScript),
        }),
      }),
    );

    expect(html).toContain("Backend");
    expect(html).toContain("bun run api");
    expect(html).not.toContain("ready on http://localhost:5173");
  });

  test("falls back to the first script terminal replay when selection state lags", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioDevServerPanel, {
        model: baseModel({
          mode: "active",
          isExpanded: true,
          scripts: [runningScript, backendScript],
          selectedScriptId: null,
          selectedScript: null,
          selectedScriptTerminalBuffer: null,
        }),
      }),
    );

    expect(html).toContain("Frontend");
    expect(html).toContain("bun run dev");
    expect(html).not.toContain("agent-studio-dev-server-empty-log-state");
  });

  test("renders failed dev server tabs with failed status styling", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioDevServerPanel, {
        model: baseModel({
          mode: "active",
          isExpanded: true,
          scripts: [failedScript],
          selectedScriptId: failedScript.scriptId,
          selectedScript: failedScript,
          selectedScriptTerminalBuffer: buildTerminalBuffer(failedScript),
        }),
      }),
    );

    expect(html).toContain("Failed server");
    expect(html).toContain("bg-rose-400");
    expect(html).not.toContain("bg-emerald-400");
  });
});
