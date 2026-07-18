import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { ElectronMainLogger } from "./electron-main-logger";
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
});
