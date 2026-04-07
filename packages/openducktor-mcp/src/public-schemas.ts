import {
  issueTypeSchema,
  qaReportVerdictSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "@openducktor/contracts";
import { z } from "zod";

export const publicTaskSchema = z
  .object({
    id: z.string().trim().min(1).describe("Canonical task identifier."),
    title: z.string().describe("Task title."),
    description: z.string().describe("Task description. Empty string when omitted."),
    status: taskStatusSchema.describe("Current task status."),
    priority: taskPrioritySchema.describe(
      "Task priority. Valid values: 0 (P0 Critical), 1 (P1 High), 2 (P2 Normal), 3 (P3 Low), 4 (P4 Very low).",
    ),
    issueType: issueTypeSchema.describe("Task issue type."),
    aiReviewEnabled: z
      .boolean()
      .describe("Whether OpenDucktor QA review is required before human review."),
    labels: z.array(z.string()).describe("Task labels."),
    createdAt: z.string().describe("Task creation timestamp."),
    updatedAt: z.string().describe("Task last update timestamp."),
  })
  .strict();
export type PublicTask = z.infer<typeof publicTaskSchema>;

export const taskDocumentPresenceSchema = z
  .object({
    hasSpec: z.boolean(),
    hasPlan: z.boolean(),
    hasQaReport: z.boolean(),
  })
  .strict();
export type TaskDocumentPresence = z.infer<typeof taskDocumentPresenceSchema>;

export const publicTaskSummaryTaskSchema = publicTaskSchema
  .extend({
    qaVerdict: qaReportVerdictSchema.nullable(),
    documents: taskDocumentPresenceSchema,
  })
  .strict();
export type PublicTaskSummaryTask = z.infer<typeof publicTaskSummaryTaskSchema>;

export const taskSummarySchema = z
  .object({
    task: publicTaskSummaryTaskSchema,
  })
  .strict();
export type TaskSummary = z.infer<typeof taskSummarySchema>;

const markdownTaskDocumentSchema = z
  .object({
    markdown: z.string(),
    updatedAt: z.string().nullable(),
  })
  .strict();

const latestQaReportSchema = z
  .object({
    markdown: z.string(),
    updatedAt: z.string().nullable(),
    verdict: qaReportVerdictSchema.nullable(),
  })
  .strict();

export const taskRequestedDocumentsSchema = z
  .object({
    spec: markdownTaskDocumentSchema.optional(),
    implementationPlan: markdownTaskDocumentSchema.optional(),
    latestQaReport: latestQaReportSchema.optional(),
  })
  .strict();
export type TaskRequestedDocuments = z.infer<typeof taskRequestedDocumentsSchema>;

export const taskDocumentsReadSchema = z
  .object({
    documents: taskRequestedDocumentsSchema,
  })
  .strict();
export type TaskDocumentsRead = z.infer<typeof taskDocumentsReadSchema>;
