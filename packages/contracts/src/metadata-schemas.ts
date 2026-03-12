import { z } from "zod";
import { directMergeRecordSchema, pullRequestSchema } from "./git-schemas";

export const taskMetadataDocumentSchema = z.object({
  markdown: z.string().default(""),
  updatedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type TaskMetadataDocument = z.infer<typeof taskMetadataDocumentSchema>;

export const taskMetadataQaReportSchema = z.object({
  markdown: z.string(),
  verdict: z.enum(["approved", "rejected"]),
  updatedAt: z.string(),
  revision: z.number().int().nonnegative(),
});
export type TaskMetadataQaReport = z.infer<typeof taskMetadataQaReportSchema>;

const normalizeLegacyTaskMetadataPayload = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const payload = value as Record<string, unknown>;
  if ("pullRequest" in payload || "directMerge" in payload) {
    return value;
  }

  const delivery =
    payload.delivery && typeof payload.delivery === "object"
      ? (payload.delivery as Record<string, unknown>)
      : null;
  if (!delivery) {
    return value;
  }

  return {
    ...payload,
    pullRequest: delivery.linkedPullRequest ?? payload.pullRequest,
    directMerge: delivery.directMerge ?? payload.directMerge,
  };
};

export const taskMetadataPayloadSchema = z.preprocess(
  normalizeLegacyTaskMetadataPayload,
  z.object({
    spec: taskMetadataDocumentSchema,
    plan: taskMetadataDocumentSchema,
    qaReport: z.preprocess(
      (value) => (value === null ? undefined : value),
      taskMetadataQaReportSchema.optional(),
    ),
    pullRequest: z.preprocess(
      (value) => (value === null ? undefined : value),
      pullRequestSchema.optional(),
    ),
    directMerge: z.preprocess(
      (value) => (value === null ? undefined : value),
      directMergeRecordSchema.optional(),
    ),
    agentSessions: z.array(z.unknown()).default([]),
  }),
);
export type TaskMetadataPayload = z.infer<typeof taskMetadataPayloadSchema>;
