import { z } from "zod";

/** The issue types of every task. Workflows set rules for them but cannot add one. */
export const ISSUE_TYPE_VALUES = ["task", "feature", "bug"] as const;
export const issueTypeSchema = z.enum(ISSUE_TYPE_VALUES);
export type IssueType = z.infer<typeof issueTypeSchema>;
