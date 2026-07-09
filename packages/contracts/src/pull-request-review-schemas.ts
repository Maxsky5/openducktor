import { z } from "zod";

export const pullRequestReviewProviderIdSchema = z.enum(["github"]);
export type PullRequestReviewProviderId = z.infer<typeof pullRequestReviewProviderIdSchema>;

export const pullRequestReviewStateSchema = z.enum(["open", "draft", "merged", "closed"]);
export type PullRequestReviewState = z.infer<typeof pullRequestReviewStateSchema>;

export const pullRequestReviewAggregateStatusSchema = z.enum([
  "success",
  "failure",
  "pending",
  "neutral",
  "unknown",
]);
export type PullRequestReviewAggregateStatus = z.infer<
  typeof pullRequestReviewAggregateStatusSchema
>;

export const pullRequestReviewCheckStatusSchema = z.enum([
  "queued",
  "in_progress",
  "completed",
  "unknown",
]);
export type PullRequestReviewCheckStatus = z.infer<typeof pullRequestReviewCheckStatusSchema>;

export const pullRequestReviewCheckConclusionSchema = z.enum([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "neutral",
  "unknown",
]);
export type PullRequestReviewCheckConclusion = z.infer<
  typeof pullRequestReviewCheckConclusionSchema
>;

export const pullRequestReviewPullRequestSchema = z.object({
  providerId: pullRequestReviewProviderIdSchema,
  number: z.number().int().positive(),
  title: z.string().min(1),
  url: z.string().min(1),
  state: pullRequestReviewStateSchema,
});
export type PullRequestReviewPullRequest = z.infer<typeof pullRequestReviewPullRequestSchema>;

export const pullRequestReviewCheckSchema = z.object({
  name: z.string().min(1),
  workflow: z.string().nullable(),
  status: pullRequestReviewCheckStatusSchema,
  conclusion: pullRequestReviewCheckConclusionSchema.nullable(),
  url: z.string().nullable(),
  details: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type PullRequestReviewCheck = z.infer<typeof pullRequestReviewCheckSchema>;

export const pullRequestReviewCommentSchema = z.object({
  id: z.string().min(1),
  author: z.string().nullable(),
  body: z.string(),
  patch: z.string().nullable(),
  url: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  path: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  threadId: z.string().nullable(),
  isResolved: z.boolean().nullable(),
  source: z.enum(["comment", "review", "review_thread"]),
});
export type PullRequestReviewComment = z.infer<typeof pullRequestReviewCommentSchema>;

export const pullRequestReviewThreadsSummarySchema = z.object({
  openCount: z.number().int().nonnegative(),
});
export type PullRequestReviewThreadsSummary = z.infer<typeof pullRequestReviewThreadsSummarySchema>;

export const pullRequestReviewContextSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unavailable"),
    providerId: pullRequestReviewProviderIdSchema,
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal("no_pull_request"),
    providerId: pullRequestReviewProviderIdSchema,
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal("error"),
    providerId: pullRequestReviewProviderIdSchema,
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal("loaded"),
    providerId: pullRequestReviewProviderIdSchema,
    pullRequest: pullRequestReviewPullRequestSchema,
    aggregateStatus: pullRequestReviewAggregateStatusSchema,
    checks: z.array(pullRequestReviewCheckSchema),
    comments: z.array(pullRequestReviewCommentSchema),
    reviewThreads: pullRequestReviewThreadsSummarySchema,
    refreshedAt: z.string().min(1),
  }),
]);
export type PullRequestReviewContext = z.infer<typeof pullRequestReviewContextSchema>;
