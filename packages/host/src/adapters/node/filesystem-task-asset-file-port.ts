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
import { taskAssetRenderContextSchema, workspaceIdSchema } from "@openducktor/contracts";
import { Effect, Exit } from "effect";
import { TaskAssetError } from "../../application/task-assets/task-asset-error";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import {
  createTaskAssetQuarantineFiles,
  type QuarantineManifest,
} from "./filesystem-task-asset-quarantine";

type QuarantineMove = { from: string; to: string };

const isMissing = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";

const createFileError = (input: {
  operation: "stage" | "create" | "update" | "delete" | "discard" | "startup_sweep" | "serve";
  code: "validation" | "promotion" | "quarantine" | "restore" | "purge" | "partial_state";
  phase: string;
  message: string;
  assetIds?: string[];
  taskId?: string;
  cause?: unknown;
}): TaskAssetError =>
  new TaskAssetError({
    operation: input.operation,
    code: input.code,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    assetIds: input.assetIds ?? [],
    failedPhase: input.phase,
    durableState: "unchanged",
    retryAllowed: true,
    message: input.message,
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });

const validateContext = (
  workspaceId: string,
  taskId: string,
  assetId: string,
): Effect.Effect<void, TaskAssetError> => {
  const parsed = taskAssetRenderContextSchema.safeParse({
    workspaceId,
    taskId,
    scope: "description",
    assetId,
  });
  if (!parsed.success) {
    return Effect.fail(
      createFileError({
        operation: "serve",
        code: "validation",
        phase: "validate_identifiers",
        message: "Task asset identifiers are invalid.",
        assetIds: [assetId],
        taskId,
        cause: parsed.error,
      }),
    );
  }
  return Effect.void;
};

const validateStageContext = (
  workspaceId: string,
  assetId: string,
): Effect.Effect<void, TaskAssetError> => {
  if (!workspaceIdSchema.safeParse(workspaceId).success || !/^[0-9a-f-]{36}$/i.test(assetId)) {
    return Effect.fail(
      createFileError({
        operation: "stage",
        code: "validation",
        phase: "validate_identifiers",
        message: "Task asset staging identifiers are invalid.",
        assetIds: [assetId],
      }),
    );
  }
  return Effect.void;
};

const tryPromise = <A>(
  run: () => Promise<A>,
  error: Omit<Parameters<typeof createFileError>[0], "cause">,
): Effect.Effect<A, TaskAssetError> =>
  Effect.tryPromise({ try: run, catch: (cause) => createFileError({ ...error, cause }) });

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

export const createNodeTaskAssetFilePort = ({
  configDir,
}: {
  configDir: string;
}): TaskAssetFilePort => {
  const durableRoot = path.resolve(configDir, "task-assets");
  const stagingRoot = path.resolve(configDir, "task-asset-staging");
  const quarantineRoot = path.resolve(configDir, "task-asset-quarantine");
  const stagedPath = (workspaceId: string, assetId: string) =>
    path.join(stagingRoot, workspaceId, assetId);
  const durablePath = (workspaceId: string, taskId: string, assetId: string) =>
    path.join(durableRoot, workspaceId, taskId, assetId);
  const quarantineFiles = createTaskAssetQuarantineFiles({ durableRoot, quarantineRoot });
  const readQuarantineManifest = (quarantineId: string) =>
    tryPromise(() => quarantineFiles.read(quarantineId), {
      operation: "startup_sweep",
      code: "restore",
      phase: "read_quarantine_manifest",
      message: "Failed to read task asset quarantine recovery data.",
    });
  const writeQuarantineManifest = (manifest: QuarantineManifest) =>
    tryPromise(() => quarantineFiles.write(manifest), {
      operation: manifest.operation,
      code: "quarantine",
      phase: "write_quarantine_manifest",
      message: "Failed to write task asset quarantine recovery data.",
      assetIds: manifest.assetIds,
      taskId: manifest.taskId,
    });

  return {
    stage(input) {
      return Effect.gen(function* () {
        yield* validateStageContext(input.workspaceId, input.assetId);
        const destination = stagedPath(input.workspaceId, input.assetId);
        yield* tryPromise(
          async () => {
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
          yield* tryPromise(() => unlink(stagedPath(input.workspaceId, assetId)), {
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
      return tryPromise(
        async () => {
          const stat = await existingStat(stagingRoot);
          const removed = stat ? 1 : 0;
          await rm(stagingRoot, { force: true, recursive: true });
          await mkdir(stagingRoot, { recursive: true });
          return removed;
        },
        {
          operation: "startup_sweep",
          code: "purge",
          phase: "clear_staging",
          message: "Failed to clear expired task asset staging files.",
        },
      );
    },
    promote(input) {
      return Effect.gen(function* () {
        yield* validateContext(input.workspaceId, input.taskId, input.assetId);
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
            operation: "update",
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
        yield* validateContext(input.workspaceId, input.taskId, input.assetId);
        return yield* tryPromise(
          async () =>
            (await existingStat(durablePath(input.workspaceId, input.taskId, input.assetId))) !==
            null,
          {
            operation: "update",
            code: "validation",
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
          yield* validateContext(input.workspaceId, input.taskId, assetId);
          yield* tryPromise(() => unlink(durablePath(input.workspaceId, input.taskId, assetId)), {
            operation: "update",
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
      const promotedAssetIds = input.promotedAssetIds ?? [];
      if (input.assetIds.length === 0 && promotedAssetIds.length === 0) {
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
          operation: input.operation ?? "update",
          assetIds: input.assetIds,
          promotedAssetIds,
        };
        yield* writeQuarantineManifest(manifest);
        for (const assetId of input.assetIds) {
          yield* validateContext(input.workspaceId, input.taskId, assetId);
          const from = durablePath(input.workspaceId, input.taskId, assetId);
          const to = path.join(root, assetId);
          yield* tryPromise(
            async () => {
              await mkdir(root, { recursive: true });
              await rename(from, to);
              moves.push({ from, to });
            },
            {
              operation: "update",
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
                      operation: "update",
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
                    operation: "update",
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
        const placeholderAssetId = "00000000-0000-4000-8000-000000000000";
        yield* validateContext(input.workspaceId, input.taskId, placeholderAssetId);
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
      return tryPromise(() => quarantineFiles.list(), {
        operation: "startup_sweep",
        code: "restore",
        phase: "list_quarantines",
        message: "Failed to list task asset quarantine recovery data.",
      });
    },
    restoreQuarantine(quarantineId) {
      return Effect.gen(function* () {
        const entry = yield* readQuarantineManifest(quarantineId);
        yield* tryPromise(() => quarantineFiles.restore(entry), {
          operation: entry.operation,
          code: "restore",
          phase: "restore_quarantine",
          message: "Failed to restore quarantined task assets.",
          assetIds: entry.assetIds,
          taskId: entry.taskId,
        });
      });
    },
    purgeQuarantine(quarantineId) {
      return Effect.gen(function* () {
        const entry = yield* readQuarantineManifest(quarantineId);
        yield* tryPromise(() => quarantineFiles.purge(quarantineId), {
          operation: entry.operation,
          code: "purge",
          phase: "purge_quarantine",
          message: "Failed to purge quarantined task assets.",
          assetIds: entry.assetIds,
          taskId: entry.taskId,
        });
      });
    },
    readDurable(input) {
      return Effect.gen(function* () {
        yield* validateContext(input.workspaceId, input.taskId, input.assetId);
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
            code: "validation",
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
