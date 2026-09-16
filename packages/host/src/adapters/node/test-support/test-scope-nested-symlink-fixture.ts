import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
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
  const liveScope = process.argv[3];
  if (liveScope !== "production" && liveScope !== "development") {
    throw new Error("Expected a production or development config scope.");
  }
  const homeDir = process.argv[4];
  if (!homeDir || !path.isAbsolute(homeDir)) {
    throw new Error("Expected an absolute test home directory.");
  }
  const liveRoot = path.join(
    homeDir,
    liveScope === "production" ? ".openducktor" : ".openducktor-dev",
  );
  const configDir = path.join(homeDir, ".openducktor-test");
  const usesStaging = action === "stage" || action === "removeStaged";
  const directoryName = usesStaging ? "task-asset-staging" : "task-assets";
  const liveAsset = usesStaging
    ? path.join(liveRoot, directoryName, "instances", ownerId, workspaceId, assetId)
    : path.join(liveRoot, directoryName, workspaceId, taskId, assetId);
  await mkdir(path.dirname(liveAsset), { recursive: true });
  if (action === "removeStaged" || action === "quarantine") {
    await writeFile(liveAsset, new Uint8Array([7]));
  }
  await mkdir(configDir, { recursive: true });
  await symlink(path.join(liveRoot, directoryName), path.join(configDir, directoryName), "dir");

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
  const bytes = await readFile(liveAsset).then(
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
