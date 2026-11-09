import { describe, expect, mock, spyOn, test } from "bun:test";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Terminal } from "@xterm/xterm";
import { createTerminalBinding } from "./shared-terminal-binding";
import { createTerminalOptions } from "./terminal-xterm-options";

if (globalThis.document === undefined) GlobalRegistrator.register();

const fakeWebglRenderer = (initializationFailure?: Error) => {
  const events: string[] = [];
  let notifyContextLoss: () => void = () => {
    throw new Error("Expected a renderer context-loss subscription.");
  };
  const activate = spyOn(WebglAddon.prototype, "activate").mockImplementation(function (
    this: WebglAddon,
    terminal,
  ) {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getContext", {
      value: (kind: string) =>
        kind === "webgl2"
          ? { getExtension: () => ({ loseContext: () => events.push("release") }) }
          : null,
    });
    terminal.element?.querySelector(".xterm-screen")?.append(canvas);
    if (initializationFailure) throw initializationFailure;
    spyOn(this, "onContextLoss").mockImplementation((listener) => {
      notifyContextLoss = () => listener();
      return { dispose: () => events.push("unsubscribe") };
    });
    const originalDispose = this.dispose.bind(this);
    spyOn(this, "dispose").mockImplementation(() => {
      events.push("dispose");
      originalDispose();
      canvas.remove();
    });
  });
  return { activate, events, notifyContextLoss: () => notifyContextLoss() };
};

describe("shared terminal binding", () => {
  test("keeps xterm screen-reader mode off, so output adds no accessible row updates", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const binding = createTerminalBinding(
      container,
      createTerminalOptions(container, {}),
      () => undefined,
    );
    try {
      await new Promise<void>((resolve) =>
        binding.write(new TextEncoder().encode("line 1\r\nline 2"), resolve),
      );

      expect(binding.terminal.options.screenReaderMode).toBe(false);
      expect(container.querySelector(".xterm-accessibility")).toBeNull();
    } finally {
      binding.dispose();
      container.remove();
    }
  });

  test("reports a WebGL constructor failure while keeping the standard terminal usable", async () => {
    const NativeWebglAddon = WebglAddon;
    const failure = new Error("Webgl2 is only supported on Safari 16 and above");
    const report = mock((_cause: Error) => undefined);
    let binding: ReturnType<typeof createTerminalBinding>;
    mock.module("@xterm/addon-webgl", () => ({
      WebglAddon: class {
        constructor() {
          throw failure;
        }
      },
    }));
    try {
      binding = createTerminalBinding(document.createElement("div"), {}, report);
    } finally {
      mock.module("@xterm/addon-webgl", () => ({ WebglAddon: NativeWebglAddon }));
    }
    try {
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]?.[0].cause).toBe(failure);
      await new Promise<void>((resolve) =>
        binding.write(new TextEncoder().encode("usable"), resolve),
      );
      expect(binding.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("usable");
    } finally {
      binding.dispose();
    }
  });

  test("reports unavailable WebGL while keeping terminal output readable", async () => {
    const failure = new Error("WebGL2 not supported null");
    const activate = spyOn(WebglAddon.prototype, "activate").mockImplementation(() => {
      throw failure;
    });
    const report = mock((_cause: Error) => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const binding = createTerminalBinding(container, {}, report);
    const write = spyOn(binding.terminal, "write");
    try {
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("WebGL2 not supported"),
        }),
      );
      await new Promise<void>((resolve) =>
        binding.write(
          new TextEncoder().encode("output stays available" + "x".repeat(32_768)),
          resolve,
        ),
      );
      expect(write).toHaveBeenCalledTimes(1);
      expect(binding.terminal.buffer.active.getLine(0)?.translateToString(true)).toStartWith(
        "output stays available",
      );
    } finally {
      write.mockRestore();
      binding.dispose();
      container.remove();
      activate.mockRestore();
    }
  });

  test("bounds xterm writes and completes only after the final chunk is parsed", () => {
    const renderer = fakeWebglRenderer();
    const container = document.createElement("div");
    const binding = createTerminalBinding(container, {}, () => undefined);
    const writes: Array<{ bytes: Uint8Array; parsed: (() => void) | undefined }> = [];
    const write = spyOn(binding.terminal, "write").mockImplementation((bytes, parsed) => {
      // SAFETY: TerminalBinding.write accepts binary output only.
      writes.push({ bytes: bytes as Uint8Array, parsed });
    });
    const payload = new TextEncoder().encode(
      "x".repeat(16_383) + "🐤\u001b[31mred\u001b[0m".repeat(2_000),
    );
    const parsed = mock(() => undefined);
    try {
      binding.write(payload, parsed);
      expect(writes.length).toBeGreaterThan(1);
      expect(writes.every(({ bytes }) => bytes.byteLength <= 16 * 1024)).toBe(true);
      const combined = new Uint8Array(payload.byteLength);
      let offset = 0;
      for (const chunk of writes) {
        combined.set(chunk.bytes, offset);
        offset += chunk.bytes.byteLength;
      }
      expect(combined).toEqual(payload);
      expect(writes.slice(0, -1).every((chunk) => chunk.parsed === undefined)).toBe(true);
      expect(parsed).not.toHaveBeenCalled();
      writes.at(-1)?.parsed?.();
      expect(parsed).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
      binding.dispose();
      renderer.activate.mockRestore();
    }
  });

  test.each([
    ["UTF-8", "x".repeat(16_383) + "🐤", "Z"],
    ["CSI", "x".repeat(16_382) + "\u001b[38;5;", "123mZ"],
    ["OSC", "x".repeat(16_382) + "\u001b]777;payload", "\u0007Z"],
    ["DCS", "x".repeat(16_382) + "\u001bPqpayload", "\u001b\\Z"],
  ])("preserves %s state across bounded writes and later output", async (kind, initial, later) => {
    const renderer = fakeWebglRenderer();
    const binding = createTerminalBinding(
      document.createElement("div"),
      { allowProposedApi: true },
      () => undefined,
    );
    const controls: string[] = [];
    const osc = binding.terminal.parser.registerOscHandler(777, (data) => {
      controls.push(data);
      return true;
    });
    const dcs = binding.terminal.parser.registerDcsHandler({ final: "q" }, (data) => {
      controls.push(data);
      return true;
    });
    try {
      await new Promise<void>((resolve) =>
        binding.write(new TextEncoder().encode(initial), resolve),
      );
      expect(controls).toEqual([]);
      await new Promise<void>((resolve) => binding.write(new TextEncoder().encode(later), resolve));
      const buffer = binding.terminal.buffer.active;
      const line = buffer.getLine(buffer.baseY + buffer.cursorY);
      expect(line?.translateToString(true).endsWith(kind === "UTF-8" ? "🐤Z" : "Z")).toBe(true);
      expect(controls).toEqual(kind === "OSC" || kind === "DCS" ? ["payload"] : []);
      if (kind === "CSI") expect(line?.getCell(buffer.cursorX - 1)?.getFgColor()).toBe(123);
    } finally {
      osc.dispose();
      dcs.dispose();
      binding.dispose();
      renderer.activate.mockRestore();
    }
  });

  test("disposes a partially initialized emulator before publishing a clean standard terminal", async () => {
    const renderer = fakeWebglRenderer(new Error("shader program allocation failed"));
    const report = mock((_cause: Error) => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const binding = createTerminalBinding(container, {}, report);
    try {
      expect(report).toHaveBeenCalledTimes(1);
      expect(renderer.events).toEqual(["release"]);
      expect(container.querySelectorAll(".xterm")).toHaveLength(1);
      expect(container.querySelectorAll("canvas")).toHaveLength(0);
      await new Promise<void>((resolve) =>
        binding.write(new TextEncoder().encode("clean terminal"), resolve),
      );
      expect(binding.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
        "clean terminal",
      );
    } finally {
      binding.dispose();
      container.remove();
      renderer.activate.mockRestore();
    }
  });

  test.each(["disposal", "context loss"] as const)(
    "releases the public WebGL context on %s",
    async (reason) => {
      const renderer = fakeWebglRenderer();
      const report = mock((_cause: Error) => undefined);
      const binding = createTerminalBinding(document.createElement("div"), {}, report);
      try {
        expect(renderer.activate).toHaveBeenCalledTimes(1);
        if (reason === "context loss") {
          const originalTerminal = binding.terminal;
          renderer.notifyContextLoss();
          expect(report).toHaveBeenCalledTimes(1);
          expect(report.mock.calls[0]?.[0].message).toContain("graphics acceleration stopped");
          const write = spyOn(binding.terminal, "write");
          await new Promise<void>((resolve) =>
            binding.write(new TextEncoder().encode("still usable" + "x".repeat(32_768)), resolve),
          );
          expect(binding.terminal).toBe(originalTerminal);
          expect(write).toHaveBeenCalledTimes(1);
          write.mockRestore();
          expect(binding.terminal.buffer.active.getLine(0)?.translateToString(true)).toStartWith(
            "still usable",
          );
        }
        binding.dispose();
        binding.dispose();
        expect(renderer.events).toEqual(["unsubscribe", "dispose", "release"]);
      } finally {
        binding.dispose();
        renderer.activate.mockRestore();
      }
    },
  );

  test("updates colors on a theme change without resizing the screen", async () => {
    const root = document.documentElement;
    const originalClass = root.className;
    const container = document.createElement("div");
    container.style.setProperty("--terminal-foreground", "#eeeeee");
    container.style.setProperty("--terminal-panel", "#171717");
    document.body.append(container);
    const binding = createTerminalBinding(
      container,
      createTerminalOptions(container, {}),
      () => undefined,
    );
    const resize = spyOn(binding.terminal, "resize");
    try {
      container.style.setProperty("--terminal-foreground", "#202020");
      container.style.setProperty("--terminal-panel", "#ffffff");
      root.classList.toggle("dark");
      await Bun.sleep(0);
      expect(binding.terminal.options.theme?.foreground).toBe("#202020");
      expect(binding.terminal.options.theme?.background).toBe("#ffffff");
      expect(resize).not.toHaveBeenCalled();
    } finally {
      binding.dispose();
      resize.mockRestore();
      root.className = originalClass;
      container.remove();
    }
  });

  test("keeps the grid while collapsed and applies only changed visible dimensions", () => {
    const container = document.createElement("div");
    let width = 0;
    let height = 0;
    Object.defineProperties(container, {
      clientWidth: { get: () => width },
      clientHeight: { get: () => height },
    });
    document.body.append(container);
    const dimensions = spyOn(FitAddon.prototype, "proposeDimensions").mockReturnValue({
      cols: 120,
      rows: 40,
    });
    const binding = createTerminalBinding(container, {}, () => undefined);
    const resize = spyOn(binding.terminal, "resize");
    try {
      binding.fitAddon.fit();
      expect([binding.terminal.cols, binding.terminal.rows]).toEqual([80, 24]);
      width = 800;
      height = 400;
      binding.fitAddon.fit();
      binding.fitAddon.fit();
      expect([binding.terminal.cols, binding.terminal.rows]).toEqual([120, 40]);
      expect(resize).toHaveBeenCalledTimes(1);
      dimensions.mockReturnValue({ cols: 2, rows: 1 });
      binding.fitAddon.fit();
      expect([binding.terminal.cols, binding.terminal.rows]).toEqual([120, 40]);
      dimensions.mockReturnValue({ cols: Number.NaN, rows: 24 });
      binding.fitAddon.fit();
      expect(resize).toHaveBeenCalledTimes(1);
    } finally {
      resize.mockRestore();
      dimensions.mockRestore();
      binding.dispose();
      container.remove();
    }
  });
  test("disposes the terminal once", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const binding = createTerminalBinding(container, {}, () => undefined);
    const dispose = mock(binding.terminal.dispose.bind(binding.terminal));
    binding.terminal.dispose = dispose;

    try {
      binding.dispose();
      binding.dispose();
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      binding.dispose();
      container.remove();
    }
  });

  test("disposes created resources when setup fails", () => {
    const failure = new Error("open failed");
    const open = spyOn(Terminal.prototype, "open").mockImplementation(() => {
      throw failure;
    });
    const disposeTerminal = spyOn(Terminal.prototype, "dispose");
    const disposeFit = spyOn(FitAddon.prototype, "dispose");
    const container = document.createElement("div");

    try {
      expect(() => createTerminalBinding(container, {}, () => undefined)).toThrow(failure);
      expect(disposeTerminal).toHaveBeenCalledTimes(1);
      expect(disposeFit).toHaveBeenCalledTimes(1);
    } finally {
      open.mockRestore();
      disposeTerminal.mockRestore();
      disposeFit.mockRestore();
    }
  });
});
