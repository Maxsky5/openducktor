import { afterEach } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { createNodeTaskAssetFilePort } from "../../../adapters/node/filesystem-task-asset-file-port";
import { createSqliteTaskAssetRegistry } from "../../../adapters/sqlite/sqlite-task-asset-registry";
import { createSqliteTaskStoreHarness } from "../../../adapters/sqlite/sqlite-task-store-test-support";
import { TaskAssetError } from "../../../effect/task-asset-error";
import { createTaskAssetAwareTaskStore } from "../task-asset-aware-task-store";
import { createTaskAssetStagingService } from "../task-asset-staging-service";

export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const cleanups = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all(Array.from(cleanups, (cleanup) => cleanup()));
  cleanups.clear();
});

export const createHarness = async () => {
  const sqlite = await createSqliteTaskStoreHarness();
  cleanups.add(sqlite.cleanup);
  const filePort = createNodeTaskAssetFilePort({ configDir: sqlite.configDir });
  const staging = createTaskAssetStagingService(filePort);
  const registry = createSqliteTaskAssetRegistry({
    contextProvider: sqlite.contextProvider,
  });
  const store = createTaskAssetAwareTaskStore({
    inner: sqlite.store,
    filePort,
    registry,
    persistence: registry,
    staging,
    resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
  });
  return { ...sqlite, innerStore: sqlite.store, filePort, registry, staging, store };
};

export const injectedTaskAssetError = ({
  operation,
  code,
  failedPhase,
  taskId,
  assetIds = [],
}: {
  operation: "create" | "update" | "delete";
  code: "promotion" | "database" | "restore" | "purge";
  failedPhase: string;
  taskId?: string;
  assetIds?: string[];
}) =>
  new TaskAssetError({
    operation,
    code,
    ...(() => {
      if (taskId) {
        return { taskId };
      }
      return {};
    })(),
    assetIds,
    failedPhase,
    durableState: "unchanged",
    retryAllowed: true,
    message: `Injected ${failedPhase} failure.`,
  });

export const createTaskWithAsset = async (harness: Awaited<ReturnType<typeof createHarness>>) => {
  const staged = await Effect.runPromise(
    harness.staging.stage({
      workspaceId: "fairnest",
      scope: "description",
      originalName: "owned.png",
      declaredMediaType: "image/png",
      bytesBase64: PNG_BASE64,
    }),
  );
  const description = `![image](odt-asset:${staged.assetId})`;
  const task = await Effect.runPromise(
    harness.store.createTask({
      repoPath: harness.repoPath,
      task: {
        title: "Asset owner",
        issueType: "task",
        aiReviewEnabled: true,
        priority: 2,
        description,
      },
      descriptionAssets: { stagedAssetIds: [staged.assetId] },
    }),
  );
  return { staged, task, description };
};

export const captureTaskAssetError = async <A>(effect: Effect.Effect<A, unknown>) => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected a task asset failure.");
  }
  const failure = Array.from(Cause.failures(exit.cause))[0];
  if (failure instanceof TaskAssetError) {
    return failure;
  }
  throw new Error("Expected a typed task asset failure.");
};
