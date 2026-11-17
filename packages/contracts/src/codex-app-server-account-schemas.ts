import { z } from "zod";
import { codexInt64Schema } from "./codex-app-server-number-schemas";

/** One usage window. `resetsAt` is in Unix seconds. */
export const codexAppServerRateLimitWindowSchema = z.object({
  usedPercent: codexInt64Schema,
  windowDurationMins: codexInt64Schema.nullable().optional(),
  resetsAt: codexInt64Schema.nullable().optional(),
});

/** The usage of one metered limit. OpenDucktor reads only the fields that recovery needs. */
export const codexAppServerRateLimitSnapshotSchema = z.object({
  limitId: z.string().nullable().optional(),
  primary: codexAppServerRateLimitWindowSchema.nullable().optional(),
  secondary: codexAppServerRateLimitWindowSchema.nullable().optional(),
  credits: z.object({ hasCredits: z.boolean(), unlimited: z.boolean() }).nullable().optional(),
  spendControlReached: z.boolean().nullable().optional(),
  rateLimitReachedType: z.string().nullable().optional(),
});

/** The `account/rateLimits/read` response. */
export const codexAppServerAccountRateLimitsResponseSchema = z.object({
  /**
   * The backend permission for ordinary included usage. `null` or absent means unavailable, and
   * Codex tells clients not to infer recovery from percentages or reset times.
   */
  ordinaryUsageAllowed: z.boolean().nullable().optional(),
  rateLimits: codexAppServerRateLimitSnapshotSchema,
  rateLimitsByLimitId: z
    .record(z.string(), codexAppServerRateLimitSnapshotSchema)
    .nullable()
    .optional(),
  rateLimitUpsell: z.unknown().optional(),
});

/** The `account/rateLimits/updated` notification. Codex sends the limit of a failed request first. */
export const codexAppServerAccountRateLimitsUpdatedSchema = z.object({
  rateLimits: codexAppServerRateLimitSnapshotSchema,
});

export type CodexAppServerRateLimitWindow = z.output<typeof codexAppServerRateLimitWindowSchema>;
export type CodexAppServerRateLimitSnapshot = z.output<
  typeof codexAppServerRateLimitSnapshotSchema
>;
export type CodexAppServerAccountRateLimitsResponse = z.output<
  typeof codexAppServerAccountRateLimitsResponseSchema
>;
