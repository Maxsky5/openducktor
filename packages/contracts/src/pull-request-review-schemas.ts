import { z } from "zod";
import { gitProviderIdSchema } from "./git-schemas";

export const pullRequestReviewProviderIdSchema = gitProviderIdSchema;
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

const urlSchema = z.string().url();
const nullableUrlSchema = urlSchema.nullable();
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableDateTimeSchema = dateTimeSchema.nullable();

export const pullRequestReviewPullRequestSchema = z.object({
  providerId: pullRequestReviewProviderIdSchema,
  number: z.number().int().positive(),
  title: z.string().min(1),
  url: urlSchema,
  state: pullRequestReviewStateSchema,
});
export type PullRequestReviewPullRequest = z.infer<typeof pullRequestReviewPullRequestSchema>;

export const pullRequestReviewCheckSchema = z.object({
  name: z.string().min(1),
  workflow: z.string().nullable(),
  status: pullRequestReviewCheckStatusSchema,
  conclusion: pullRequestReviewCheckConclusionSchema.nullable(),
  url: nullableUrlSchema,
  details: z.string().nullable(),
  startedAt: nullableDateTimeSchema,
  completedAt: nullableDateTimeSchema,
});
export type PullRequestReviewCheck = z.infer<typeof pullRequestReviewCheckSchema>;

const pullRequestReviewActivityFields = {
  id: z.string().min(1),
  author: z.string().nullable(),
  authorAvatarUrl: nullableUrlSchema,
  body: z.string(),
  patch: z.string().nullable(),
  suggestionPatches: z.array(z.string().min(1)),
  url: nullableUrlSchema,
  createdAt: nullableDateTimeSchema,
  updatedAt: nullableDateTimeSchema,
  path: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  threadId: z.string().nullable(),
  isResolved: z.boolean().nullable(),
};

export const pullRequestReviewOutcomeSchema = z.enum([
  "approved",
  "changes_requested",
  "commented",
  "dismissed",
]);
export type PullRequestReviewOutcome = z.infer<typeof pullRequestReviewOutcomeSchema>;

const pullRequestReviewCommentActivitySchema = z.object({
  ...pullRequestReviewActivityFields,
  source: z.literal("comment"),
  reviewOutcome: z.never().optional(),
});

const pullRequestReviewSummaryActivitySchema = z.object({
  ...pullRequestReviewActivityFields,
  source: z.literal("review"),
  reviewOutcome: pullRequestReviewOutcomeSchema,
});

const pullRequestReviewThreadActivitySchema = z.object({
  ...pullRequestReviewActivityFields,
  source: z.literal("review_thread"),
  reviewOutcome: z.never().optional(),
});

export const pullRequestReviewActivitySchema = z.discriminatedUnion("source", [
  pullRequestReviewCommentActivitySchema,
  pullRequestReviewSummaryActivitySchema,
  pullRequestReviewThreadActivitySchema,
]);
export type PullRequestReviewActivity = z.infer<typeof pullRequestReviewActivitySchema>;

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
    comments: z.array(pullRequestReviewActivitySchema),
    reviewThreads: pullRequestReviewThreadsSummarySchema,
    refreshedAt: dateTimeSchema,
  }),
]);
export type PullRequestReviewContext = z.infer<typeof pullRequestReviewContextSchema>;
