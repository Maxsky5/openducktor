import { expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerTerminalChunk } from "@openducktor/contracts";
import { act, render } from "@testing-library/react";
import { AgentStudioDevServerTerminal } from "@/components/features/agents/agent-studio-dev-server-terminal";
import { buildScript, buildState } from "./use-agent-studio-dev-server-panel-test-fixtures";
import { renderDevServerPanelHook } from "./use-agent-studio-dev-server-panel-test-harness";
import { useAgentStudioDevServerTerminalBuffers } from "./use-agent-studio-dev-server-terminal-buffers";

if (globalThis.document === undefined) GlobalRegistrator.register();

const chunk = (generation: number, sequence: number): DevServerTerminalChunk => ({
  scriptId: "frontend",
  runIdentity: {
    runId: `frontend:${generation}`,
    runOrder: { hostInstanceId: "host-1", generation },
  },
  sequence,
  data: `${generation}:${sequence},`,
  timestamp: "2026-03-25T10:00:00.000Z",
});

test.each(["first chunk", "starting status", "starting status with delayed render"])(
  "resets an empty replay cursor on a new run via %s",
  async (order) => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const requestFrame = spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
    );
    const cancelFrame = spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const flushFrame = () =>
      act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) callback(0);
      });
    const harness = renderDevServerPanelHook(useAgentStudioDevServerTerminalBuffers, {
      repoPath: "/repo",
      taskId: "task-7",
    });
    let screen = "";
    const writes: string[] = [];
    const createTerminalBinding = () => ({
      dispose: () => {},
      terminal: {
        options: {},
        open: () => {},
        loadAddon: () => {},
        dispose: () => {},
        clear: () => {
          screen = "";
        },
        reset: () => {
          screen = "";
        },
        write: (data: string) => {
          screen += data;
          writes.push(data);
        },
      },
      fitAddon: { fit: () => {}, dispose: () => {} },
    });
    const onRendererError = (message: string | null) => {
      if (message) throw new Error(message);
    };
    const element = () => (
      <AgentStudioDevServerTerminal
        scopeKey="/repo::task-7"
        scriptId="frontend"
        terminalBuffer={harness.getLatest().selectedScriptTerminalBuffer}
        createTerminalBinding={createTerminalBinding}
        onRendererError={onRendererError}
      />
    );
    const load = (chunks: DevServerTerminalChunk[]) =>
      act(() => {
        harness.getLatest().hydrateTerminalBuffersFromState(
          buildState({
            scripts: [
              buildScript({ runIdentity: chunk(1, 0).runIdentity, bufferedTerminalChunks: chunks }),
            ],
          }),
          "frontend",
        );
      });
    const append = (sequence: number) =>
      act(() => {
        harness.getLatest().applyTerminalBuffersFromEvent(
          {
            type: "terminal_chunk",
            repoPath: "/repo",
            taskId: "task-7",
            terminalChunk: chunk(2, sequence),
          },
          "frontend",
        );
      });
    load([chunk(1, 0), chunk(1, 1), chunk(1, 2)]);
    const view = render(element());
    const draw = async () => {
      await act(async () => {
        view.rerender(element());
      });
    };
    try {
      await act(async () => {});
      expect(screen).toBe("1:0,1:1,1:2,");
      load([]);
      await draw();
      const notice = "[Dev server output was truncated. Showing retained output.]\r\n";
      expect(screen).toBe(notice);
      const resetToken = harness.getLatest().selectedScriptTerminalBuffer?.resetToken;
      load([]);
      await draw();
      expect(harness.getLatest().selectedScriptTerminalBuffer?.resetToken).toBe(resetToken);
      if (order !== "first chunk") {
        act(() => {
          harness.getLatest().applyTerminalBuffersFromEvent(
            {
              type: "script_status_changed",
              repoPath: "/repo",
              taskId: "task-7",
              updatedAt: "2026-03-25T10:00:00.000Z",
              script: buildScript({ status: "starting", runIdentity: chunk(2, 0).runIdentity }),
            },
            "frontend",
          );
        });
        if (order === "starting status") {
          await draw();
          expect(screen).toBe("");
        }
      }
      append(0);
      flushFrame();
      await draw();
      await draw();
      expect(screen).toBe("2:0,");
      expect(harness.getLatest().selectedScriptTerminalBuffer?.resetToken).toBe(
        (resetToken ?? 0) + 1,
      );
      append(1);
      flushFrame();
      await draw();
      await draw();
      expect(screen).toBe("2:0,2:1,");
      expect(writes).toEqual(["1:0,1:1,1:2,", notice, "2:0,", "2:1,"]);
    } finally {
      view.unmount();
      harness.unmount();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  },
);
