import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { createAzureDevOpsProtectedStorage } from "./protected-storage";

test("Azure DevOps storage checks the saved cache marker without opening the credential store", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-azure-storage-"));
  try {
    const storage = createAzureDevOpsProtectedStorage({ configDir });
    const scope = "workspace::repository";
    const key = createHash("sha256").update(scope).digest("hex");
    const cachePath = path.join(
      configDir,
      "credentials",
      "azure-devops",
      `${key}.connection.cache`,
    );

    await expect(Effect.runPromise(storage.hasSavedRecord(scope, "connection"))).resolves.toBe(
      false,
    );
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, "");
    await expect(Effect.runPromise(storage.hasSavedRecord(scope, "connection"))).resolves.toBe(
      false,
    );
    await writeFile(cachePath, "{}");
    await expect(Effect.runPromise(storage.hasSavedRecord(scope, "connection"))).resolves.toBe(
      true,
    );
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});
