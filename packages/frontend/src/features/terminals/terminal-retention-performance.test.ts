import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Terminal } from "@xterm/xterm";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

// packages/host terminal limits: 32 live sessions + 64 retained exited sessions.
const RETAINED_TERMINAL_BOUND = 96;
const STALE_BUFFER_LINES = 2_024;
const SWITCH_COUNT = 20;
const SWITCH_LIMIT_MS = 500;

const canvasContext = {
  arc: () => undefined,
  beginPath: () => undefined,
  clearRect: () => undefined,
  clip: () => undefined,
  closePath: () => undefined,
  createImageData: () => [],
  drawImage: () => undefined,
  fill: () => undefined,
  fillRect: () => undefined,
  fillText: () => undefined,
  getImageData: () => ({ data: [] }),
  lineTo: () => undefined,
  measureText: () => ({ width: 8 }),
  moveTo: () => undefined,
  putImageData: () => undefined,
  rect: () => undefined,
  restore: () => undefined,
  rotate: () => undefined,
  save: () => undefined,
  scale: () => undefined,
  setTransform: () => undefined,
  stroke: () => undefined,
  transform: () => undefined,
  translate: () => undefined,
};

describe("retained terminal rendering", () => {
  test("shows stale real-xterm buffers within the frame budget at the host bound", async () => {
    const getContextDescriptor = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => canvasContext,
    });
    const retained: Array<{ container: HTMLDivElement; terminal: Terminal }> = [];

    try {
      for (let index = 0; index < RETAINED_TERMINAL_BOUND; index += 1) {
        const container = document.createElement("div");
        Object.defineProperties(container, {
          clientHeight: { value: 400 },
          clientWidth: { value: 800 },
        });
        container.style.visibility = "hidden";
        document.body.append(container);
        const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 2_000 });
        terminal.open(container);
        await new Promise<void>((resolve) => {
          terminal.write(`${index} stale log\r\n`.repeat(STALE_BUFFER_LINES), resolve);
        });
        retained.push({ container, terminal });
      }

      expect(retained.every(({ terminal }) => terminal.buffer.active.baseY === 2_000)).toBe(true);
      const startedAt = performance.now();
      for (let index = 0; index < SWITCH_COUNT; index += 1) {
        const current = retained[index % 2 === 0 ? 0 : RETAINED_TERMINAL_BOUND - 1];
        if (!current) throw new Error("Expected retained terminal.");
        current.container.style.visibility = "visible";
        current.terminal.scrollToBottom();
        current.terminal.refresh(0, current.terminal.rows - 1);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        current.container.style.visibility = "hidden";
      }
      const durationMs = performance.now() - startedAt;

      expect(durationMs).toBeLessThan(SWITCH_LIMIT_MS);
    } finally {
      for (const { container, terminal } of retained) {
        terminal.dispose();
        container.remove();
      }
      if (getContextDescriptor) {
        Object.defineProperty(HTMLCanvasElement.prototype, "getContext", getContextDescriptor);
      } else {
        Reflect.deleteProperty(HTMLCanvasElement.prototype, "getContext");
      }
    }
  }, 5_000);
});
