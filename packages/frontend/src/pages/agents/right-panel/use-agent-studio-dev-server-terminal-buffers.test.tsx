import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "@testing-library/react";
import { buildScript, buildState } from "./use-agent-studio-dev-server-panel-test-fixtures";
import { renderDevServerPanelHook } from "./use-agent-studio-dev-server-panel-test-harness";
import { useAgentStudioDevServerTerminalBuffers } from "./use-agent-studio-dev-server-terminal-buffers";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

describe("useAgentStudioDevServerTerminalBuffers", () => {
  test("ignores state and events outside the active task scope", () => {
    const harness = renderDevServerPanelHook(useAgentStudioDevServerTerminalBuffers, {
      repoPath: "/repo",
      taskId: "task-7",
    });

    try {
      act(() => {
        harness.getLatest().replaceTerminalBuffersFromState(
          buildState({
            repoPath: "/repo",
            taskId: "task-7",
            scripts: [
              buildScript({
                status: "running",
                bufferedTerminalChunks: [
                  {
                    scriptId: "frontend",
                    sequence: 0,
                    data: "task seven output\r\n",
                    timestamp: "2026-03-25T10:00:00.000Z",
                  },
                ],
              }),
            ],
          }),
          "frontend",
        );
      });

      expect(
        harness.getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data),
      ).toEqual(["task seven output\r\n"]);

      act(() => {
        harness.getLatest().replaceTerminalBuffersFromState(
          buildState({
            repoPath: "/repo",
            taskId: "task-8",
            scripts: [
              buildScript({
                status: "running",
                bufferedTerminalChunks: [
                  {
                    scriptId: "frontend",
                    sequence: 0,
                    data: "task eight state\r\n",
                    timestamp: "2026-03-25T10:00:01.000Z",
                  },
                ],
              }),
            ],
          }),
          "frontend",
        );
        harness.getLatest().applyTerminalBuffersFromEvent(
          {
            type: "terminal_chunk",
            repoPath: "/repo",
            taskId: "task-8",
            terminalChunk: {
              scriptId: "frontend",
              sequence: 1,
              data: "task eight event\r\n",
              timestamp: "2026-03-25T10:00:02.000Z",
            },
          },
          "frontend",
        );
      });

      expect(
        harness.getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data),
      ).toEqual(["task seven output\r\n"]);
    } finally {
      harness.unmount();
    }
  });
});
