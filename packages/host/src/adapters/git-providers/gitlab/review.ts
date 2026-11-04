import {
  type PullRequestReviewActivity,
  type PullRequestReviewContext,
  type PullRequestReviewOutcome,
  pullRequestReviewContextSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import {
  errorMessage,
  type HostError,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import type { PullRequestReviewProviderPort } from "../../../ports/pull-request-review-provider-port";
import {
  type GitlabMergeRequestDetail,
  type GitlabUserBasic,
  gitlabApprovalsSchema,
  gitlabMergeRequestDetailSchema,
  gitlabPullRequest,
  gitlabReviewerSchema,
  requireGitlabLinkedPullRequest,
} from "./models";
import { aggregateGitlabChecks, readGitlabChecks } from "./review-checks";
import { readGitlabDiscussionActivities, urlOrNull } from "./review-comments";
import { type GitlabProjectContext, type GitlabRestClient, gitlabProjectPath } from "./rest-client";

/** Reviewer states that show a review. `approved` comes from the current approvals instead. */
const REVIEWER_OUTCOMES = new Map<string, PullRequestReviewOutcome>([
  ["requested_changes", "changes_requested"],
  ["reviewed", "commented"],
]);

const reviewActivity = (
  id: string,
  user: GitlabUserBasic,
  outcome: PullRequestReviewOutcome,
  mergeRequestUrl: string,
  reviewedAt: string | null,
): PullRequestReviewActivity => ({
  id,
  source: "review",
  reviewOutcome: outcome,
  author: user.username,
  authorAvatarUrl: urlOrNull(user.avatar_url),
  body: "",
  patch: null,
  suggestionPatches: [],
  suggestionWarning: null,
  url: mergeRequestUrl,
  createdAt: reviewedAt,
  updatedAt: reviewedAt,
  path: null,
  line: null,
  threadId: null,
  isResolved: null,
});

/** The current approvals, then the reviewers who requested changes or left a review. */
const readReviewActivities = (
  client: GitlabRestClient,
  context: GitlabProjectContext,
  mergeRequest: GitlabMergeRequestDetail,
): Effect.Effect<
  { activities: PullRequestReviewActivity[]; authors: GitlabUserBasic[] },
  HostError
> =>
  Effect.gen(function* () {
    const path = (suffix: string) =>
      gitlabProjectPath(context.project.id, `/merge_requests/${mergeRequest.iid}${suffix}`);
    const [approvals, reviewers] = yield* Effect.all(
      [
        client.json(
          context,
          { operation: "read pull request approvals", path: path("/approvals") },
          gitlabApprovalsSchema,
        ),
        client.pages(
          context,
          { operation: "read pull request reviewers", path: path("/reviewers") },
          gitlabReviewerSchema,
        ),
      ],
      { concurrency: 2 },
    );
    const activities = [
      ...approvals.approved_by.map((approval) =>
        reviewActivity(
          `approval:${approval.user.id}`,
          approval.user,
          "approved",
          mergeRequest.web_url,
          approval.approved_at ?? null,
        ),
      ),
      ...reviewers.flatMap((reviewer) => {
        const outcome = REVIEWER_OUTCOMES.get(reviewer.state);
        return outcome
          ? [
              reviewActivity(
                `reviewer:${reviewer.user.id}`,
                reviewer.user,
                outcome,
                mergeRequest.web_url,
                null,
              ),
            ]
          : [];
      }),
    ];
    return {
      activities,
      authors: [
        ...approvals.approved_by.map((approval) => approval.user),
        ...reviewers.map((reviewer) => reviewer.user),
      ],
    };
  });

const userBotSchema = z.object({ bot: z.boolean() });

/**
 * Reads whether each author is a bot, such as a project or group token bot or a service account
 * with any username. Note authors carry no bot flag, so it comes from the user record. A user
 * keeps its kind, so each user is read once for each instance.
 */
const readBotAuthors = (
  client: GitlabRestClient,
  context: GitlabProjectContext,
  authors: readonly GitlabUserBasic[],
  cache: Map<string, boolean>,
): Effect.Effect<Map<string, boolean>, HostError> =>
  Effect.gen(function* () {
    const unique = new Map(authors.map((author) => [author.id, author]));
    const entries = yield* Effect.forEach(
      [...unique.values()],
      (author) => {
        const key = `${context.repository.instanceUrl}::${author.id}`;
        const cached = cache.get(key);
        if (cached !== undefined) return Effect.succeed([author.username, cached] as const);
        return client
          .json(
            context,
            { operation: "read comment author", path: `/users/${author.id}` },
            userBotSchema,
          )
          .pipe(
            Effect.map(({ bot }) => {
              cache.set(key, bot);
              return [author.username, bot] as const;
            }),
          );
      },
      { concurrency: 4 },
    );
    return new Map(entries);
  });

export const createGitlabReviewPort = ({
  client,
}: {
  client: GitlabRestClient;
}): PullRequestReviewProviderPort => {
  const botAuthors = new Map<string, boolean>();
  return {
    providerId: "gitlab",
    readContext: (input) =>
      Effect.gen(function* () {
        yield* requireGitlabLinkedPullRequest(input.linkedPullRequest);
        const context = yield* client.resolveProject(input.repoConfig);
        yield* requireGitlabLinkedPullRequest(input.linkedPullRequest, context.identity);
        const mergeRequest = yield* client.json(
          context,
          {
            operation: "read pull request",
            path: gitlabProjectPath(
              context.project.id,
              `/merge_requests/${input.linkedPullRequest.number}`,
            ),
          },
          gitlabMergeRequestDetailSchema,
        );
        const [checks, discussions, reviews] = yield* Effect.all(
          [
            readGitlabChecks(client, context, mergeRequest),
            readGitlabDiscussionActivities(client, context, mergeRequest),
            readReviewActivities(client, context, mergeRequest),
          ],
          { concurrency: 3 },
        );
        const bots = yield* readBotAuthors(
          client,
          context,
          [...discussions.authors, ...reviews.authors],
          botAuthors,
        );
        const comments = [...discussions.comments, ...reviews.activities].map((activity) => {
          const authorIsBot = activity.author === null ? undefined : bots.get(activity.author);
          return authorIsBot === undefined ? activity : { ...activity, authorIsBot };
        });
        const state = gitlabPullRequest(mergeRequest, context.identity).record.state;
        const reviewContext: PullRequestReviewContext = {
          status: "loaded",
          providerId: "gitlab",
          pullRequest: {
            providerId: "gitlab",
            number: mergeRequest.iid,
            title: mergeRequest.title,
            url: mergeRequest.web_url,
            state: state === "closed_unmerged" ? "closed" : state,
          },
          aggregateStatus: aggregateGitlabChecks(checks),
          checks,
          comments,
          reviewThreads: { openCount: discussions.openThreadCount },
          refreshedAt: new Date().toISOString(),
        };
        return yield* Effect.try({
          try: () => pullRequestReviewContextSchema.parse(reviewContext),
          catch: (cause) =>
            new HostValidationError({
              message: `GitLab returned review data that OpenDucktor cannot show: ${errorMessage(cause)}`,
              cause,
            }),
        });
      }).pipe(
        Effect.mapError((cause): HostValidationErrorAggregate =>
          cause instanceof HostValidationError
            ? cause
            : new HostValidationError({
                message: `Failed to load GitLab review context: ${errorMessage(cause)}`,
                cause,
              }),
        ),
      ),
  };
};
