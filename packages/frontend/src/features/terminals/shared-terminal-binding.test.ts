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
  test("bounds native cursor-redraw announcements while retaining accessible rows", async () => {
    const renderer = fakeWebglRenderer();
    const container = document.createElement("div");
    document.body.append(container);
    const binding = createTerminalBinding(container, { screenReaderMode: true }, () => undefined);
    const row = "x".repeat(70);
    try {
      await new Promise<void>((resolve) =>
        binding.write(new TextEncoder().encode(("\u001b[H" + row).repeat(120)), resolve),
      );
      await Bun.sleep(1_100);
      const liveRegion = container.querySelector(".xterm-accessibility .live-region");
      expect(liveRegion?.textContent).toBe(
        "x".repeat(8_192) + "\n" + Terminal.strings.tooMuchOutput,
      );
      expect(liveRegion?.getAttribute("aria-live")).toBe("assertive");
      expect(binding.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(row);
      expect(
        container.querySelector(".xterm-accessibility-tree [role=listitem]")?.textContent,
      ).toBe(row);
      await new Promise<void>((resolve) =>
        binding.write(new TextEncoder().encode("\u001b[H" + "y".repeat(70)), resolve),
      );
      await Bun.sleep(1_100);
      expect(liveRegion?.textContent).toBe(
        "x".repeat(8_192) + "\n" + Terminal.strings.tooMuchOutput,
      );
      expect(binding.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
        "y".repeat(70),
      );
      expect(
        container.querySelector(".xterm-accessibility-tree [role=listitem]")?.textContent,
      ).toBe("y".repeat(70));
    } finally {
      binding.dispose();
      container.remove();
      renderer.activate.mockRestore();
    }
    // xterm batches native screen-reader announcements with a one-second debounce.
  }, 3_000);

  test("suspends hidden speech and restores current rows with a fresh budget", async () => {
    const renderer = fakeWebglRenderer();
    const container = document.createElement("div");
    document.body.append(container);
    const binding = createTerminalBinding(container, { screenReaderMode: false }, () => undefined);
    const terminal = binding.terminal;
    try {
      expect(container.querySelectorAll(".xterm-accessibility")).toHaveLength(0);
      await new Promise<void>((resolve) =>
        binding.write(new TextEncoder().encode(("\u001b[H" + "x".repeat(70)).repeat(120)), resolve),
      );
      binding.setVisible(true);
      await Bun.sleep(1_100);
      const firstRegion = container.querySelector<HTMLElement>(".live-region")!;
      expect(firstRegion.textContent).toBe("");
      expect(
        container.querySelector(".xterm-accessibility-tree [role=listitem]")?.textContent,
      ).toBe("x".repeat(70));
      terminal.select(0, 0, 4);
      firstRegion.textContent = "x".repeat(8_193);
      binding.setVisible(false);
      await Bun.sleep(0);
      expect(firstRegion.textContent).toBe("x".repeat(8_193));
      expect(terminal.options.screenReaderMode).toBe(false);
      expect(container.querySelectorAll(".xterm-accessibility")).toHaveLength(0);
      binding.setVisible(true);
      expect(terminal.getSelection()).toBe("xxxx");
      binding.setVisible(false);
      await new Promise<void>((resolve) =>
        binding.write(new TextEncoder().encode(("\u001b[H" + "y".repeat(70)).repeat(120)), resolve),
      );
      expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("y".repeat(70));
      binding.setVisible(true);
      const nextRegion = container.querySelector<HTMLElement>(".live-region")!;
      expect(nextRegion === firstRegion).toBe(false);
      expect(nextRegion.getAttribute("aria-live")).toBe("assertive");
      expect(nextRegion.textContent).toBe("");
      expect(
        container.querySelector(".xterm-accessibility-tree [role=listitem]")?.textContent,
      ).toBe("y".repeat(70));
      nextRegion.textContent = "z".repeat(8_193);
      await Bun.sleep(0);
      expect(nextRegion.textContent).toBe(
        "z".repeat(8_192) + "\n" + Terminal.strings.tooMuchOutput,
      );
      expect(binding.terminal).toBe(terminal);
    } finally {
      binding.dispose();
      container.remove();
      renderer.activate.mockRestore();
    }
    // xterm batches the restored accessible rows with a one-second debounce.
  }, 3_000);

  test.each([
    ["below the limit", "x".repeat(8_191), undefined],
    ["at the limit", "x".repeat(8_192), "x".repeat(8_192)],
    ["above the limit", "x".repeat(8_193), "x".repeat(8_192)],
    ["a Unicode pair inside the limit", "x".repeat(8_190) + "🐤Z", "x".repeat(8_190) + "🐤"],
    ["a Unicode pair across the limit", "x".repeat(8_191) + "🐤", "x".repeat(8_191)],
  ])("preserves announcement history %s", async (_name, input, prefix) => {
    const renderer = fakeWebglRenderer();
    const container = document.createElement("div");
    const binding = createTerminalBinding(container, { screenReaderMode: true }, () => undefined);
    const liveRegion = container.querySelector<HTMLElement>(".live-region")!;
    try {
      liveRegion.textContent = input;
      await Bun.sleep(0);
      const expected =
        prefix === undefined ? input : prefix + "\n" + Terminal.strings.tooMuchOutput;
      expect(liveRegion.textContent).toBe(expected);
      if (prefix !== undefined) {
        liveRegion.textContent += "more output";
        await Bun.sleep(0);
        expect(liveRegion.textContent).toBe(expected);
      }
    } finally {
      binding.dispose();
      renderer.activate.mockRestore();
    }
  });

  test.each(["keypress", "blur"] as const)(
    "starts a fresh announcement budget after native %s and same-task output",
    async (reset) => {
      const renderer = fakeWebglRenderer();
      const container = document.createElement("div");
      document.body.append(container);
      const binding = createTerminalBinding(container, { screenReaderMode: true }, () => undefined);
      const liveRegion = container.querySelector<HTMLElement>(".live-region")!;
      try {
        liveRegion.textContent = "x".repeat(8_193);
        await Bun.sleep(0);
        expect(liveRegion.textContent).toEndWith(Terminal.strings.tooMuchOutput);
        liveRegion.textContent += "pending output";
        if (reset === "keypress") {
          binding.terminal.textarea!.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }),
          );
        } else {
          binding.terminal.focus();
          binding.terminal.blur();
        }
        expect(liveRegion.textContent).toBe("");
        liveRegion.textContent += "x".repeat(100);
        await Bun.sleep(0);
        expect(liveRegion.textContent).toBe("x".repeat(100));
        liveRegion.textContent += "z".repeat(8_100);
        await Bun.sleep(0);
        expect(liveRegion.textContent).toBe(
          "x".repeat(100) + "z".repeat(8_092) + "\n" + Terminal.strings.tooMuchOutput,
        );
      } finally {
        binding.dispose();
        container.remove();
        renderer.activate.mockRestore();
      }
    },
  );

  test("stops pending announcement mutations when the binding is disposed", async () => {
    const renderer = fakeWebglRenderer();
    const container = document.createElement("div");
    const binding = createTerminalBinding(container, { screenReaderMode: true }, () => undefined);
    const liveRegion = container.querySelector<HTMLElement>(".live-region")!;
    try {
      liveRegion.textContent = "x".repeat(8_193);
      binding.dispose();
      await Bun.sleep(0);
      expect(liveRegion.textContent).toBe("x".repeat(8_193));
    } finally {
      binding.dispose();
      renderer.activate.mockRestore();
    }
  });

  test("cleans up pending announcements when later binding setup fails", async () => {
    const renderer = fakeWebglRenderer();
    const container = document.createElement("div");
    const failure = new Error("theme observer unavailable");
    const originalObserve = MutationObserver.prototype.observe;
    let liveRegion: HTMLElement | null = null;
    const observe = spyOn(MutationObserver.prototype, "observe").mockImplementation(function (
      this: MutationObserver,
      target,
      options,
    ) {
      if (target === document.documentElement) {
        liveRegion = container.querySelector<HTMLElement>(".live-region");
        liveRegion!.textContent = "x".repeat(8_193);
        throw failure;
      }
      originalObserve.call(this, target, options);
    });
    try {
      expect(() =>
        createTerminalBinding(container, { screenReaderMode: true }, () => undefined),
      ).toThrow(failure);
    } finally {
      observe.mockRestore();
      renderer.activate.mockRestore();
    }
    await Bun.sleep(0);
    expect(liveRegion!.textContent).toBe("x".repeat(8_193));
    expect(renderer.events).toEqual(["unsubscribe", "dispose", "release"]);
  });

  test("reports missing native accessibility DOM and releases initialized resources", () => {
    const renderer = fakeWebglRenderer();
    const originalOpen = Terminal.prototype.open;
    const open = spyOn(Terminal.prototype, "open").mockImplementation(function (
      this: Terminal,
      container,
    ) {
      originalOpen.call(this, container);
      this.element?.querySelector(".live-region")?.remove();
    });
    const container = document.createElement("div");
    try {
      expect(() =>
        createTerminalBinding(container, { screenReaderMode: true }, () => undefined),
      ).toThrow("Terminal screen-reader support did not initialize. Restart OpenDucktor");
      expect(container.querySelectorAll(".xterm")).toHaveLength(0);
      expect(renderer.events).toEqual(["unsubscribe", "dispose", "release"]);
    } finally {
      open.mockRestore();
      renderer.activate.mockRestore();
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
    const binding = createTerminalBinding(container, { screenReaderMode: true }, report);
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
      const liveRegion = container.querySelector<HTMLElement>(".live-region")!;
      liveRegion.textContent = "x".repeat(8_193);
      await Bun.sleep(0);
      expect(liveRegion.textContent).toBe(
        "x".repeat(8_192) + "\n" + Terminal.strings.tooMuchOutput,
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
