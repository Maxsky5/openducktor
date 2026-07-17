import { describe, expect, test } from "bun:test";
import { createTerminalOptions } from "./terminal-xterm-options";

const createThemedContainer = (): HTMLElement => {
  const container = document.createElement("div");
  container.style.setProperty("--dev-server-terminal-panel", "rgb(10, 11, 12)");
  container.style.setProperty("--dev-server-terminal-foreground", "rgb(240, 241, 242)");
  container.style.setProperty("--dev-server-terminal-selection", "rgba(80, 120, 255, 0.4)");
  container.style.setProperty(
    "--dev-server-terminal-selection-inactive",
    "rgba(80, 120, 255, 0.2)",
  );
  return container;
};

describe("createTerminalOptions", () => {
  test("keeps one terminal cell per TUI row", () => {
    const options = createTerminalOptions(createThemedContainer(), {});

    expect(options.lineHeight).toBe(1);
  });
});
