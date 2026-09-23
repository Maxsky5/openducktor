import { z } from "zod";
import { sourceIssueReferenceSchema } from "./git-schemas";
import { planSubtaskIssueTypeSchema, taskPrioritySchema } from "./task-schemas";

export const sourceIssueSchema = sourceIssueReferenceSchema.extend({
  title: z.string().min(1),
  description: z.string(),
  creator: z.string(),
  updatedAt: z.string(),
  tags: z.array(z.string()),
  revision: z.string().min(1),
  linkedTaskId: z.string().optional(),
});
export type SourceIssue = z.infer<typeof sourceIssueSchema>;

export const issueItemsListInputSchema = z.object({
  repoPath: z.string().min(1),
  search: z.string().default(""),
  cursor: z.string().optional(),
});
export type IssueItemsListInput = z.infer<typeof issueItemsListInputSchema>;

export const issueItemsListResultSchema = z.object({
  items: z.array(sourceIssueSchema).max(20),
  nextCursor: z.string().optional(),
  searchSupported: z.boolean(),
  incompleteResults: z.boolean().default(false),
});
export type IssueItemsListResult = z.infer<typeof issueItemsListResultSchema>;

export const issueItemGetInputSchema = z.object({
  repoPath: z.string().min(1),
  sourceId: z.string().min(1),
});
export type IssueItemGetInput = z.infer<typeof issueItemGetInputSchema>;

export const issueImageGetInputSchema = issueItemGetInputSchema.extend({
  url: z.url(),
});
export type IssueImageGetInput = z.infer<typeof issueImageGetInputSchema>;

export const issueImageGetResultSchema = z.object({
  mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
  bytesBase64: z.string().min(1),
});
export type IssueImageGetResult = z.infer<typeof issueImageGetResultSchema>;

export const issueItemsImportInputSchema = z.object({
  repoPath: z.string().min(1),
  items: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        revision: z.string().min(1),
        issueType: planSubtaskIssueTypeSchema,
        priority: taskPrioritySchema,
        labels: z.array(z.string()),
      }),
    )
    .min(1),
});
export type IssueItemsImportInput = z.infer<typeof issueItemsImportInputSchema>;

export const issueItemsImportResultSchema = z.object({
  results: z.array(
    z.discriminatedUnion("outcome", [
      z.strictObject({
        sourceId: z.string(),
        outcome: z.literal("created"),
        taskId: z.string().min(1),
      }),
      z.strictObject({
        sourceId: z.string(),
        outcome: z.literal("failed"),
        reason: z.string().min(1),
        taskId: z.string().min(1).optional(),
      }),
    ]),
  ),
});
export type IssueItemsImportResult = z.infer<typeof issueItemsImportResultSchema>;

export const azureAreaPathsInputSchema = z.object({ repoPath: z.string().min(1) });
export const azureAreaPathsResultSchema = z.array(z.string().min(1));
