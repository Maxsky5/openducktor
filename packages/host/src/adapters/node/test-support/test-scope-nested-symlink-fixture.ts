import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Cause, Effect, Exit } from "effect";
import { z } from "zod";
import { createNodeTaskAssetFilePort } from "../filesystem-task-asset-file-port";

export type TestScopeNestedSymlinkResult = {
  bytes: number[] | null;
  error: string | null;
};

const ownerId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "fixture-workspace";
const taskId = "fixture-task";
const assetId = "550e8400-e29b-41d4-a716-446655440000";

const run = async (): Promise<TestScopeNestedSymlinkResult> => {
  const action = process.argv[2];
  if (
    action !== "stage" &&
    action !== "removeStaged" &&
    action !== "promote" &&
    action !== "quarantine"
  ) {
    throw new Error("Expected a stage, removeStaged, promote, or quarantine action.");
  }
  const productionRoot = path.join(homedir(), ".openducktor");
  const configDir = path.join(homedir(), ".openducktor-test");
  const usesStaging = action === "stage" || action === "removeStaged";
  const directoryName = usesStaging ? "task-asset-staging" : "task-assets";
  const productionAsset = usesStaging
    ? path.join(productionRoot, directoryName, "instances", ownerId, workspaceId, assetId)
    : path.join(productionRoot, directoryName, workspaceId, taskId, assetId);
  await mkdir(path.dirname(productionAsset), { recursive: true });
  if (action === "removeStaged" || action === "quarantine") {
    await writeFile(productionAsset, new Uint8Array([7]));
  }
  await mkdir(configDir, { recursive: true });
  await symlink(
    path.join(productionRoot, directoryName),
    path.join(configDir, directoryName),
    "dir",
  );

  const port = createNodeTaskAssetFilePort(
    { configDir, configDirScope: "test" },
    {
      owner: { version: 1, instanceId: ownerId, processId: 10_001, startedAtMs: 10_001 },
      processIsAlive: () => true,
      processStartedAtMs: () => Promise.resolve(10_001),
    },
  );
  let error: string | null = null;
  const effect =
    action === "stage"
      ? port.stage({ workspaceId, assetId, bytes: new Uint8Array([8]) })
      : action === "removeStaged"
        ? port.removeStaged({ workspaceId, assetIds: [assetId] })
        : action === "promote"
          ? Effect.gen(function* () {
              yield* port.stage({ workspaceId, assetId, bytes: new Uint8Array([8]) });
              yield* port.promote({ workspaceId, taskId, assetId, operation: "create" });
            })
          : port.quarantineAssets({
              workspaceId,
              taskId,
              assetIds: [assetId],
              promotedAssetIds: [],
              operation: "update",
            });
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isFailure(exit)) {
    const [failure] = Cause.failures(exit.cause);
    const source = failure?.cause;
    const parsed = z.object({ message: z.string() }).safeParse(source);
    error = parsed.success ? parsed.data.message : String(source);
  }
  const bytes = await readFile(productionAsset).then(
    (value) => [...value],
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") {
        return null;
      }
      throw cause;
    },
  );
  return { bytes, error };
};

if (import.meta.main) {
  console.log(JSON.stringify(await run()));
}
