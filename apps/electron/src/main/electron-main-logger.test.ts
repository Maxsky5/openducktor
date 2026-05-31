import { describe, expect, test } from "bun:test";
import { createElectronMainLogger } from "./electron-main-logger";

const createLogStream = (isTTY = false) => {
  let output = "";
  return {
    stream: {
      isTTY,
      write(chunk: string) {
        output += chunk;
      },
    },
    output: () => output,
  };
};

describe("createElectronMainLogger", () => {
  test("formats host logs like the legacy human logger without ANSI when color is disabled", () => {
    const { stream, output } = createLogStream(true);
    const logger = createElectronMainLogger({
      env: { NO_COLOR: "1" },
      now: () => new Date(2026, 4, 13, 23, 45, 12, 345),
      stream,
    });

    logger.info("OpenDucktor host services stopped");

    expect(output()).toMatch(
      /^2026-05-13T23:45:12\.345[+-]\d\d:\d\d {2}INFO OpenDucktor host services stopped\n$/,
    );
  });

  test("uses ANSI colors when FORCE_COLOR is enabled", () => {
    const { stream, output } = createLogStream(false);
    const logger = createElectronMainLogger({
      env: { FORCE_COLOR: "1" },
      now: () => new Date(2026, 4, 13, 23, 45, 12, 345),
      stream,
    });

    logger.error("OpenDucktor host shutdown failed", new Error("cleanup failed"));

    const rendered = output();
    expect(rendered).toContain("\u001b[2m2026-05-13T23:45:12.345");
    expect(rendered).toContain("\u001b[31mERROR\u001b[0m");
    expect(rendered).toContain("\u001b[31mOpenDucktor host shutdown failed: Error: cleanup failed");
  });
});
