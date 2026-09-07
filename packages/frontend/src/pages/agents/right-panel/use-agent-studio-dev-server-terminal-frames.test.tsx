import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerEvent, DevServerTerminalChunk } from "@openducktor/contracts";
import { act, render } from "@testing-library/react";
import { AgentStudioDevServerTerminal } from "@/components/features/agents/agent-studio-dev-server-terminal";
import * as logBuffer from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import { buildScript, buildState } from "./use-agent-studio-dev-server-panel-test-fixtures";
import { renderDevServerPanelHook } from "./use-agent-studio-dev-server-panel-test-harness";
import { useAgentStudioDevServerTerminalBuffers } from "./use-agent-studio-dev-server-terminal-buffers";

if (globalThis.document === undefined) GlobalRegistrator.register();

const chunk = (sequence: number, scriptId = "frontend"): DevServerTerminalChunk => ({
  scriptId,
  sequence,
  runIdentity: { runId: `${scriptId}:1`, runOrder: { hostInstanceId: "host-1", generation: 1 } },
  data: `${scriptId}-${sequence}\r\n`,
  timestamp: "2026-03-25T10:00:00.000Z",
});
const event = (sequence: number, scriptId = "frontend"): DevServerEvent => ({
  type: "terminal_chunk",
  repoPath: "/repo",
  taskId: "task-7",
  terminalChunk: chunk(sequence, scriptId),
});
const createHarness = () =>
  renderDevServerPanelHook(useAgentStudioDevServerTerminalBuffers, {
    repoPath: "/repo",
    taskId: "task-7",
  });

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let requestFrame: ReturnType<typeof spyOn<typeof globalThis, "requestAnimationFrame">>;
let cancelFrame: ReturnType<typeof spyOn<typeof globalThis, "cancelAnimationFrame">>;
const flushFrame = () => {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of callbacks) callback(0);
  });
};
beforeEach(() => {
  requestFrame = spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  cancelFrame = spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});
afterEach(() => {
  requestFrame.mockRestore();
  cancelFrame.mockRestore();
  frames.clear();
});

describe("dev server terminal frame publication", () => {
  test("publishes one immutable full-buffer snapshot for a 100-chunk burst", () => {
    const harness = createHarness();
    const readBuffer = spyOn(logBuffer, "getDevServerTerminalBuffer");
    try {
      act(() => {
        harness.getLatest().replaceTerminalBuffersFromState(
          buildState({
            scripts: [
              buildScript({
                bufferedTerminalChunks: Array.from({ length: 2_000 }, (_, index) => chunk(index)),
              }),
            ],
          }),
          "frontend",
        );
      });
      const previous = harness.getLatest().selectedScriptTerminalBuffer;
      readBuffer.mockClear();
      for (let sequence = 2_000; sequence < 2_100; sequence += 1) {
        act(() => {
          harness.getLatest().applyTerminalBuffersFromEvent(event(sequence), "frontend");
        });
      }
      expect(readBuffer).toHaveBeenCalledTimes(0);
      expect(requestFrame).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().selectedScriptTerminalBuffer).toBe(previous);
      flushFrame();
      expect(readBuffer).toHaveBeenCalledTimes(1);
      const published = harness.getLatest().selectedScriptTerminalBuffer;
      expect(published?.entries).toHaveLength(2_000);
      expect(published?.entries[0]?.sequence).toBe(100);
      expect(published?.lastSequence).toBe(2_099);
      expect(previous?.entries[0]?.sequence).toBe(0);
      expect(previous?.lastSequence).toBe(1_999);
    } finally {
      readBuffer.mockRestore();
      harness.unmount();
    }
  });

  test.each([0, 5_000])(
    "reports new-run overflow before one frame without reusing prior cursor %i",
    async (priorSequence) => {
      const harness = createHarness();
      const writes: string[] = [];
      let screen = "";
      const createTerminalBinding = () => ({
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
            writes.push(data);
            screen += data;
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
      const newRunEvent = (sequence: number): DevServerEvent => ({
        type: "terminal_chunk",
        repoPath: "/repo",
        taskId: "task-7",
        terminalChunk: {
          ...chunk(sequence),
          data: `${sequence},`,
          runIdentity: {
            runId: "frontend:2",
            runOrder: { hostInstanceId: "host-1", generation: 2 },
          },
        },
      });
      act(() => {
        harness.getLatest().applyTerminalBuffersFromEvent(event(priorSequence), "frontend");
      });
      flushFrame();
      const previousResetToken = harness.getLatest().selectedScriptTerminalBuffer?.resetToken;
      const view = render(element());
      try {
        await act(async () => {});
        expect(screen).toBe(`frontend-${priorSequence}\r\n`);
        requestFrame.mockClear();
        act(() => {
          for (let sequence = 0; sequence <= 2_000; sequence += 1) {
            harness.getLatest().applyTerminalBuffersFromEvent(newRunEvent(sequence), "frontend");
          }
        });
        expect(requestFrame).toHaveBeenCalledTimes(1);
        expect(screen).toBe(`frontend-${priorSequence}\r\n`);
        flushFrame();
        const buffer = harness.getLatest().selectedScriptTerminalBuffer;
        expect(buffer?.resetToken).toBe((previousResetToken ?? 0) + 1);
        expect(buffer?.evictedThroughSequence).toBe(0);
        expect(buffer?.entries).toHaveLength(2_000);
        await act(async () => {
          view.rerender(element());
        });
        const retainedReplay =
          "[Dev server output exceeded the 2,000-chunk buffer. Showing retained output.]\r\n" +
          Array.from({ length: 2_000 }, (_, index) => `${index + 1},`).join("");
        expect(screen).toBe(retainedReplay);
        expect(writes).toEqual([`frontend-${priorSequence}\r\n`, retainedReplay]);
        act(() => {
          harness.getLatest().applyTerminalBuffersFromEvent(newRunEvent(2_001), "frontend");
        });
        flushFrame();
        await act(async () => {
          view.rerender(element());
        });
        await act(async () => {
          view.rerender(element());
        });
        expect(screen).toBe(`${retainedReplay}2001,`);
        expect(writes).toEqual([`frontend-${priorSequence}\r\n`, retainedReplay, "2001,"]);
      } finally {
        view.unmount();
        harness.unmount();
      }
    },
  );

  test("cancels pending publication on selection, clear, scope change, and unmount", () => {
    const harness = createHarness();
    try {
      act(() => {
        harness.getLatest().applyTerminalBuffersFromEvent(event(0), "frontend");
        harness.getLatest().applyTerminalBuffersFromEvent(event(0, "backend"), "frontend");
      });
      const staleFrame = [...frames.values()][0];
      act(() => {
        harness.getLatest().syncSelectedScriptTerminalBuffer("backend");
      });
      expect(frames.size).toBe(0);
      act(() => {
        staleFrame?.(0);
      });
      expect(harness.getLatest().selectedScriptTerminalBuffer?.entries[0]?.scriptId).toBe(
        "backend",
      );
      act(() => {
        harness.getLatest().applyTerminalBuffersFromEvent(event(1, "backend"), "backend");
      });
      act(() => {
        harness.getLatest().clearTerminalBuffers();
      });
      expect(frames.size).toBe(0);
      expect(harness.getLatest().selectedScriptTerminalBuffer).toBeNull();
      act(() => {
        harness.getLatest().applyTerminalBuffersFromEvent(event(2), "frontend");
      });
      const oldScope = harness.getLatest();
      harness.update({ repoPath: "/repo", taskId: "task-8" });
      expect(frames.size).toBe(0);
      act(() => {
        oldScope.applyTerminalBuffersFromEvent(event(3), "frontend");
      });
      expect(frames.size).toBe(0);
      expect(harness.getLatest().selectedScriptTerminalBuffer).toBeNull();
      harness.update({ repoPath: "/repo", taskId: "task-7" });
      act(() => {
        harness.getLatest().applyTerminalBuffersFromEvent(event(4), "frontend");
      });
      expect(frames.size).toBe(1);
    } finally {
      harness.unmount();
    }
    expect(frames.size).toBe(0);
  });

  test("publishes a reset immediately and cancels the old queued frame", () => {
    const harness = createHarness();
    try {
      act(() => {
        harness.getLatest().applyTerminalBuffersFromEvent(event(0), "frontend");
      });
      flushFrame();
      const resetToken = harness.getLatest().selectedScriptTerminalBuffer?.resetToken;
      act(() => {
        harness.getLatest().applyTerminalBuffersFromEvent(event(1), "frontend");
      });
      act(() => {
        harness.getLatest().replaceTerminalBuffersFromState(
          buildState({
            scripts: [
              buildScript({
                bufferedTerminalChunks: [chunk(10)],
              }),
            ],
          }),
          "frontend",
        );
      });
      expect(frames.size).toBe(0);
      expect(harness.getLatest().selectedScriptTerminalBuffer?.resetToken).toBe(
        (resetToken ?? 0) + 1,
      );
      expect(
        harness.getLatest().selectedScriptTerminalBuffer?.entries.map((entry) => entry.sequence),
      ).toEqual([10]);
    } finally {
      harness.unmount();
    }
  });
});
