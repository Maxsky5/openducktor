import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { createAzureDevOpsProtectedStorage } from "./protected-storage";

// Linux CI has no Secret Service for libsecret.
const testWithNativeStorage = process.platform === "linux" ? test.skip : test;

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

testWithNativeStorage("reads a connection saved through native persistence", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-azure-storage-"));
  try {
    const scope = randomUUID();
    const storage = createAzureDevOpsProtectedStorage({ configDir });
    const persistence = await Effect.runPromise(storage.open(scope, "connection"));
    try {
      const payload = JSON.stringify({ kind: "server_pat", pat: "synthetic-test-value" });
      await persistence.save(payload);
      await expect(Effect.runPromise(storage.readConnection(scope))).resolves.toBe(payload);

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
});
