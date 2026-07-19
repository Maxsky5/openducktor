import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createElectronMainLogger, type ElectronMainLogger } from "./electron-main-logger";
import { createElectronMainRuntimeBindings } from "./electron-main-runtime-bindings";

describe("createElectronMainRuntimeBindings", () => {
  test("shares one logger with lifecycle and update consumers", async () => {
    const infos: string[] = [];
    const logger: ElectronMainLogger = {
      error: () => Effect.void,
      info: (message) => Effect.sync(() => infos.push(message)),
      warn: () => Effect.void,
    };
    const bindings = createElectronMainRuntimeBindings(logger);

    expect(bindings.lifecycleLogger).toBe(logger);
    await bindings.appUpdateLogger.info("update check completed");
    expect(infos).toEqual(["update check completed"]);
  });

  test("routes owned task failures to the configured fatal boundary", async () => {
    const logger: ElectronMainLogger = {
      error: () => Effect.void,
      info: () => Effect.void,
      warn: () => Effect.void,
    };
    const failure = new Error("menu update check failed");
    const reported: unknown[] = [];
    let markReported: () => void = () => {};
    const failureReported = new Promise<void>((resolve) => {
      markReported = resolve;
    });
    const runTask = createElectronMainRuntimeBindings(logger).createTaskRunner((cause) => {
      reported.push(cause);
      markReported();
    });

    runTask(() => Promise.reject(failure));
    await failureReported;

    expect(reported).toEqual([failure]);
  });

  test("persists rejected host commands before returning the original failure", async () => {
    const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-host-command-log-"));
    const command = "runtime.session.context-usage";
    const failure = new Error("Codex session was released while context usage was loading");
    const expectedLogMessage = `ERROR Electron host command '${command}' failed`;
    let consoleOutput = "";

    try {
      const logger = await Effect.runPromise(
        createElectronMainLogger({
          env: { NO_COLOR: "1", OPENDUCKTOR_CONFIG_DIR: configDirectory },
          now: () => new Date(2026, 6, 19, 1, 0, 47, 280),
          stream: {
            write(chunk) {
              consoleOutput += chunk;
            },
          },
        }),
      );
      const bindings = createElectronMainRuntimeBindings(logger);

      await expect(bindings.runHostCommand(command, Effect.fail(failure))).rejects.toBe(failure);

      const persisted = await readFile(
        path.join(configDirectory, "logs", "openducktor-electron-2026-07-19.log"),
        "utf8",
      );
      expect(consoleOutput).toContain(expectedLogMessage);
      expect(consoleOutput).toContain(failure.message);
      expect(persisted).toContain(expectedLogMessage);
      expect(persisted).toContain(failure.message);
    } finally {
      await rm(configDirectory, { force: true, recursive: true });
    }
  });

  test("preserves host command and persistence failures together", async () => {
    const command = "runtime.session.context-usage";
    const commandFailure = new Error("Codex session was released");
    const persistenceFailure = new Error("openducktor.logs.append failed");
    const logger: ElectronMainLogger = {
      error: () => Effect.fail(persistenceFailure),
      info: () => Effect.void,
      warn: () => Effect.void,
    };
    const bindings = createElectronMainRuntimeBindings(logger);

    await expect(
      bindings.runHostCommand(command, Effect.fail(commandFailure)),
    ).rejects.toMatchObject({
      _tag: "ElectronOperationError",
      operation: "electron.main.host-command",
      cause: commandFailure,
      details: {
        command,
        commandFailure,
        persistenceFailure,
      },
    });
  });

  test("drains an admitted host command only after its failure is persisted", async () => {
    const commandFailure = new Error("Codex session was released during shutdown");
    let markErrorStarted: () => void = () => {};
    const errorStarted = new Promise<void>((resolve) => {
      markErrorStarted = resolve;
    });
    let releaseErrorLog: () => void = () => {};
    const errorLogGate = new Promise<void>((resolve) => {
      releaseErrorLog = resolve;
    });
    let errorPersisted = false;
    const logger: ElectronMainLogger = {
      error: () =>
        Effect.tryPromise({
          try: async () => {
            markErrorStarted();
            await errorLogGate;
            errorPersisted = true;
          },
          catch: (cause) => cause,
        }),
      info: () => Effect.void,
      warn: () => Effect.void,
    };
    const bindings = createElectronMainRuntimeBindings(logger);
    const command = bindings.runHostCommand(
      "runtime.session.context-usage",
      Effect.fail(commandFailure),
    );
    await errorStarted;

    const drain = bindings.drainHostCommands();
    let drainSettled = false;
    void drain.then(() => {
      drainSettled = true;
    });
    await Promise.resolve();

    expect(drainSettled).toBe(false);
    releaseErrorLog();
    await expect(command).rejects.toBe(commandFailure);
    await drain;
    expect(errorPersisted).toBe(true);
  });

  test("rejects host commands admitted after shutdown starts", async () => {
    const logger: ElectronMainLogger = {
      error: () => Effect.void,
      info: () => Effect.void,
      warn: () => Effect.void,
    };
    const bindings = createElectronMainRuntimeBindings(logger);
    let commandRan = false;

    await bindings.drainHostCommands();

    await expect(
      bindings.runHostCommand(
        "task.list",
        Effect.sync(() => {
          commandRan = true;
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "ElectronOperationError",
      operation: "electron.main.host-command",
      details: { command: "task.list", reason: "shutdown-started" },
    });
    expect(commandRan).toBe(false);
  });
});
