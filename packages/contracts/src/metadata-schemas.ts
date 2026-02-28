import { z } from "zod";

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

export const taskMetadataPayloadSchema = z.object({
  spec: taskMetadataDocumentSchema,
  plan: taskMetadataDocumentSchema,
  qaReport: z.preprocess(
    (value) => (value === null ? undefined : value),
    taskMetadataQaReportSchema.optional(),
  ),
  agentSessions: z.array(z.unknown()).default([]),
});
export type TaskMetadataPayload = z.infer<typeof taskMetadataPayloadSchema>;
