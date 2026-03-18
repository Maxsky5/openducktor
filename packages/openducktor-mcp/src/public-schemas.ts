import { issueTypeSchema, taskPrioritySchema, taskStatusSchema } from "@openducktor/contracts";
import { z } from "zod";

export const publicTaskSchema = z.object({
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
});
export type PublicTask = z.infer<typeof publicTaskSchema>;

export const taskDocumentsSnapshotSchema = z.object({
  spec: z.object({
    markdown: z.string(),
    updatedAt: z.string().nullable(),
  }),
  implementationPlan: z.object({
    markdown: z.string(),
    updatedAt: z.string().nullable(),
  }),
  latestQaReport: z.object({
    markdown: z.string(),
    updatedAt: z.string().nullable(),
    verdict: z.enum(["approved", "rejected"]).nullable(),
  }),
});
export type TaskDocumentsSnapshotOutput = z.infer<typeof taskDocumentsSnapshotSchema>;

export const taskSnapshotSchema = z.object({
  task: publicTaskSchema,
  documents: taskDocumentsSnapshotSchema,
});
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;
