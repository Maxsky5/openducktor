import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { ElectronLifecycleError } from "../effect/electron-errors";
import {
  claimElectronDevelopmentInstanceEffect,
  prepareElectronDevelopmentInstanceEffect,
} from "./electron-development-instance";

describe("claimElectronDevelopmentInstanceEffect", () => {
  test("does not claim single-instance ownership in production", async () => {
    let lockCalls = 0;
    const messages: string[] = [];

    const result = await Effect.runPromise(
      claimElectronDevelopmentInstanceEffect({
        logger: { info: (message) => Effect.sync(() => messages.push(message)) },
        profileKind: "production",
        requestSingleInstanceLock: () => {
          lockCalls += 1;
          return true;
        },
      }),
    );

    expect(result).toBe("primary");
    expect(lockCalls).toBe(0);
    expect(messages).toEqual([]);
  });

  test("continues development startup after it claims the selected profile", async () => {
    const messages: string[] = [];

    const result = await Effect.runPromise(
      claimElectronDevelopmentInstanceEffect({
        logger: { info: (message) => Effect.sync(() => messages.push(message)) },
        profileKind: "development",
        requestSingleInstanceLock: () => true,
      }),
    );

    expect(result).toBe("primary");
    expect(messages).toEqual([]);
  });

  test("logs and stops development startup when the selected profile is in use", async () => {
    const messages: string[] = [];

    const result = await Effect.runPromise(
      claimElectronDevelopmentInstanceEffect({
        logger: { info: (message) => Effect.sync(() => messages.push(message)) },
        profileKind: "development",
        requestSingleInstanceLock: () => false,
      }),
    );

    expect(result).toBe("duplicate");
    expect(messages).toEqual([
      "OpenDucktor Electron development is already running for this worktree.",
    ]);
  });

  test("maps lock failures to the Electron lifecycle boundary", async () => {
    const lockFailure = new Error("lock failed");

    const result = await Effect.runPromise(
      Effect.either(
        claimElectronDevelopmentInstanceEffect({
          logger: { info: () => Effect.void },
          profileKind: "development",
          requestSingleInstanceLock: () => {
            throw lockFailure;
          },
        }),
      ),
    );

    if (!("left" in result)) {
      throw new Error("Expected development instance claim to fail");
    }
    expect(result.left).toEqual(
      new ElectronLifecycleError({
        operation: "electron.main.claim-development-instance",
        message: "lock failed",
        cause: lockFailure,
      }),
    );
  });

  test("configures the selected development profile before it claims ownership", async () => {
    const configDirectory = mkdtempSync(path.join(tmpdir(), "openducktor-electron-instance-"));
    const events: string[] = [];

    try {
      const result = await Effect.runPromise(
        prepareElectronDevelopmentInstanceEffect({
          app: {
            isPackaged: false,
            requestSingleInstanceLock: () => {
              events.push("claim");
              return true;
            },
            setName: () => events.push("name"),
            setPath: (name) => events.push(`path:${name}`),
          },
          appName: "OpenDucktor",
          logger: { info: () => Effect.void },
          processEnv: {
            OPENDUCKTOR_CONFIG_DIR: configDirectory,
            OPENDUCKTOR_DEV_INSTANCE: "electron-aaaaaaaaaaaa",
          },
        }),
      );

      expect(result).toBe("primary");
      expect(events).toEqual(["name", "path:userData", "path:sessionData", "claim"]);
    } finally {
      rmSync(configDirectory, { force: true, recursive: true });
    }
  });
});
