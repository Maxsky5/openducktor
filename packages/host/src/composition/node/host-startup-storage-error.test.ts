import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { HostDatabaseImportSourceError } from "../../adapters/sqlite/host-database-import-worker-protocol";
import { HostOperationError } from "../../effect/host-errors";
import { checkStartupSettingsEffect } from "./check-startup-settings";
import {
  findHostStorageStartupError,
  formatHostStorageStartupError,
  HostStorageStartupError,
  toHostStorageStartupError,
} from "./host-startup-storage-error";

class ShellStartupError extends Error {
  constructor(readonly cause: unknown) {
    super("startup failed");
  }
}

const withConfigFile = async <A>(
  text: string,
  use: (configRoot: string) => Promise<A>,
): Promise<A> => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-storage-startup-error-"));
  try {
    await writeFile(path.join(root, "config.json"), text);
    return await use(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("findHostStorageStartupError", () => {
  test("finds a storage startup failure through the shell error", () => {
    const storageError = toHostStorageStartupError(
      new HostOperationError({ operation: "sqlite.configureDatabase", message: "busy" }),
    );

    expect(findHostStorageStartupError(new ShellStartupError(storageError))).toBe(storageError);
  });

  test("ignores a failure outside storage startup", () => {
    const error = new HostOperationError({ operation: "git.fetch", message: "offline" });

    expect(findHostStorageStartupError(new ShellStartupError(error))).toBeNull();
  });

  test("finds an invalid settings file from the startup settings check", async () => {
    await withConfigFile("{", async (configRoot) => {
      const error = await Effect.runPromise(
        Effect.flip(checkStartupSettingsEffect("test", { OPENDUCKTOR_CONFIG_DIR: configRoot })),
      );

      expect(findHostStorageStartupError(new ShellStartupError(error))).toBe(error);
      expect(error.message).toContain("Invalid config file");
    });
  });
});

describe("toHostStorageStartupError", () => {
  test("keeps the message, the cause, and the source path of the failure", () => {
    const cause = new HostDatabaseImportSourceError({
      sourcePath: "/data/repo/tasks.sqlite",
      message: "Workspace history is newer than this version.",
    });

    expect(toHostStorageStartupError(cause)).toMatchObject({
      message: cause.message,
      cause,
      sourcePath: "/data/repo/tasks.sqlite",
    });
  });

  test("names no source for a failure outside a legacy source", () => {
    const cause = new HostOperationError({
      operation: "hostDatabase.import",
      message: "Cannot remove the import folder /data/.host-database-import.",
      details: { folderPath: "/data/.host-database-import" },
    });

    expect(toHostStorageStartupError(cause).sourcePath).toBeUndefined();
  });
});

describe("formatHostStorageStartupError", () => {
  test("adds the source path when the message does not hold it", () => {
    const error = new HostStorageStartupError({
      message: "Workspace history is newer than this version.",
      cause: null,
      sourcePath: "/data/repo/tasks.sqlite",
    });

    expect(formatHostStorageStartupError(error)).toBe(
      "Workspace history is newer than this version.\n\nSource: /data/repo/tasks.sqlite",
    );
  });

  test("keeps the message when it holds the source path", () => {
    const message = "Cannot migrate /data/repo/tasks.sqlite. Restore a backup.";
    const error = new HostStorageStartupError({
      message,
      cause: null,
      sourcePath: "/data/repo/tasks.sqlite",
    });

    expect(formatHostStorageStartupError(error)).toBe(message);
  });
});
