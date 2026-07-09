import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, render } from "@testing-library/react";
import { Suspense, startTransition, useState } from "react";
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
                    runId: "frontend:1",
                    runOrder: { hostInstanceId: "host-1", generation: 1 },
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
                    runId: "frontend:1",
                    runOrder: { hostInstanceId: "host-1", generation: 1 },
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
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
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

  test("keeps committed task buffers when a different task render suspends", () => {
    type Scope = Parameters<typeof useAgentStudioDevServerTerminalBuffers>[0];
    type HookResult = ReturnType<typeof useAgentStudioDevServerTerminalBuffers>;
    const suspendedTask = new Promise<void>(() => {});
    let latest: HookResult | null = null;
    let setScope: ((scope: Scope) => void) | null = null;
    const getLatest = (): HookResult => {
      if (latest === null) {
        throw new Error("Hook result not ready");
      }

      return latest;
    };

    function HookHarness() {
      const [scope, setCurrentScope] = useState<Scope>({
        repoPath: "/repo",
        taskId: "task-7",
      });
      setScope = setCurrentScope;
      const result = useAgentStudioDevServerTerminalBuffers(scope);
      if (scope?.taskId === "task-8") {
        throw suspendedTask;
      }
      latest = result;
      return null;
    }

    const view = render(
      <Suspense fallback={null}>
        <HookHarness />
      </Suspense>,
    );

    try {
      act(() => {
        getLatest().replaceTerminalBuffersFromState(
          buildState({
            taskId: "task-7",
            scripts: [
              buildScript({
                status: "running",
                bufferedTerminalChunks: [
                  {
                    scriptId: "frontend",
                    runId: "frontend:1",
                    runOrder: { hostInstanceId: "host-1", generation: 1 },
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

      expect(getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data)).toEqual([
        "task seven output\r\n",
      ]);
      const committedTaskSevenBuffers = getLatest();

      act(() => {
        startTransition(() => {
          setScope?.({ repoPath: "/repo", taskId: "task-8" });
        });
      });

      act(() => {
        committedTaskSevenBuffers.applyTerminalBuffersFromEvent(
          {
            type: "terminal_chunk",
            repoPath: "/repo",
            taskId: "task-7",
            terminalChunk: {
              scriptId: "frontend",
              runId: "frontend:1",
              runOrder: { hostInstanceId: "host-1", generation: 1 },
              sequence: 1,
              data: "task seven still live\r\n",
              timestamp: "2026-03-25T10:00:01.000Z",
            },
          },
          "frontend",
        );
      });

      expect(getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.data)).toEqual([
        "task seven output\r\n",
        "task seven still live\r\n",
      ]);
    } finally {
      view.unmount();
    }
  });
});
