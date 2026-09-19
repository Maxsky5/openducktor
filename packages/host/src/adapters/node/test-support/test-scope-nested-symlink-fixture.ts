import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cause, Effect, Exit } from "effect";
import { z } from "zod";
import { createNodeTaskAssetFilePort } from "../filesystem-task-asset-file-port";

export type TestScopeNestedSymlinkAction = "stage" | "removeStaged" | "promote" | "quarantine";
export type TestScopeNestedSymlinkLiveScope = "production" | "development";

export type TestScopeNestedSymlinkCaseResult = {
  action: TestScopeNestedSymlinkAction;
  bytes: number[] | null;
  error: string | null;
  liveScope: TestScopeNestedSymlinkLiveScope;
};

export const NESTED_SYMLINK_ACTIONS = ["stage", "removeStaged", "promote", "quarantine"] as const;
export const NESTED_SYMLINK_LIVE_SCOPES = ["production", "development"] as const;

const ownerId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "fixture-workspace";
const taskId = "fixture-task";
const assetId = "550e8400-e29b-41d4-a716-446655440000";

const runCase = async ({
  action,
  liveScope,
  homeDir,
}: {
  action: TestScopeNestedSymlinkAction;
  liveScope: TestScopeNestedSymlinkLiveScope;
  homeDir: string;
}): Promise<TestScopeNestedSymlinkCaseResult> => {
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
  return { action, bytes, error, liveScope };
};

export const runTestScopeNestedSymlinkCases = async ({
  homeDir,
}: {
  homeDir: string;
}): Promise<TestScopeNestedSymlinkCaseResult[]> => {
  const results: TestScopeNestedSymlinkCaseResult[] = [];
  for (const liveScope of NESTED_SYMLINK_LIVE_SCOPES) {
    for (const action of NESTED_SYMLINK_ACTIONS) {
      results.push(await runCase({ action, homeDir, liveScope }));
      await rm(homeDir, { force: true, recursive: true });
    }
  }
  return results;
};

if (import.meta.main) {
  const homeDir = process.argv[2];
  if (!homeDir || !path.isAbsolute(homeDir)) {
    throw new Error("Expected an absolute test home directory.");
  }
  console.log(JSON.stringify(await runTestScopeNestedSymlinkCases({ homeDir })));
}
