import {
  type GitProviderRepository,
  type PullRequestReviewAggregateStatus,
  type PullRequestReviewCheck,
  type PullRequestReviewCheckConclusion,
  type PullRequestReviewCheckStatus,
  type PullRequestReviewContext,
  pullRequestReviewContextSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { combinedCommandOutput } from "../../../application/tasks/support/github-pull-request-model";
import type { GithubCommandDependencies } from "../../../application/tasks/support/github-pull-requests";
import { runGithubRepositoryCommandAllowFailure } from "../../../application/tasks/support/github-repository-command";
import {
  errorMessage,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import { loadGithubPullRequestReviewOverview } from "./github-pull-request-review-overview";
import { parseGithubJson } from "./github-pull-request-review-payload";
import { loadGithubReviewThreads } from "./github-pull-request-review-threads";

type GithubPullRequestReviewReadInput = {
  dependencies: GithubCommandDependencies;
  repoPath: string;
  repository: GitProviderRepository;
  pullRequestNumber: number;
};

export type GithubPullRequestReviewReader = {
  read(
    input: GithubPullRequestReviewReadInput,
  ): Effect.Effect<PullRequestReviewContext, HostValidationErrorAggregate>;
};

const isNoChecksReported = (result: {
  exitCode?: number | null;
  stdout: string;
  stderr: string;
}): boolean =>
  result.exitCode === 1 &&
  result.stdout.trim().length === 0 &&
  result.stderr.toLowerCase().includes("no checks reported");

const normalizeCheckStatus = (state: string | null): PullRequestReviewCheckStatus => {
  const normalized = state?.trim().toLowerCase() ?? "";
  if (
    normalized.includes("queued") ||
    normalized.includes("pending") ||
    normalized === "expected"
  ) {
    return "queued";
  }
  if (normalized.includes("progress") || normalized.includes("running")) {
    return "in_progress";
  }
  if (normalized.length > 0) {
    return "completed";
  }
  return "unknown";
};

const normalizeCheckConclusion = (
  bucket: string | null,
  state: string | null,
): PullRequestReviewCheckConclusion | null => {
  const value = bucket?.trim().toLowerCase() || state?.trim().toLowerCase() || "";
  if (!value || value === "pending" || value === "queued" || value === "in_progress") {
    return null;
  }
  if (value === "pass" || value === "success") {
    return "success";
  }
  if (value === "fail" || value === "failure" || value === "failed" || value === "error") {
    return "failure";
  }
  if (value === "cancel" || value === "cancelled" || value === "canceled") {
    return "cancelled";
  }
  if (value === "skipping" || value === "skipped") {
    return "skipped";
  }
  if (value === "timed_out" || value === "timedout") {
    return "timed_out";
  }
  if (value === "action_required") {
    return "action_required";
  }
  if (value === "neutral") {
    return "neutral";
  }
  return "unknown";
};

const optionalCheckTextSchema = z.string().nullable().optional();
const checksResponseSchema = z.array(
  z.object({
    name: z.string().min(1),
    workflow: optionalCheckTextSchema,
    state: optionalCheckTextSchema,
    bucket: optionalCheckTextSchema,
    link: optionalCheckTextSchema,
    description: optionalCheckTextSchema,
    event: optionalCheckTextSchema,
    startedAt: optionalCheckTextSchema,
    completedAt: optionalCheckTextSchema,
  }),
);

const toNullableCheckText = (value: string | null | undefined): string | null =>
  value && value.trim().length > 0 ? value : null;

const parseChecks = (payload: string): PullRequestReviewCheck[] => {
  const checks = parseGithubJson(payload, "pull request checks", checksResponseSchema, "checks");
  return checks.map((check) => {
    const state = toNullableCheckText(check.state);
    return {
      name: check.name,
      workflow: toNullableCheckText(check.workflow),
      status: normalizeCheckStatus(state),
      conclusion: normalizeCheckConclusion(toNullableCheckText(check.bucket), state),
      url: toNullableCheckText(check.link),
      details: toNullableCheckText(check.description) ?? toNullableCheckText(check.event),
      startedAt: toNullableCheckText(check.startedAt),
      completedAt: toNullableCheckText(check.completedAt),
    };
  });
};

const aggregateChecks = (
  checks: readonly PullRequestReviewCheck[],
): PullRequestReviewAggregateStatus => {
  if (checks.length === 0) {
    return "unknown";
  }
  if (
    checks.some(
      (check) =>
        check.conclusion === "failure" ||
        check.conclusion === "cancelled" ||
        check.conclusion === "timed_out" ||
        check.conclusion === "action_required",
    )
  ) {
    return "failure";
  }
  if (checks.some((check) => check.status === "queued" || check.status === "in_progress")) {
    return "pending";
  }
  if (checks.every((check) => check.conclusion === "success" || check.conclusion === "skipped")) {
    return "success";
  }
  return "neutral";
};

export const createGithubPullRequestReviewReader = (): GithubPullRequestReviewReader => ({
  read(input) {
    return Effect.gen(function* () {
      const [overview, checksPayload, reviewThreads] = yield* Effect.all(
        [
          loadGithubPullRequestReviewOverview(input),
          runGithubRepositoryCommandAllowFailure(
            input.dependencies,
            input.repoPath,
            input.repository,
            [
              "pr",
              "checks",
              String(input.pullRequestNumber),
              "--json",
              "bucket,completedAt,description,event,link,name,startedAt,state,workflow",
            ],
          ).pipe(
            Effect.flatMap((result) => {
              if (result.ok || result.exitCode === 8) {
                return Effect.succeed(result.stdout);
              }
              if (isNoChecksReported(result)) {
                return Effect.succeed("[]");
              }
              return Effect.fail(
                new HostValidationError({
                  field: "github.checks",
                  message:
                    combinedCommandOutput(result.stdout, result.stderr) ||
                    "Unable to read GitHub pull request checks.",
                  details: { pullRequestNumber: input.pullRequestNumber },
                }),
              );
            }),
            Effect.mapError(
              (cause) =>
                new HostValidationError({
                  field: "github.checks",
                  message: errorMessage(cause),
                  cause,
                  details: { pullRequestNumber: input.pullRequestNumber },
                }),
            ),
          ),
          loadGithubReviewThreads(input),
        ],
        { concurrency: "unbounded" },
      );
      const checks = yield* Effect.try({
        try: () => parseChecks(checksPayload),
        catch: (cause) => {
          if (cause instanceof HostValidationError) {
            return cause;
          }
          return new HostValidationError({
            field: "github.checks",
            message: errorMessage(cause),
            cause,
          });
        },
      });
      const overviewComments = overview.comments.filter((comment) => {
        if (comment.source !== "review") {
          return true;
        }
        const isInlineOnlyReview =
          comment.reviewOutcome === "commented" &&
          comment.body.length === 0 &&
          reviewThreads.reviewIdsWithComments.has(comment.id);
        return !isInlineOnlyReview;
      });
      return yield* Effect.try({
        try: () =>
          pullRequestReviewContextSchema.parse({
            status: "loaded",
            providerId: "github",
            pullRequest: overview.pullRequest,
            aggregateStatus: aggregateChecks(checks),
            checks,
            comments: [...overviewComments, ...reviewThreads.comments],
            reviewThreads: reviewThreads.summary,
            refreshedAt: new Date().toISOString(),
          }),
        catch: (cause) =>
          new HostValidationError({
            field: "github.review_context",
            message: `GitHub pull request review response failed schema validation: ${errorMessage(cause)}`,
            cause,
          }),
      });
    });
  },
});
