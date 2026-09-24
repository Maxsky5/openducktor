import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { createAzureDevOpsProtectedStorage } from "./protected-storage";

const testWithNativeStorage = process.platform === "linux" ? test.skip : test;

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
