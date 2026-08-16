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

const sendStaleBuffer = (listener: TerminalFrameListener, terminalId: string): void => {
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
};

describe("retained terminal rendering", () => {
  test("hydrates stale output for every retained production terminal mount", async () => {
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
        retained.push({ container, mount, terminalId });
        const listener = listeners.get(terminalId);
        if (!listener) throw new Error(`Expected ${terminalId} to subscribe.`);
        sendStaleBuffer(listener, terminalId);
      }
      await nextFrame();

      expect(retained).toHaveLength(RETAINED_TERMINAL_BOUND);
      for (const index of [0, RETAINED_TERMINAL_BOUND - 1]) {
        const current = retained[index];
        if (!current) throw new Error("Expected retained terminal.");
        activeTerminalIds.clear();
        activeTerminalIds.add(current.terminalId);
        current.mount.activate(false);
        await nextFrame();
        expect(current.container.textContent).toContain(`${current.terminalId} stale log`);
      }
    } finally {
      for (const { container, mount } of retained) {
        mount.dispose();
        container.remove();
      }
    }
  }, 15_000);
});
