import {
  type GitProviderRepository,
  type PullRequestReviewAggregateStatus,
  type PullRequestReviewCheck,
  type PullRequestReviewCheckConclusion,
  type PullRequestReviewCheckStatus,
  type PullRequestReviewComment,
  type PullRequestReviewContext,
  type PullRequestReviewPullRequest,
  type PullRequestReviewState,
  pullRequestReviewContextSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import { combinedCommandOutput } from "../tasks/support/github-pull-request-model";
import type { GithubCommandDependencies } from "../tasks/support/github-pull-requests";
import { runGithubRepositoryCommand } from "../tasks/support/github-pull-requests";
import { runGithubRepositoryCommandAllowFailure } from "../tasks/support/github-repository-command";
import { loadGithubReviewAuthorAvatars } from "./github-pull-request-review-author-avatars";
import { loadGithubReviewThreads } from "./github-pull-request-review-threads";

type GithubCheckPayload = {
  bucket?: unknown;
  completedAt?: unknown;
  description?: unknown;
  event?: unknown;
  link?: unknown;
  name?: unknown;
  startedAt?: unknown;
  state?: unknown;
  workflow?: unknown;
};

type GithubCommentPayload = {
  id?: unknown;
  author?: { login?: unknown } | null;
  body?: unknown;
  createdAt?: unknown;
  submittedAt?: unknown;
  updatedAt?: unknown;
  url?: unknown;
  path?: unknown;
  line?: unknown;
};

type GithubReviewPayload = GithubCommentPayload & {
  submittedAt?: unknown;
  state?: unknown;
  comments?: unknown;
};

type GithubPullViewPayload = {
  number?: unknown;
  title?: unknown;
  url?: unknown;
  state?: unknown;
  isDraft?: unknown;
  comments?: unknown;
  reviews?: unknown;
  latestReviews?: unknown;
};

type GithubPullRequestReviewReadInput = {
  dependencies: GithubCommandDependencies;
  repoPath: string;
  repository: GitProviderRepository;
  pullRequestNumber: number;
};

export type GithubPullRequestReviewProvider = {
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

const toNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const toNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

const requireString = (value: unknown, field: string): string => {
  const parsed = toNullableString(value);
  if (!parsed) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing or invalid.`,
    });
  }
  return parsed;
};

const requirePositiveNumber = (value: unknown, field: string): number => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new HostValidationError({
    field,
    message: `GitHub pull request review field '${field}' is missing or invalid.`,
  });
};

const parseJson = (payload: string, label: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch (cause) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub ${label} response: ${errorMessage(cause)}`,
      cause,
    });
  }
};

const normalizeReviewState = (state: unknown, isDraft: unknown): PullRequestReviewState => {
  const normalized = typeof state === "string" ? state.trim().toLowerCase() : "";
  if (isDraft === true && normalized === "open") {
    return "draft";
  }
  if (normalized === "merged") {
    return "merged";
  }
  if (normalized === "closed") {
    return "closed";
  }
  return "open";
};

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
  const parsed = parseJson(payload, "pull request checks");
  if (!Array.isArray(parsed)) {
    throw new HostValidationError({
      field: "payload",
      message: "Failed to parse GitHub pull request checks response: expected an array.",
    });
  }
  return parsed.map((entry) => {
    const check = entry as GithubCheckPayload;
    return {
      name: requireString(check.name, "name"),
      workflow: toNullableString(check.workflow),
      status: normalizeCheckStatus(check.state),
      conclusion: normalizeCheckConclusion(check.bucket, check.state),
      url: toNullableString(check.link),
      details: toNullableString(check.description) ?? toNullableString(check.event),
      startedAt: toNullableString(check.startedAt),
      completedAt: toNullableString(check.completedAt),
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

const toComment = (
  payload: GithubCommentPayload,
  source: PullRequestReviewComment["source"],
  fallbackId: string,
): PullRequestReviewComment | null => {
  const body = typeof payload.body === "string" ? payload.body : "";
  if (!body.trim()) {
    return null;
  }
  return {
    id: toNullableString(payload.id) ?? fallbackId,
    author: toNullableString(payload.author?.login),
    authorAvatarUrl: null,
    body,
    patch: null,
    suggestionPatches: [],
    url: toNullableString(payload.url),
    createdAt: toNullableString(payload.createdAt) ?? toNullableString(payload.submittedAt),
    updatedAt: toNullableString(payload.updatedAt),
    path: toNullableString(payload.path),
    line: toNullableNumber(payload.line),
    threadId: null,
    isResolved: null,
    source,
  };
};

const parsePullView = (
  payload: string,
): {
  pullRequest: PullRequestReviewPullRequest;
  comments: PullRequestReviewComment[];
} => {
  const parsed = parseJson(payload, "pull request view");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HostValidationError({
      field: "payload",
      message: "Failed to parse GitHub pull request view response: expected an object.",
    });
  }
  const view = parsed as GithubPullViewPayload;
  const comments: PullRequestReviewComment[] = [];
  const issueComments = Array.isArray(view.comments) ? view.comments : [];
  for (const [commentIndex, comment] of issueComments.entries()) {
    const normalized = toComment(
      comment as GithubCommentPayload,
      "comment",
      `github-comment:${commentIndex}`,
    );
    if (normalized) {
      comments.push(normalized);
    }
  }
  const reviews = Array.isArray(view.reviews)
    ? view.reviews
    : Array.isArray(view.latestReviews)
      ? view.latestReviews
      : [];
  for (const [reviewIndex, review] of reviews.entries()) {
    const normalized = toComment(
      review as GithubReviewPayload,
      "review",
      `github-review:${reviewIndex}`,
    );
    if (normalized) {
      comments.push(normalized);
    }
    const reviewComments = (review as GithubReviewPayload).comments;
    const reviewCommentList = Array.isArray(reviewComments) ? reviewComments : [];
    for (const [reviewCommentIndex, reviewComment] of reviewCommentList.entries()) {
      const normalizedReviewComment = toComment(
        reviewComment as GithubCommentPayload,
        "review",
        `github-review:${reviewIndex}:comment:${reviewCommentIndex}`,
      );
      if (normalizedReviewComment) {
        comments.push(normalizedReviewComment);
      }
    }
  }
  return {
    pullRequest: {
      providerId: "github",
      number: requirePositiveNumber(view.number, "number"),
      title: requireString(view.title, "title"),
      url: requireString(view.url, "url"),
      state: normalizeReviewState(view.state, view.isDraft),
    },
    comments,
  };
};

export const createGithubPullRequestReviewProvider = (): GithubPullRequestReviewProvider => ({
  read(input) {
    return Effect.gen(function* () {
      const [pullViewPayload, checksPayload, reviewThreads, authorAvatarUrls] = yield* Effect.all(
        [
          runGithubRepositoryCommand(input.dependencies, input.repoPath, input.repository, [
            "pr",
            "view",
            String(input.pullRequestNumber),
            "--json",
            "number,title,url,state,isDraft,comments,reviews,latestReviews",
          ]).pipe(
            Effect.mapError(
              (cause) =>
                new HostValidationError({
                  field: "github.pull_request",
                  message: errorMessage(cause),
                  cause,
                  details: { pullRequestNumber: input.pullRequestNumber },
                }),
            ),
          ),
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
          loadGithubReviewAuthorAvatars(input),
        ],
        { concurrency: "unbounded" },
      );
      const view = yield* Effect.try({
        try: () => parsePullView(pullViewPayload),
        catch: (cause) =>
          new HostValidationError({
            field: "github.pull_request",
            message: errorMessage(cause),
            cause,
          }),
      });
      const checks = yield* Effect.try({
        try: () => parseChecks(checksPayload),
        catch: (cause) =>
          new HostValidationError({
            field: "github.checks",
            message: errorMessage(cause),
            cause,
          }),
      });
      return yield* Effect.try({
        try: () =>
          pullRequestReviewContextSchema.parse({
            status: "loaded",
            providerId: "github",
            pullRequest: view.pullRequest,
            aggregateStatus: aggregateChecks(checks),
            checks,
            comments: [
              ...view.comments.map((comment) => ({
                ...comment,
                authorAvatarUrl: authorAvatarUrls.get(comment.id) ?? null,
              })),
              ...reviewThreads.comments,
            ],
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
