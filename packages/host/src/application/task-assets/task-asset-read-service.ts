import {
  type JsonValue,
  ODT_READ_TASK_ASSETS_MAX_TOTAL_BYTES,
  TASK_ASSET_MAX_DESCRIPTION_ASSETS,
  TASK_ASSET_MAX_FILE_BYTES,
  type TaskAssetMediaType,
  type TaskAssetRenderContext,
  taskAssetIdSchema,
  taskAssetMediaTypeSchema,
  taskAssetRenderContextSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import type { TaskAssetRecord, TaskAssetRegistryPort } from "../../ports/task-asset-registry-port";

export type TaskAssetReadResult = {
  bytes: Uint8Array;
  mediaType: TaskAssetMediaType;
  headers: Readonly<Record<string, string>>;
};

export type TaskAssetBatchReadResult =
  | {
      kind: "available";
      assets: Array<{ assetId: string; asset: TaskAssetReadResult }>;
    }
  | {
      kind: "missing";
      assetIds: string[];
    }
  | {
      kind: "too_large";
      requestedBytes: number;
      maxBytes: number;
    };

export type TaskAssetReadService = {
  read(input: JsonValue | undefined): Effect.Effect<TaskAssetReadResult | null, TaskAssetError>;
  readBatch(input: JsonValue | undefined): Effect.Effect<TaskAssetBatchReadResult, TaskAssetError>;
};

const taskAssetReadBatchContextSchema = taskAssetRenderContextSchema
  .omit({ assetId: true })
  .extend({
    assetIds: taskAssetIdSchema
      .array()
      .min(1)
      .max(TASK_ASSET_MAX_DESCRIPTION_ASSETS)
      .refine(
        (assetIds) => new Set(assetIds).size === assetIds.length,
        "Asset IDs must be distinct.",
      ),
  })
  .strict();

const serveError = (
  phase: string,
  message: string,
  input: TaskAssetRenderContext,
  code: "validation" | "database" = "validation",
) =>
  new TaskAssetError({
    operation: "serve",
    code,
    taskId: input.taskId,
    assetIds: [input.assetId],
    failedPhase: phase,
    durableState: "unchanged",
    retryAllowed: false,
    message,
  });

const contentDisposition = (originalName: string): string => {
  const wellFormedName = Array.from(originalName, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character.length === 1 && codePoint >= 0xd800 && codePoint <= 0xdfff
      ? "\uFFFD"
      : character;
  }).join("");
  const asciiName = Array.from(wellFormedName)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const unsafe =
        codePoint < 0x20 || codePoint > 0x7e || character === '"' || character === "\\";
      return unsafe ? "_" : character;
    })
    .join("")
    .slice(0, 255);
  const safeName = asciiName || "image";
  return `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(wellFormedName)}`;
};

const responseHeaders = (
  record: TaskAssetRecord,
  mediaType: TaskAssetMediaType,
): Readonly<Record<string, string>> => ({
  "Cache-Control": "private, no-store",
  "Content-Disposition": contentDisposition(record.originalName),
  "Content-Type": mediaType,
  "X-Content-Type-Options": "nosniff",
});

const validateRegisteredAsset = (context: TaskAssetRenderContext, record: TaskAssetRecord) =>
  Effect.gen(function* () {
    const mediaType = taskAssetMediaTypeSchema.safeParse(record.mediaType);
    if (!mediaType.success) {
      return yield* serveError(
        "validate_registered_media_type",
        "Task asset has an unsupported registered media type.",
        context,
        "database",
      );
    }
    if (
      !Number.isSafeInteger(record.byteSize) ||
      record.byteSize < 0 ||
      record.byteSize > TASK_ASSET_MAX_FILE_BYTES
    ) {
      return yield* serveError(
        "validate_registered_byte_size",
        "Task asset registry entry has an invalid byte size.",
        context,
        "database",
      );
    }
    return { context, record, mediaType: mediaType.data };
  });

export const createTaskAssetReadService = (input: {
  filePort: Pick<TaskAssetFilePort, "readDurable">;
  registry: Pick<TaskAssetRegistryPort, "getAsset">;
  resolveRepoPath(workspaceId: string): Effect.Effect<string, unknown>;
}): TaskAssetReadService => {
  const mapWorkspaceError = (
    cause: unknown,
    context: Omit<TaskAssetRenderContext, "assetId">,
    assetIds: string[],
  ) => {
    const missingWorkspace = cause instanceof HostValidationError && cause.field === "workspaceId";
    return new TaskAssetError({
      operation: "serve",
      code: missingWorkspace ? "validation" : "filesystem",
      taskId: context.taskId,
      assetIds,
      failedPhase: "resolve_workspace",
      durableState: "unchanged",
      retryAllowed: false,
      message: missingWorkspace
        ? "Task assets were not found."
        : "Task asset workspace could not be read.",
      ...(missingWorkspace ? {} : { cause }),
    });
  };

  const getRegisteredAsset = (repoPath: string, context: TaskAssetRenderContext) =>
    input.registry
      .getAsset({
        repoPath,
        taskId: context.taskId,
        scope: context.scope,
        assetId: context.assetId,
      })
      .pipe(
        Effect.mapError(() =>
          serveError("read_registry", "Task asset could not be read.", context, "database"),
        ),
      );

  const readRegisteredAsset = (
    context: TaskAssetRenderContext,
    record: TaskAssetRecord,
    mediaType: TaskAssetMediaType,
  ) =>
    Effect.gen(function* () {
      const bytes = yield* input.filePort.readDurable(context);
      if (!bytes) {
        return null;
      }
      if (bytes.byteLength !== record.byteSize) {
        return yield* serveError(
          "validate_registered_byte_size",
          "Task asset content does not match its registry entry.",
          context,
          "database",
        );
      }
      return {
        bytes,
        mediaType,
        headers: responseHeaders(record, mediaType),
      };
    });

  return {
    read(rawInput) {
      return Effect.gen(function* () {
        const parsed = taskAssetRenderContextSchema.safeParse(rawInput);
        if (!parsed.success) {
          return yield* new TaskAssetError({
            operation: "serve",
            code: "validation",
            assetIds: [],
            failedPhase: "validate_identifiers",
            durableState: "unchanged",
            retryAllowed: false,
            message: "Task asset identifiers are invalid.",
          });
        }
        const repoPath = yield* input
          .resolveRepoPath(parsed.data.workspaceId)
          .pipe(
            Effect.mapError((cause) =>
              mapWorkspaceError(cause, parsed.data, [parsed.data.assetId]),
            ),
          );
        const record = yield* getRegisteredAsset(repoPath, parsed.data);
        if (!record) {
          return null;
        }
        const validated = yield* validateRegisteredAsset(parsed.data, record);
        return yield* readRegisteredAsset(validated.context, validated.record, validated.mediaType);
      });
    },
    readBatch(rawInput) {
      return Effect.gen(function* () {
        const parsed = taskAssetReadBatchContextSchema.safeParse(rawInput);
        if (!parsed.success) {
          return yield* new TaskAssetError({
            operation: "serve",
            code: "validation",
            assetIds: [],
            failedPhase: "validate_batch_identifiers",
            durableState: "unchanged",
            retryAllowed: false,
            message: "Task asset batch identifiers are invalid.",
          });
        }
        const { assetIds, ...renderContext } = parsed.data;
        const repoPath = yield* input
          .resolveRepoPath(renderContext.workspaceId)
          .pipe(Effect.mapError((cause) => mapWorkspaceError(cause, renderContext, assetIds)));
        const registeredAssets = yield* Effect.forEach(assetIds, (assetId) => {
          const context = { ...renderContext, assetId };
          return getRegisteredAsset(repoPath, context).pipe(
            Effect.map((record) => ({ assetId, context, record })),
          );
        });
        const missingAssetIds = registeredAssets
          .filter((entry) => entry.record === null)
          .map((entry) => entry.assetId);
        if (missingAssetIds.length > 0) {
          return { kind: "missing" as const, assetIds: missingAssetIds };
        }
        const validatedAssets = yield* Effect.forEach(registeredAssets, (entry) =>
          Effect.gen(function* () {
            const record = entry.record;
            if (!record) {
              return yield* serveError(
                "read_registry",
                "Task asset registry entry disappeared.",
                entry.context,
                "database",
              );
            }
            return {
              assetId: entry.assetId,
              ...(yield* validateRegisteredAsset(entry.context, record)),
            };
          }),
        );
        const requestedBytes = validatedAssets.reduce(
          (total, entry) => total + entry.record.byteSize,
          0,
        );
        if (requestedBytes > ODT_READ_TASK_ASSETS_MAX_TOTAL_BYTES) {
          return {
            kind: "too_large" as const,
            requestedBytes,
            maxBytes: ODT_READ_TASK_ASSETS_MAX_TOTAL_BYTES,
          };
        }
        const readAssets = yield* Effect.forEach(validatedAssets, (entry) =>
          readRegisteredAsset(entry.context, entry.record, entry.mediaType).pipe(
            Effect.map((asset) => ({ assetId: entry.assetId, asset })),
          ),
        );
        const missingDurableAssetIds = readAssets
          .filter((entry) => entry.asset === null)
          .map((entry) => entry.assetId);
        if (missingDurableAssetIds.length > 0) {
          return { kind: "missing" as const, assetIds: missingDurableAssetIds };
        }
        const availableAssets = readAssets.filter(
          (
            entry,
          ): entry is {
            assetId: string;
            asset: TaskAssetReadResult;
          } => entry.asset !== null,
        );
        return {
          kind: "available" as const,
          assets: availableAssets,
        };
      });
    },
  };
};
