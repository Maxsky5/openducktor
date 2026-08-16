import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TERMINAL_PROTOCOL_VERSION, type TerminalServerMessage } from "@openducktor/contracts";
import {
  type InteractiveTerminalMount,
  mountInteractiveTerminal,
} from "./interactive-terminal-mount";
import type {
  TerminalFrameListener,
  TerminalTransportController,
} from "./terminal-transport-controller";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

// packages/host terminal limits: 32 live sessions + 64 retained exited sessions.
const RETAINED_TERMINAL_BOUND = 96;
const STALE_BUFFER_LINES = 2_024;
const SWITCH_COUNT = 20;
const SWITCH_LIMIT_MS = 50;

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

const createController = () => {
  const listeners = new Map<string, TerminalFrameListener>();
  const controller: TerminalTransportController = {
    acknowledge: async () => undefined,
    closeTerminal: async <Result extends { closed: boolean }>(
      _terminalId: string,
      closeHostTerminal: () => Promise<Result>,
    ) => closeHostTerminal(),
    connect: async () => undefined,
    dispose: async () => undefined,
    releaseEmulator: () => undefined,
    resize: async () => undefined,
    subscribe: (terminalId: string, listener: TerminalFrameListener) => {
      listeners.set(terminalId, listener);
      return () => {
        listeners.delete(terminalId);
      };
    },
    write: async () => undefined,
  };
  return { controller, listeners };
};

const sendStaleBuffer = async (
  listener: TerminalFrameListener,
  terminalId: string,
): Promise<void> => {
  const payload = new TextEncoder().encode(
    `${terminalId} stale log\r\n`.repeat(STALE_BUFFER_LINES),
  );
  const snapshot: TerminalServerMessage = {
    version: TERMINAL_PROTOCOL_VERSION,
    type: "snapshot",
    terminalId,
    earliestRetainedSequence: 0,
    snapshotSequenceEnd: payload.byteLength,
    lifecycle: "running",
    title: terminalId,
    complete: true,
  };
  listener(snapshot, new Uint8Array());
  listener(
    {
      version: TERMINAL_PROTOCOL_VERSION,
      type: "output",
      terminalId,
      sequenceStart: 0,
      sequenceEnd: payload.byteLength,
      replay: true,
    },
    payload,
  );
  await nextFrame();
};

describe("retained terminal rendering", () => {
  test("shows stale production terminal mounts within each frame budget at the host bound", async () => {
    const { controller, listeners } = createController();
    const activeTerminalIds = new Set<string>(["terminal-0"]);
    const retained: Array<{
      container: HTMLDivElement;
      mount: InteractiveTerminalMount;
      terminalId: string;
    }> = [];

    try {
      for (let index = 0; index < RETAINED_TERMINAL_BOUND; index += 1) {
        const terminalId = `terminal-${index}`;
        const container = document.createElement("div");
        Object.defineProperties(container, {
          clientHeight: { value: 400 },
          clientWidth: { value: 800 },
        });
        container.style.visibility = "hidden";
        document.body.append(container);
        const mount = mountInteractiveTerminal({
          container,
          terminalId,
          controller,
          isActive: () => activeTerminalIds.has(terminalId),
          getPlatform: () => "darwin",
          stageFile: async () => "/tmp/image.png",
          preparePathInput: async () => "/tmp/image.png",
          writeClipboard: async () => undefined,
          onAttention: () => undefined,
          onLifecycle: () => undefined,
          onForgotten: () => undefined,
          onTitleChange: () => undefined,
          onHydrated: () => undefined,
          onImageDragActiveChange: () => undefined,
          onInteractionFailure: () => undefined,
        });
        const listener = listeners.get(terminalId);
        if (!listener) throw new Error(`Expected ${terminalId} to subscribe.`);
        await sendStaleBuffer(listener, terminalId);
        retained.push({ container, mount, terminalId });
      }

      for (let index = 0; index < SWITCH_COUNT; index += 1) {
        const current = retained[index % 2 === 0 ? 0 : RETAINED_TERMINAL_BOUND - 1];
        if (!current) throw new Error("Expected retained terminal.");
        activeTerminalIds.clear();
        activeTerminalIds.add(current.terminalId);
        const startedAt = performance.now();
        current.container.style.visibility = "visible";
        current.mount.activate(false);
        await nextFrame();
        const durationMs = performance.now() - startedAt;
        expect(current.container.textContent).toContain(`${current.terminalId} stale log`);
        expect(durationMs).toBeLessThan(SWITCH_LIMIT_MS);
        current.container.style.visibility = "hidden";
      }
    } finally {
      for (const { container, mount } of retained) {
        mount.dispose();
        container.remove();
      }
    }
  }, 15_000);
});
