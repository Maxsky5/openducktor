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
import { combinedCommandOutput } from "../../../application/tasks/support/github-pull-request-model";
import type { GithubCommandDependencies } from "../../../application/tasks/support/github-pull-requests";
import { runGithubRepositoryCommandAllowFailure } from "../../../application/tasks/support/github-repository-command";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import { loadGithubPullRequestReviewOverview } from "./github-pull-request-review-overview";
import {
  parseGithubJson,
  requireGithubObject,
  requireGithubString,
  toNullableGithubString,
} from "./github-pull-request-review-payload";
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
  ): Effect.Effect<PullRequestReviewContext, HostValidationError>;
};

const isNoChecksReported = (result: {
  exitCode?: number | null;
  stdout: string;
  stderr: string;
}): boolean =>
  result.exitCode === 1 &&
  result.stdout.trim().length === 0 &&
  result.stderr.toLowerCase().includes("no checks reported");

const normalizeCheckStatus = (state: unknown): PullRequestReviewCheckStatus => {
  const normalized = typeof state === "string" ? state.trim().toLowerCase() : "";
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
  bucket: unknown,
  state: unknown,
): PullRequestReviewCheckConclusion | null => {
  const value =
    typeof bucket === "string" && bucket.trim().length > 0
      ? bucket.trim().toLowerCase()
      : typeof state === "string"
        ? state.trim().toLowerCase()
        : "";
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

const parseChecks = (payload: string): PullRequestReviewCheck[] => {
  const parsed = parseGithubJson(payload, "pull request checks");
  if (!Array.isArray(parsed)) {
    throw new HostValidationError({
      field: "payload",
      message: "Failed to parse GitHub pull request checks response: expected an array.",
    });
  }
  return parsed.map((entry, index) => {
    const check = requireGithubObject(entry, `checks.${index}`);
    return {
      name: requireGithubString(check.name, `checks.${index}.name`),
      workflow: toNullableGithubString(check.workflow),
      status: normalizeCheckStatus(check.state),
      conclusion: normalizeCheckConclusion(check.bucket, check.state),
      url: toNullableGithubString(check.link),
      details: toNullableGithubString(check.description) ?? toNullableGithubString(check.event),
      startedAt: toNullableGithubString(check.startedAt),
      completedAt: toNullableGithubString(check.completedAt),
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
      return yield* Effect.try({
        try: () =>
          pullRequestReviewContextSchema.parse({
            status: "loaded",
            providerId: "github",
            pullRequest: overview.pullRequest,
            aggregateStatus: aggregateChecks(checks),
            checks,
            comments: [...overview.comments, ...reviewThreads.comments],
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
