import { describe, expect, mock, spyOn, test } from "bun:test";
import { FitAddon } from "@xterm/addon-fit";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Terminal } from "@xterm/xterm";
import { createTerminalBinding } from "./shared-terminal-binding";
import { createTerminalOptions } from "./terminal-xterm-options";

if (globalThis.document === undefined) GlobalRegistrator.register();

describe("shared terminal binding", () => {
  test("updates colors on a theme change without resizing the screen", async () => {
    const root = document.documentElement;
    const originalClass = root.className;
    const container = document.createElement("div");
    container.style.setProperty("--terminal-foreground", "#eeeeee");
    container.style.setProperty("--terminal-panel", "#171717");
    document.body.append(container);
    const binding = createTerminalBinding(container, createTerminalOptions(container, {}));
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
    const binding = createTerminalBinding(container, {});
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
    const binding = createTerminalBinding(container, {});
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
      expect(() => createTerminalBinding(container, {})).toThrow(failure);
      expect(disposeTerminal).toHaveBeenCalledTimes(1);
      expect(disposeFit).toHaveBeenCalledTimes(1);
    } finally {
      open.mockRestore();
      disposeTerminal.mockRestore();
      disposeFit.mockRestore();
    }
  });
});
