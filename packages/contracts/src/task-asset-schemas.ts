import { z } from "zod";
import { workspaceIdSchema } from "./config-schemas";

export const TASK_ASSET_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const TASK_ASSET_MAX_DESCRIPTION_ASSETS = 50;
const TASK_ASSET_MAX_BASE64_CHARACTERS = Math.ceil(TASK_ASSET_MAX_FILE_BYTES / 3) * 4;

export const taskAssetScopeSchema = z.enum(["description"]);
export type TaskAssetScope = z.infer<typeof taskAssetScopeSchema>;

export const taskAssetIdSchema = z.uuid();
export type TaskAssetId = z.infer<typeof taskAssetIdSchema>;

export const taskAssetMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
export type TaskAssetMediaType = z.infer<typeof taskAssetMediaTypeSchema>;

const safeTaskIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/);

const distinctAssetIdsSchema = z
  .array(taskAssetIdSchema)
  .max(TASK_ASSET_MAX_DESCRIPTION_ASSETS)
  .refine((ids) => new Set(ids).size === ids.length, "Asset IDs must be distinct.");

export const taskAssetDescriptionMutationSchema = z
  .object({
    stagedAssetIds: distinctAssetIdsSchema,
  })
  .strict();
export type TaskAssetDescriptionMutation = z.infer<typeof taskAssetDescriptionMutationSchema>;

export const taskAssetStageInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    scope: taskAssetScopeSchema,
    originalName: z.string().trim().min(1).max(255),
    declaredMediaType: taskAssetMediaTypeSchema,
    bytesBase64: z
      .base64()
      .min(1)
      .max(TASK_ASSET_MAX_BASE64_CHARACTERS, "Task description images must be 10 MiB or smaller."),
  })
  .strict();
export type TaskAssetStageInput = z.infer<typeof taskAssetStageInputSchema>;

export const taskAssetStageResultSchema = z
  .object({
    assetId: taskAssetIdSchema,
    scope: taskAssetScopeSchema,
    originalName: z.string().min(1).max(255),
    verifiedMediaType: taskAssetMediaTypeSchema,
    byteSize: z.number().int().nonnegative().max(TASK_ASSET_MAX_FILE_BYTES),
  })
  .strict();
export type TaskAssetStageResult = z.infer<typeof taskAssetStageResultSchema>;

export const taskAssetDiscardStagedInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    assetIds: distinctAssetIdsSchema.min(1),
  })
  .strict();
export type TaskAssetDiscardStagedInput = z.infer<typeof taskAssetDiscardStagedInputSchema>;

export const taskAssetRenderContextSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    taskId: safeTaskIdSchema,
    scope: taskAssetScopeSchema,
    assetId: taskAssetIdSchema,
  })
  .strict();
export type TaskAssetRenderContext = z.infer<typeof taskAssetRenderContextSchema>;

export const taskAssetOperationSchema = z.enum([
  "stage",
  "create",
  "update",
  "delete",
  "discard",
  "startup_sweep",
  "serve",
]);
export type TaskAssetOperation = z.infer<typeof taskAssetOperationSchema>;

export const taskAssetFailureCodeSchema = z.enum([
  "validation",
  "promotion",
  "database",
  "quarantine",
  "restore",
  "purge",
  "partial_state",
]);
export type TaskAssetFailureCode = z.infer<typeof taskAssetFailureCodeSchema>;

export const taskAssetDurableStateSchema = z.enum([
  "unchanged",
  "created_partial",
  "committed_cleanup_pending",
  "unknown",
]);
export type TaskAssetDurableState = z.infer<typeof taskAssetDurableStateSchema>;

export const taskAssetFailureSchema = z
  .object({
    operation: taskAssetOperationSchema,
    code: taskAssetFailureCodeSchema,
    taskId: safeTaskIdSchema.optional(),
    assetIds: distinctAssetIdsSchema,
    failedPhase: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_]+$/),
    durableState: taskAssetDurableStateSchema,
    retryAllowed: z.boolean(),
    message: z.string().min(1),
  })
  .strict();
export type TaskAssetFailure = z.infer<typeof taskAssetFailureSchema>;
