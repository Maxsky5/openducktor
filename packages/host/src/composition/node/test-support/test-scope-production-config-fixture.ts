import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { WorkspaceSettingsService } from "../../../application/workspaces/workspace-settings-service";
import { createSettingsConfigTestDouble } from "../../../test-support/service-test-doubles";
import { createTaskStoreTestDouble } from "../../../test-support/task-store-test-double";
import { createNodeTaskAssetServices } from "../node-task-asset-services";

type TaskAssetState = {
  durableBytes: number[] | null;
  ownerEntries: string[];
  quarantineEntries: string[];
  stagingBytes: number[] | null;
};

export type TestScopeProductionConfigResult = {
  after: TaskAssetState;
  before: TaskAssetState;
  error: string | null;
  taskState: "deleted" | "present";
};

const ownerId = "10000000-0000-4000-8000-000000000001";
const quarantineId = "50000000-0000-4000-8000-000000000001";
const workspaceId = "fixture-workspace";
const taskId = "fixture-task";
const assetId = "550e8400-e29b-41d4-a716-446655440000";

const run = async (): Promise<TestScopeProductionConfigResult> => {
  const configScenario = process.argv[2];
  if (configScenario !== "direct" && configScenario !== "symlink") {
    throw new Error("Expected a direct or symlink config scenario.");
  }
  const homeDir = process.argv[3];
  if (!homeDir || !path.isAbsolute(homeDir)) {
    throw new Error("Expected an absolute test home directory.");
  }
  const configDir = path.join(homeDir, ".openducktor");
  const configuredConfigDir =
    configScenario === "symlink" ? path.join(homeDir, ".openducktor-test-link") : configDir;
  const ownersRoot = path.join(configDir, "task-asset-owners");
  const stagingFile = path.join(
    configDir,
    "task-asset-staging",
    "instances",
    ownerId,
    workspaceId,
    assetId,
  );
  const quarantineRoot = path.join(configDir, "task-asset-quarantine");
  const durableFile = path.join(configDir, "task-assets", workspaceId, taskId, assetId);
  await mkdir(ownersRoot, { recursive: true });
  await mkdir(path.dirname(stagingFile), { recursive: true });
  await mkdir(path.join(quarantineRoot, quarantineId), { recursive: true });
  await mkdir(path.dirname(durableFile), { recursive: true });
  await writeFile(
    path.join(ownersRoot, `${ownerId}.json`),
    JSON.stringify({
      version: 1,
      instanceId: ownerId,
      processId: 999_999,
      startedAtMs: 1,
    }),
  );
  await writeFile(stagingFile, new Uint8Array([1]));
  await writeFile(durableFile, new Uint8Array([2]));
  if (configScenario === "symlink") {
    await symlink(configDir, configuredConfigDir, "dir");
  }

  const readBytes = async (filePath: string): Promise<number[] | null> =>
    readFile(filePath).then(
      (bytes) => [...bytes],
      (cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") {
          return null;
        }
        throw cause;
      },
    );
  const readState = async (): Promise<TaskAssetState> => ({
    durableBytes: await readBytes(durableFile),
    ownerEntries: (await readdir(ownersRoot)).sort(),
    quarantineEntries: (await readdir(quarantineRoot)).sort(),
    stagingBytes: await readBytes(stagingFile),
  });
  const before = await readState();
  let error: string | null = null;
  let taskState: "deleted" | "present" = "present";
  // SAFETY: The config guard throws before the service can read this stub.
  const unusedWorkspaceSettingsService = {} as WorkspaceSettingsService;

  try {
    const services = createNodeTaskAssetServices({
      configDir: { root: configuredConfigDir, scope: "test" },
      assertWorkspaceAdmitted: () => Effect.void,
      configuredTaskStore: createTaskStoreTestDouble({
        deleteTask: () =>
          Effect.sync(() => {
            taskState = "deleted";
            return true;
          }),
      }),
      hostOwnership: {
        claimWorkspace: () => Effect.succeed(true),
        releaseWorkspace: () => Effect.void,
      },
      isWorkspaceRemovalPending: () => false,
      onBackgroundFailure: () => Effect.void,
      processEnv: { OPENDUCKTOR_CONFIG_DIR: configuredConfigDir },
      settingsConfig: createSettingsConfigTestDouble({}),
      withAdministrativeAccess: (_workspaceIds, effect) => effect,
      workspaceSettingsService: unusedWorkspaceSettingsService,
    });
    await Effect.runPromise(services.startupSweep());
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return { after: await readState(), before, error, taskState };
};

if (import.meta.main) {
  console.log(JSON.stringify(await run()));
}
