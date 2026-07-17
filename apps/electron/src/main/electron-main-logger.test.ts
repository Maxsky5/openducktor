import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { OpenDucktorLogPersistenceError } from "@openducktor/host";
import { Effect } from "effect";
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
  test("formats host logs like the legacy human logger without ANSI when color is disabled", async () => {
    const { stream, output } = createLogStream(true);
    const logger = await Effect.runPromise(
      createElectronMainLogger({
        env: { NO_COLOR: "1" },
        now: () => new Date(2026, 4, 13, 23, 45, 12, 345),
        stream,
        writer: { append: () => Effect.void },
      }),
    );

    const result = logger.info("OpenDucktor host services stopped");

    expect(result).toBeUndefined();
    expect(output()).toMatch(
      /^2026-05-13T23:45:12\.345[+-]\d\d:\d\d {2}INFO OpenDucktor host services stopped\n$/,
    );
  });

  test("uses ANSI colors when FORCE_COLOR is enabled", async () => {
    const { stream, output } = createLogStream(false);
    const logger = await Effect.runPromise(
      createElectronMainLogger({
        env: { FORCE_COLOR: "1" },
        now: () => new Date(2026, 4, 13, 23, 45, 12, 345),
        stream,
        writer: { append: () => Effect.void },
      }),
    );

    await logger.error("OpenDucktor host shutdown failed", new Error("cleanup failed"));

    const rendered = output();
    expect(rendered).toContain("\u001b[2m2026-05-13T23:45:12.345");
    expect(rendered).toContain("\u001b[31mERROR\u001b[0m");
    expect(rendered).toContain("\u001b[31mOpenDucktor host shutdown failed: Error: cleanup failed");
  });

  test("persists INFO, WARN, and multiline ERROR records without ANSI", async () => {
    const configDirectory = mkdtempSync(path.join(tmpdir(), "openducktor-electron-logger-"));
    try {
      const { stream, output } = createLogStream(false);
      const logger = await Effect.runPromise(
        createElectronMainLogger({
          env: { FORCE_COLOR: "1", OPENDUCKTOR_CONFIG_DIR: configDirectory },
          now: () => new Date(2026, 4, 13, 23, 45, 12, 345),
          stream,
        }),
      );

      await logger.info("Host is ready");
      await logger.warn("Host warning");
      const failure = new Error("cleanup failed");
      failure.stack = "Error: cleanup failed\n    at shutdown (host.ts:1:1)";
      await logger.error("Host shutdown failed", failure);

      expect(output()).toContain("\u001b[");
      const persisted = readFileSync(
        path.join(configDirectory, "logs", "openducktor-electron-2026-05-13.log"),
        "utf8",
      );
      expect(persisted).not.toContain("\u001b[");
      expect(persisted).toContain("INFO Host is ready\n");
      expect(persisted).toContain("WARN Host warning\n");
      expect(persisted).toContain(
        "ERROR Host shutdown failed: Error: cleanup failed\n    at shutdown (host.ts:1:1)\n",
      );
      expect(persisted.endsWith("\n")).toBeTrue();
    } finally {
      rmSync(configDirectory, { force: true, recursive: true });
    }
  });

  test("uses the same observed time for console rendering and file routing", async () => {
    const { stream, output } = createLogStream();
    const recordedAt = new Date(2026, 4, 13, 23, 59, 59, 999);
    const appended: Array<{ recordedAt: Date; record: string }> = [];
    const logger = await Effect.runPromise(
      createElectronMainLogger({
        env: { NO_COLOR: "1" },
        now: () => recordedAt,
        stream,
        writer: {
          append: (date, record) => Effect.sync(() => appended.push({ recordedAt: date, record })),
        },
      }),
    );

    await logger.info("boundary record");

    expect(appended).toEqual([
      {
        recordedAt,
        record: output().trimEnd(),
      },
    ]);
  });

  test("propagates persistent writer failures", async () => {
    const { stream } = createLogStream();
    const failure = new OpenDucktorLogPersistenceError({
      message: "openducktor.logs.append failed for /logs/file.log",
      operation: "openducktor.logs.append",
      path: "/logs/file.log",
      cause: new Error("append failed"),
    });
    const logger = await Effect.runPromise(
      createElectronMainLogger({
        stream,
        writer: {
          append: () => Effect.fail(failure),
        },
      }),
    );

    expect(() => logger.info("Host is ready")).toThrow(failure);
  });
});
