import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createNodeTaskAssetFilePort } from "../../adapters/node/filesystem-task-asset-file-port";
import { createTaskAssetStagingService } from "./task-asset-staging-service";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const cleanups = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all(Array.from(cleanups, (cleanup) => cleanup()));
  cleanups.clear();
});

const createHarness = async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "odt-task-assets-"));
  cleanups.add(() => rm(configDir, { force: true, recursive: true }));
  const filePort = createNodeTaskAssetFilePort({ configDir });
  return { filePort, service: createTaskAssetStagingService(filePort) };
};

describe("task asset staging", () => {
  test("sniffs and stages an approved image without returning a path", async () => {
    const { service } = await createHarness();
    const result = await Effect.runPromise(
      service.stage({
        workspaceId: "workspace-1",
        scope: "description",
        originalName: "../diagram.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );

    expect(result).toMatchObject({
      scope: "description",
      originalName: "diagram.png",
      verifiedMediaType: "image/png",
    });
    expect(result).not.toHaveProperty("path");
    expect(result).not.toHaveProperty("url");
  });

  test("rejects SVG, declared MIME spoofing, truncated images, and oversize files", async () => {
    const { service } = await createHarness();
    const common = {
      workspaceId: "workspace-1",
      scope: "description" as const,
      originalName: "image.png",
    };

    await expect(
      Effect.runPromise(
        service.stage({
          ...common,
          declaredMediaType: "image/png",
          bytesBase64: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64"),
        }),
      ),
    ).rejects.toThrow("PNG, JPEG, WebP, or GIF");
    await expect(
      Effect.runPromise(
        service.stage({
          ...common,
          declaredMediaType: "image/jpeg",
          bytesBase64: PNG_BASE64,
        }),
      ),
    ).rejects.toThrow("does not match");
    await expect(
      Effect.runPromise(
        service.stage({
          ...common,
          declaredMediaType: "image/png",
          bytesBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      Effect.runPromise(
        service.stage({
          ...common,
          declaredMediaType: "image/png",
          bytesBase64: Buffer.concat([
            Buffer.from(PNG_BASE64, "base64"),
            Buffer.alloc(10 * 1024 * 1024),
          ]).toString("base64"),
        }),
      ),
    ).rejects.toThrow("10 MiB");
  });

  test("keeps workspace ownership and discard exact", async () => {
    const { service } = await createHarness();
    const staged = await Effect.runPromise(
      service.stage({
        workspaceId: "workspace-1",
        scope: "description",
        originalName: "image.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );

    await expect(
      Effect.runPromise(
        service.getStagedAssets({ workspaceId: "workspace-2", assetIds: [staged.assetId] }),
      ),
    ).rejects.toThrow("same workspace");
    await Effect.runPromise(
      service.discard({ workspaceId: "workspace-1", assetIds: [staged.assetId] }),
    );
    await expect(
      Effect.runPromise(
        service.getStagedAssets({ workspaceId: "workspace-1", assetIds: [staged.assetId] }),
      ),
    ).rejects.toThrow("not staged");
  });
});
