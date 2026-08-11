import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { taskAssetIdSchema } from "@openducktor/contracts";
import { Effect, Exit } from "effect";
import { TaskAssetError } from "../../application/task-assets/task-asset-error";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import {
  taskAssetFileTryPromise as tryPromise,
  validateTaskAssetContext as validateContext,
  validateTaskAssetStageContext as validateStageContext,
  validateTaskAssetTaskContext as validateTaskContext,
} from "./filesystem-task-asset-errors";
import {
  createTaskAssetFileOwnership,
  type TaskAssetFileOwnershipDependencies,
} from "./filesystem-task-asset-ownership";
import {
  createTaskAssetQuarantineFiles,
  type QuarantineManifest,
} from "./filesystem-task-asset-quarantine";

type QuarantineMove = { from: string; to: string };

const isMissing = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";

const existingStat = async (target: string) => {
  try {
    return await lstat(target);
  } catch (cause) {
    if (isMissing(cause)) {
      return null;
    }
    throw cause;
  }
};

export const createNodeTaskAssetFilePort = (
  {
    configDir,
  }: {
    configDir: string;
  },
  ownership?: TaskAssetFileOwnershipDependencies,
): TaskAssetFilePort => {
  const durableRoot = path.resolve(configDir, "task-assets");
  const ownerState = createTaskAssetFileOwnership({ configDir }, ownership);
  const { ownedQuarantineRoot, ownedStagingRoot, quarantineRoot } = ownerState;
  const stagedPath = (workspaceId: string, assetId: string) =>
    path.join(ownedStagingRoot, workspaceId, assetId);
  const durablePath = (workspaceId: string, taskId: string, assetId: string) =>
    path.join(durableRoot, workspaceId, taskId, assetId);
  const quarantineFilesForRoot = (root: string, reservedDirectoryNames: readonly string[]) =>
    createTaskAssetQuarantineFiles({
      durableRoot,
      quarantineRoot: root,
      reservedDirectoryNames,
    });
  const quarantineFiles = quarantineFilesForRoot(ownedQuarantineRoot, []);
  const legacyQuarantineFiles = quarantineFilesForRoot(quarantineRoot, ["instances"]);
  const findQuarantineFiles = async (quarantineId: string) => {
    if (!taskAssetIdSchema.safeParse(quarantineId).success) {
      throw new Error("Task asset quarantine ID is invalid.");
    }
    const candidates = [
      legacyQuarantineFiles,
      ...(await ownerState.listAll()).map((owner) =>
        quarantineFilesForRoot(ownerState.quarantineRootFor(owner.instanceId), []),
      ),
    ];
    const matches = [];
    for (const candidate of candidates) {
      if (await existingStat(candidate.root(quarantineId))) {
        matches.push(candidate);
      }
    }
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? "Task asset quarantine was not found."
          : "Task asset quarantine ID exists under more than one owner.",
      );
    }
    const [match] = matches;
    if (!match) {
      throw new Error("Task asset quarantine was not found.");
    }
    return match;
  };
  const readQuarantineManifest = (quarantineId: string) =>
    tryPromise(
      async () => {
        const files = await findQuarantineFiles(quarantineId);
        return { files, manifest: await files.read(quarantineId) };
      },
      {
        operation: "startup_sweep",
        code: "restore",
        phase: "read_quarantine_manifest",
        message: "Failed to read task asset quarantine recovery data.",
      },
    );
  const writeQuarantineManifest = (manifest: QuarantineManifest) =>
    tryPromise(
      async () => {
        await ownerState.ensureCurrent();
        await quarantineFiles.write(manifest);
      },
      {
        operation: manifest.operation,
        code: "quarantine",
        phase: "write_quarantine_manifest",
        message: "Failed to write task asset quarantine recovery data.",
        assetIds: manifest.assetIds,
        taskId: manifest.taskId,
      },
    );

  return {
    stage(input) {
      return Effect.gen(function* () {
        yield* validateStageContext(input.workspaceId, input.assetId);
        const destination = stagedPath(input.workspaceId, input.assetId);
        yield* tryPromise(
          async () => {
            await ownerState.ensureCurrent();
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, input.bytes, { flag: "wx", mode: 0o600 });
          },
          {
            operation: "stage",
            code: "promotion",
            phase: "write_staging_file",
            message: "Failed to write the staged task asset.",
            assetIds: [input.assetId],
          },
        );
      });
    },
    removeStaged(input) {
      return Effect.gen(function* () {
        for (const assetId of input.assetIds) {
          yield* validateStageContext(input.workspaceId, assetId);
          yield* tryPromise(() => rm(stagedPath(input.workspaceId, assetId), { force: true }), {
            operation: "discard",
            code: "purge",
            phase: "remove_staging_file",
            message: `Failed to discard staged task asset ${assetId}.`,
            assetIds: [assetId],
          });
        }
      });
    },
    clearStaging() {
      return tryPromise(() => ownerState.clearExpiredStaging(), {
        operation: "startup_sweep",
        code: "purge",
        phase: "clear_staging",
        message: "Failed to clear expired task asset staging files.",
      });
    },
    cleanupCurrentOwner() {
      return tryPromise(() => ownerState.cleanupCurrent(), {
        operation: "discard",
        code: "purge",
        phase: "cleanup_owner_staging",
        message: "Failed to clean up task asset state for the current host instance.",
      });
    },
    promote(input) {
      return Effect.gen(function* () {
        yield* validateContext(input.workspaceId, input.taskId, input.assetId, input.operation);
        const destination = durablePath(input.workspaceId, input.taskId, input.assetId);
        yield* tryPromise(
          async () => {
            await mkdir(path.dirname(destination), { recursive: true });
            await copyFile(
              stagedPath(input.workspaceId, input.assetId),
              destination,
              constants.COPYFILE_EXCL,
            );
          },
          {
            operation: input.operation,
            code: "promotion",
            phase: "promote_staged_file",
            message: `Failed to promote task asset ${input.assetId}.`,
            assetIds: [input.assetId],
            taskId: input.taskId,
          },
        );
      });
    },
    durableExists(input) {
      return Effect.gen(function* () {
        yield* validateContext(input.workspaceId, input.taskId, input.assetId, input.operation);
        return yield* tryPromise(
          async () =>
            (await existingStat(durablePath(input.workspaceId, input.taskId, input.assetId))) !==
            null,
          {
            operation: input.operation,
            code: "filesystem",
            phase: "check_destination",
            message: `Failed to check task asset ${input.assetId}.`,
            assetIds: [input.assetId],
            taskId: input.taskId,
          },
        );
      });
    },
    removeDurable(input) {
      return Effect.gen(function* () {
        for (const assetId of input.assetIds) {
          yield* validateContext(input.workspaceId, input.taskId, assetId, input.operation);
          yield* tryPromise(() => unlink(durablePath(input.workspaceId, input.taskId, assetId)), {
            operation: input.operation,
            code: "purge",
            phase: "remove_promoted_file",
            message: `Failed to remove promoted task asset ${assetId}.`,
            assetIds: [assetId],
            taskId: input.taskId,
          });
        }
      });
    },
    quarantineAssets(input) {
      if (input.assetIds.length === 0 && input.promotedAssetIds.length === 0) {
        return Effect.succeed(null);
      }
      return Effect.gen(function* () {
        const quarantineId = randomUUID();
        const root = quarantineFiles.root(quarantineId);
        const moves: QuarantineMove[] = [];
        const manifest: QuarantineManifest = {
          version: 1,
          id: quarantineId,
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          operation: input.operation,
          assetIds: input.assetIds,
          promotedAssetIds: input.promotedAssetIds,
        };
        yield* writeQuarantineManifest(manifest);
        for (const assetId of input.assetIds) {
          yield* validateContext(input.workspaceId, input.taskId, assetId, input.operation);
          const from = durablePath(input.workspaceId, input.taskId, assetId);
          const to = path.join(root, assetId);
          yield* tryPromise(
            async () => {
              await mkdir(root, { recursive: true });
              await rename(from, to);
              moves.push({ from, to });
            },
            {
              operation: input.operation,
              code: "quarantine",
              phase: "quarantine_obsolete_file",
              message: `Failed to quarantine obsolete task asset ${assetId}.`,
              assetIds: [assetId],
              taskId: input.taskId,
            },
          ).pipe(
            Effect.catchAll((quarantineError) =>
              Effect.gen(function* () {
                const restoreExit = yield* Effect.exit(
                  tryPromise(
                    async () => {
                      for (const move of moves.toReversed()) {
                        await mkdir(path.dirname(move.from), { recursive: true });
                        await rename(move.to, move.from);
                      }
                      await rm(root, { force: true, recursive: true });
                    },
                    {
                      operation: input.operation,
                      code: "restore",
                      phase: "restore_partial_quarantine",
                      message: "Failed to restore a partially quarantined task asset set.",
                      assetIds: input.assetIds,
                      taskId: input.taskId,
                    },
                  ),
                );
                if (Exit.isFailure(restoreExit)) {
                  return yield* new TaskAssetError({
                    operation: input.operation,
                    code: "partial_state",
                    taskId: input.taskId,
                    assetIds: input.assetIds,
                    failedPhase: "restore_partial_quarantine",
                    durableState: "unknown",
                    retryAllowed: false,
                    message: "Task asset quarantine failed and restoration was incomplete.",
                  });
                }
                return yield* quarantineError;
              }),
            ),
          );
        }
        return quarantineId;
      });
    },
    quarantineTaskDirectory(input) {
      return Effect.gen(function* () {
        yield* validateTaskContext(input.workspaceId, input.taskId, "delete");
        const taskRoot = path.join(durableRoot, input.workspaceId, input.taskId);
        const stat = yield* tryPromise(() => existingStat(taskRoot), {
          operation: "delete",
          code: "quarantine",
          phase: "inspect_task_directory",
          message: `Failed to inspect task asset directory for ${input.taskId}.`,
          taskId: input.taskId,
        });
        if (!stat) {
          return null;
        }
        const quarantineId = randomUUID();
        const root = quarantineFiles.root(quarantineId);
        const to = path.join(root, input.taskId);
        const manifest: QuarantineManifest = {
          version: 1,
          id: quarantineId,
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          operation: "delete",
          assetIds: [],
          promotedAssetIds: [],
        };
        yield* writeQuarantineManifest(manifest);
        yield* tryPromise(
          async () => {
            await rename(taskRoot, to);
          },
          {
            operation: "delete",
            code: "quarantine",
            phase: "quarantine_task_directory",
            message: `Failed to quarantine task assets for ${input.taskId}.`,
            taskId: input.taskId,
          },
        );
        return quarantineId;
      });
    },
    listQuarantines() {
      return tryPromise(
        async () => {
          const quarantines = await legacyQuarantineFiles.list();
          for (const owner of await ownerState.listDead()) {
            const ownerFiles = quarantineFilesForRoot(
              ownerState.quarantineRootFor(owner.instanceId),
              [],
            );
            quarantines.push(...(await ownerFiles.list()));
          }
          return quarantines;
        },
        {
          operation: "startup_sweep",
          code: "restore",
          phase: "list_quarantines",
          message: "Failed to list task asset quarantine recovery data.",
        },
      );
    },
    restoreQuarantine(quarantineId) {
      return Effect.gen(function* () {
        const { files, manifest } = yield* readQuarantineManifest(quarantineId);
        yield* tryPromise(() => files.restore(manifest), {
          operation: manifest.operation,
          code: "restore",
          phase: "restore_quarantine",
          message: "Failed to restore quarantined task assets.",
          assetIds: manifest.assetIds,
          taskId: manifest.taskId,
        });
      });
    },
    purgeQuarantine(quarantineId) {
      return Effect.gen(function* () {
        const { files, manifest } = yield* readQuarantineManifest(quarantineId);
        yield* tryPromise(() => files.purge(quarantineId), {
          operation: manifest.operation,
          code: "purge",
          phase: "purge_quarantine",
          message: "Failed to purge quarantined task assets.",
          assetIds: manifest.assetIds,
          taskId: manifest.taskId,
        });
      });
    },
    readDurable(input) {
      return Effect.gen(function* () {
        yield* validateContext(input.workspaceId, input.taskId, input.assetId, "serve");
        return yield* tryPromise(
          async () => {
            const taskRoot = path.join(durableRoot, input.workspaceId, input.taskId);
            const file = durablePath(input.workspaceId, input.taskId, input.assetId);
            for (const segment of [
              durableRoot,
              path.join(durableRoot, input.workspaceId),
              taskRoot,
              file,
            ]) {
              const stat = await existingStat(segment);
              if (!stat || stat.isSymbolicLink()) {
                return null;
              }
              if (segment === file && !stat.isFile()) {
                return null;
              }
              if (segment !== file && !stat.isDirectory()) {
                return null;
              }
            }
            const [realTaskRoot, realFile] = await Promise.all([
              realpath(taskRoot),
              realpath(file),
            ]);
            const relative = path.relative(realTaskRoot, realFile);
            if (relative.startsWith("..") || path.isAbsolute(relative)) {
              return null;
            }
            return new Uint8Array(await readFile(realFile));
          },
          {
            operation: "serve",
            code: "filesystem",
            phase: "read_durable_file",
            message: "Failed to read the requested task asset.",
            assetIds: [input.assetId],
            taskId: input.taskId,
          },
        );
      });
    },
  };
};
