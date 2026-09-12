import { describe, expect, mock, spyOn, test } from "bun:test";
import { FitAddon } from "@xterm/addon-fit";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Terminal } from "@xterm/xterm";
import { createTerminalBinding } from "./shared-terminal-binding";

if (globalThis.document === undefined) GlobalRegistrator.register();

describe("shared terminal binding", () => {
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
