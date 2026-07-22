import {
  TASK_ASSET_MAX_FILE_BYTES,
  type TaskAssetDiscardStagedInput,
  type TaskAssetStageInput,
  type TaskAssetStageResult,
  taskAssetMediaTypeSchema,
  taskAssetStageInputSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { fileTypeFromBuffer } from "file-type";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import { TaskAssetError, taskAssetValidationError } from "./task-asset-error";

export type StagedTaskAsset = TaskAssetStageResult & { workspaceId: string };

export type TaskAssetStagingService = {
  stage(input: TaskAssetStageInput): Effect.Effect<TaskAssetStageResult, TaskAssetError>;
  discard(input: TaskAssetDiscardStagedInput): Effect.Effect<void, TaskAssetError>;
  getStagedAssets(input: {
    workspaceId: string;
    assetIds: string[];
  }): Effect.Effect<StagedTaskAsset[], TaskAssetError>;
  startupSweep(): Effect.Effect<number, TaskAssetError>;
};

const hasCompleteImageEnvelope = (bytes: Uint8Array, mediaType: string): boolean => {
  if (mediaType === "image/png") {
    return (
      bytes.length >= 20 &&
      bytes.slice(-12, -8).every((byte) => byte === 0) &&
      bytes.slice(-8, -4).every((byte, index) => byte === [0x49, 0x45, 0x4e, 0x44][index])
    );
  }
  if (mediaType === "image/jpeg") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes.at(-2) === 0xff &&
      bytes.at(-1) === 0xd9
    );
  }
  if (mediaType === "image/gif") {
    return bytes.length >= 14 && bytes.at(-1) === 0x3b;
  }
  if (mediaType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes.slice(0, 4).every((byte, index) => byte === [0x52, 0x49, 0x46, 0x46][index]) &&
      bytes.slice(8, 12).every((byte, index) => byte === [0x57, 0x45, 0x42, 0x50][index]) &&
      new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true) + 8 === bytes.length
    );
  }
  return false;
};

const sanitizeOriginalName = (originalName: string): string => {
  const cleaned = Array.from(originalName)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })
    .join("");
  const sanitized = cleaned.split(/[\\/]/).at(-1)?.trim();
  return sanitized || "image";
};

const decodeBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export const createTaskAssetStagingService = (
  filePort: TaskAssetFilePort,
): TaskAssetStagingService => {
  const staged = new Map<string, StagedTaskAsset>();
  const getStagedAssets = (input: { workspaceId: string; assetIds: string[] }) =>
    Effect.gen(function* () {
      const assets: StagedTaskAsset[] = [];
      for (const assetId of input.assetIds) {
        const asset = staged.get(assetId);
        if (!asset) {
          return yield* taskAssetValidationError(`Task asset ${assetId} is not staged.`, [assetId]);
        }
        if (asset.workspaceId !== input.workspaceId) {
          return yield* taskAssetValidationError(
            `Task asset ${assetId} does not belong to the same workspace.`,
            [assetId],
          );
        }
        assets.push(asset);
      }
      return assets;
    });

  return {
    stage(input) {
      return Effect.gen(function* () {
        const parsed = taskAssetStageInputSchema.safeParse(input);
        if (!parsed.success) {
          return yield* taskAssetValidationError(
            `Invalid task asset upload: ${parsed.error.message}`,
          );
        }
        const bytes = decodeBase64(parsed.data.bytesBase64);
        if (bytes.byteLength > TASK_ASSET_MAX_FILE_BYTES) {
          return yield* taskAssetValidationError(
            "Task description images must be 10 MiB or smaller.",
          );
        }
        const detected = yield* Effect.tryPromise({
          try: () => fileTypeFromBuffer(bytes),
          catch: (cause) =>
            new TaskAssetError({
              operation: "stage",
              code: "validation",
              assetIds: [],
              failedPhase: "sniff_media_type",
              durableState: "unchanged",
              retryAllowed: true,
              message: "Failed to inspect the uploaded image content.",
              cause,
            }),
        });
        const verifiedMediaType = taskAssetMediaTypeSchema.safeParse(detected?.mime);
        if (!verifiedMediaType.success) {
          return yield* taskAssetValidationError(
            "Task description images must be valid PNG, JPEG, WebP, or GIF files.",
          );
        }
        if (verifiedMediaType.data !== parsed.data.declaredMediaType) {
          return yield* taskAssetValidationError(
            `The declared media type ${parsed.data.declaredMediaType} does not match the verified ${verifiedMediaType.data} content.`,
          );
        }
        if (!hasCompleteImageEnvelope(bytes, verifiedMediaType.data)) {
          return yield* taskAssetValidationError("The uploaded image is truncated or malformed.");
        }

        const assetId = crypto.randomUUID();
        const result: TaskAssetStageResult = {
          assetId,
          scope: parsed.data.scope,
          originalName: sanitizeOriginalName(parsed.data.originalName),
          verifiedMediaType: verifiedMediaType.data,
          byteSize: bytes.byteLength,
        };
        yield* filePort.stage({ workspaceId: parsed.data.workspaceId, assetId, bytes });
        staged.set(assetId, { ...result, workspaceId: parsed.data.workspaceId });
        return result;
      });
    },
    discard(input) {
      return Effect.gen(function* () {
        const assets = yield* getStagedAssets(input);
        yield* filePort.removeStaged({
          workspaceId: input.workspaceId,
          assetIds: assets.map((asset) => asset.assetId),
        });
        for (const asset of assets) {
          staged.delete(asset.assetId);
        }
      });
    },
    getStagedAssets,
    startupSweep() {
      return filePort.clearStaging().pipe(Effect.tap(() => Effect.sync(() => staged.clear())));
    },
  };
};
