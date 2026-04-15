import { z } from "zod";
import { directMergeRecordSchema, gitTargetBranchSchema, pullRequestSchema } from "./git-schemas";
import { agentSessionRecordSchema } from "./session-schemas";
import { qaWorkflowVerdictSchema } from "./task-schemas";

export const taskMetadataDocumentSchema = z.object({
  markdown: z.string().default(""),
  updatedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  error: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type TaskMetadataDocument = z.infer<typeof taskMetadataDocumentSchema>;

export const taskMetadataQaReportSchema = z.object({
  markdown: z.string(),
  verdict: qaWorkflowVerdictSchema,
  updatedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  revision: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.number().int().nonnegative().optional(),
  ),
  error: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type TaskMetadataQaReport = z.infer<typeof taskMetadataQaReportSchema>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeLegacyTaskMetadataPayload = (value: unknown): unknown => {
  if (!isPlainObject(value)) {
    return value;
  }

  const payload = value;
  if ("pullRequest" in payload || "directMerge" in payload) {
    return value;
  }

  const delivery = payload.delivery;
  if (!isPlainObject(delivery)) {
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
    targetBranch: z.preprocess(
      (value) => (value === null ? undefined : value),
      gitTargetBranchSchema.optional(),
    ),
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
    agentSessions: z.array(agentSessionRecordSchema).default([]),
  }),
);
export type TaskMetadataPayload = z.infer<typeof taskMetadataPayloadSchema>;
