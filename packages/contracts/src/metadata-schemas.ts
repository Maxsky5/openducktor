import { z } from "zod";
import { directMergeRecordSchema, gitTargetBranchSchema, pullRequestSchema } from "./git-schemas";
import { agentSessionRecordSchema } from "./session-schemas";
import { qaWorkflowVerdictSchema } from "./task-schemas";

export const taskMetadataDocumentSchema = z.object({
  markdown: z.string().default(""),
  updatedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  revision: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.number().int().nonnegative().optional(),
  ),
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

const unknownRecordSchema = z.record(z.string(), z.unknown());

const normalizeLegacyTaskMetadataPayload = (value: unknown): Record<string, unknown> | null => {
  const payload = unknownRecordSchema.safeParse(value);
  if (!payload.success) {
    return null;
  }

  const delivery = unknownRecordSchema.safeParse(payload.data.delivery);
  if (!delivery.success) {
    return payload.data;
  }

  const pullRequest = payload.data.pullRequest ?? delivery.data.linkedPullRequest;
  const directMerge = payload.data.directMerge ?? delivery.data.directMerge;

  return {
    ...payload.data,
    ...(pullRequest === undefined ? undefined : { pullRequest }),
    ...(directMerge === undefined ? undefined : { directMerge }),
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
