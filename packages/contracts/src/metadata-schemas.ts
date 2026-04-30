import { z } from "zod";
import { directMergeRecordSchema, gitTargetBranchSchema, pullRequestSchema } from "./git-schemas";
import { parseAgentSessionRecordCompat } from "./session-schemas";
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
  const delivery = payload.delivery;
  if (!isPlainObject(delivery)) {
    return value;
  }

  return {
    ...payload,
    pullRequest: payload.pullRequest ?? delivery.linkedPullRequest,
    directMerge: payload.directMerge ?? delivery.directMerge,
  };
};

const agentSessionRecordsCompatSchema = z.array(z.unknown()).transform((records, context) => {
  const normalized = [];

  for (let index = 0; index < records.length; index += 1) {
    try {
      normalized.push(parseAgentSessionRecordCompat(records[index]));
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: error instanceof Error ? error.message : "Invalid agent session record metadata.",
      });
      return z.NEVER;
    }
  }

  return normalized;
});

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
    agentSessions: agentSessionRecordsCompatSchema.default([]),
  }),
);
export type TaskMetadataPayload = z.infer<typeof taskMetadataPayloadSchema>;
