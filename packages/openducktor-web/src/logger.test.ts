import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { OpenDucktorLogPersistenceError } from "@openducktor/host";
import { Effect } from "effect";
import { createWebLogger } from "./logger";

const createConsoleOutput = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    console: {
      log(message: string) {
        stdout.push(message);
      },
      error(message: string) {
        stderr.push(message);
      },
    },
    stderr,
    stdout,
  };
};

describe("createWebLogger", () => {
  test("preserves INFO, success, and ERROR console formatting while persisting plain records", async () => {
    const configDirectory = mkdtempSync(path.join(tmpdir(), "openducktor-web-logger-"));
    try {
      const output = createConsoleOutput();
      const logger = await Effect.runPromise(
        createWebLogger({
          console: output.console,
          environment: { FORCE_COLOR: "1", OPENDUCKTOR_CONFIG_DIR: configDirectory },
          now: () => new Date(2026, 4, 13, 23, 45, 12, 345),
          stdout: { isTTY: false },
        }),
      );

      await Effect.runPromise(logger.info("Starting host"));
      await Effect.runPromise(logger.success("OpenDucktor web is ready:"));
      await Effect.runPromise(logger.success("  ➜  Local:   http://localhost:1420/"));
      await Effect.runPromise(logger.error("Host failed\nstack detail"));

      expect(output.stdout).toHaveLength(3);
      expect(output.stderr).toHaveLength(1);
      expect(output.stdout[0]).toContain("\u001b[2m2026-05-13T23:45:12.345");
      expect(output.stdout[1]).toContain("\u001b[1m\u001b[32mOpenDucktor web is ready:");
      expect(output.stdout[2]).toContain("\u001b[35m➜");
      expect(output.stderr[0]).toContain("\u001b[31mERROR\u001b[0m");

      const persisted = readFileSync(
        path.join(configDirectory, "logs", "openducktor-web-2026-05-13.log"),
        "utf8",
      );
      expect(persisted).not.toContain("\u001b[");
      expect(persisted).toContain("INFO Starting host\n");
      expect(persisted).toContain("INFO OpenDucktor web is ready:\n");
      expect(persisted).toContain("INFO   ➜  Local:   http://localhost:1420/\n");
      expect(persisted).toContain("ERROR Host failed\nstack detail\n");
      expect(persisted.endsWith("\n")).toBeTrue();
    } finally {
      rmSync(configDirectory, { force: true, recursive: true });
    }
  });

  test("keeps console output plain when color is disabled", async () => {
    const output = createConsoleOutput();
    const logger = await Effect.runPromise(
      createWebLogger({
        console: output.console,
        environment: { NO_COLOR: "1" },
        now: () => new Date(2026, 4, 13, 23, 45, 12, 345),
        stdout: { isTTY: true },
        writer: { append: () => Effect.void },
      }),
    );

    await Effect.runPromise(logger.info("Starting host"));
    await Effect.runPromise(logger.success("Host ready"));
    await Effect.runPromise(logger.error("Host failed"));

    expect(output.stdout).toEqual([
      expect.stringMatching(/^2026-05-13T23:45:12\.345[+-]\d\d:\d\d {2}INFO Starting host$/),
      expect.stringMatching(/^2026-05-13T23:45:12\.345[+-]\d\d:\d\d {2}INFO Host ready$/),
    ]);
    expect(output.stderr).toEqual([
      expect.stringMatching(/^2026-05-13T23:45:12\.345[+-]\d\d:\d\d {2}ERROR Host failed$/),
    ]);
  });

  test("uses one observed time for rendering and file routing", async () => {
    const output = createConsoleOutput();
    const recordedAt = new Date(2026, 4, 13, 23, 59, 59, 999);
    const appended: Array<{ recordedAt: Date; record: string }> = [];
    const logger = await Effect.runPromise(
      createWebLogger({
        console: output.console,
        environment: { NO_COLOR: "1" },
        now: () => recordedAt,
        writer: {
          append: (date, record) => Effect.sync(() => appended.push({ recordedAt: date, record })),
        },
      }),
    );

    await Effect.runPromise(logger.info("boundary record"));

    const rendered = output.stdout[0];
    if (!rendered) {
      throw new Error("Expected the web logger to render the boundary record.");
    }
    expect(appended).toEqual([
      {
        recordedAt,
        record: rendered,
      },
    ]);
  });

  test("propagates persistent writer failures", async () => {
    const output = createConsoleOutput();
    const failure = new OpenDucktorLogPersistenceError({
      message: "openducktor.logs.append failed for /logs/file.log",
      operation: "openducktor.logs.append",
      path: "/logs/file.log",
      cause: new Error("append failed"),
    });
    const logger = await Effect.runPromise(
      createWebLogger({
        console: output.console,
        writer: {
          append: () => Effect.fail(failure),
        },
      }),
    );

    await expect(Effect.runPromise(Effect.flip(logger.error("Launcher failed")))).resolves.toBe(
      failure,
    );
    expect(output.stderr).toHaveLength(1);
    expect(output.stderr[0]).toContain("ERROR Launcher failed");
  });
});
