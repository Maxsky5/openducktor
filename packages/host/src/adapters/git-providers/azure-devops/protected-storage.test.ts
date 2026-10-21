import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import { createAzureDevOpsProtectedStorage } from "./protected-storage";

// Native storage calls the OS credential store, which can exceed the default timeout while the
// full suite runs in parallel.
const NATIVE_STORAGE_TIMEOUT_MS = 30_000;

// Linux CI has no Secret Service for libsecret.
const testWithNativeStorage = (name: string, run: () => Promise<void>) =>
  (process.platform === "linux" ? test.skip : test)(name, run, NATIVE_STORAGE_TIMEOUT_MS);

testWithNativeStorage("creates the cache directory for a first connection read", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-azure-storage-"));
  try {
    const scope = randomUUID();
    const storage = createAzureDevOpsProtectedStorage({ configDir });

    await expect(Effect.runPromise(storage.readConnection(scope))).resolves.toBeNull();

    const key = createHash("sha256").update(scope).digest("hex");
    const cacheFile = await stat(
      path.join(configDir, "credentials", "azure-devops", `${key}.connection.cache`),
    );
    expect(cacheFile.size).toBe(0);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

// MSAL validation writes test.cache, so a directory at that path makes validation fail.
testWithNativeStorage(
  "reads an absent connection without running MSAL persistence validation",
  async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-azure-storage-"));
    try {
      const cacheDir = path.join(configDir, "credentials", "azure-devops");
      await mkdir(path.join(cacheDir, "test.cache"), { recursive: true });
      const scope = randomUUID();
      const storage = createAzureDevOpsProtectedStorage({ configDir });

      await expect(Effect.runPromise(storage.readConnection(scope))).resolves.toBeNull();

      const key = createHash("sha256").update(scope).digest("hex");
      const cacheFile = await stat(path.join(cacheDir, `${key}.connection.cache`));
      expect(cacheFile.size).toBe(0);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  },
);

testWithNativeStorage(
  "reads and writes native records without shared validation storage",
  async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-azure-storage-"));
    try {
      await mkdir(path.join(configDir, "credentials", "azure-devops", "test.cache"), {
        recursive: true,
      });
      const scope = randomUUID();
      const storage = createAzureDevOpsProtectedStorage({ configDir });
      const persistence = await Effect.runPromise(storage.open(scope, "connection"));
      try {
        const payload = JSON.stringify({ kind: "server_pat", pat: "synthetic-test-value" });
        await persistence.save(payload);
        const msal = await Effect.runPromise(storage.open(scope, "msal"));
        try {
          const cache = JSON.stringify({ AccessToken: { test: "synthetic-cache-value" } });
          await msal.save(cache);
          const reopened = await Effect.runPromise(storage.open(scope, "msal"));
          await expect(reopened.load()).resolves.toBe(cache);
        } finally {
          expect(await msal.delete()).toBe(true);
        }
        await expect(Effect.runPromise(storage.readConnection(scope))).resolves.toBe(payload);

        if (process.platform === "win32") {
          const contents = await readFile(persistence.getFilePath());
          expect(contents.includes("synthetic-test-value")).toBe(false);
        }

        if (process.platform === "darwin") {
          const key = createHash("sha256").update(scope).digest("hex");
          const cachePath = path.join(
            configDir,
            "credentials",
            "azure-devops",
            `${key}.connection.cache`,
          );
          await truncate(cachePath, 0);
          await expect(Effect.runPromise(storage.readConnection(scope))).resolves.toBe(payload);
        }
      } finally {
        expect(await persistence.delete()).toBe(true);
      }
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  },
);

testWithNativeStorage("propagates a failure to create the credential directory", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-azure-storage-"));
  try {
    await writeFile(path.join(configDir, "credentials"), "blocked");
    const storage = createAzureDevOpsProtectedStorage({ configDir });

    const result = await Effect.runPromise(Effect.result(storage.open(randomUUID(), "connection")));

    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected storage initialization to fail.");
    expect(result.failure).toBeInstanceOf(HostOperationError);
    expect(result.failure.operation).toBe("azureDevOps.protectedStorage.open");
    expect(result.failure.cause).toBeInstanceOf(Error);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});
