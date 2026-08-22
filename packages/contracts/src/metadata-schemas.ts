import type { JsonObject, JsonValue } from "./json-types";
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

const isPlainObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeLegacyTaskMetadataPayload = (value: JsonValue | undefined) => {
  if (!isPlainObject(value)) {
    return value satisfies unknown;
  }

  const payload = value;
  const delivery = payload.delivery;
  if (!isPlainObject(delivery)) {
    return value satisfies unknown;
  }

  return {
    ...payload,
    pullRequest: payload.pullRequest ?? delivery.linkedPullRequest,
    directMerge: payload.directMerge ?? delivery.directMerge,
  } satisfies unknown;
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
