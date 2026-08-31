import type {
  GitProviderRepository,
  PullRequestReviewActivity,
  PullRequestReviewOutcome,
  PullRequestReviewPullRequest,
  PullRequestReviewState,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { runGithubCommand } from "../../../application/tasks/support/github-pull-requests";
import {
  errorMessage,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import type { GithubCommandResolverPort } from "../../../ports/github-cli-port";
import { parseGithubJson } from "./github-pull-request-review-payload";

type GithubPullRequestReviewOverviewReadInput = {
  githubCommands: GithubCommandResolverPort;
  repoPath: string;
  repository: GitProviderRepository;
  pullRequestNumber: number;
};

type GithubGraphqlVariable = {
  name: string;
  value: string | number | boolean;
  flag: "-f" | "-F";
};

type GithubPullRequestReviewOverview = {
  pullRequest: PullRequestReviewPullRequest;
  comments: PullRequestReviewActivity[];
};

type ParsedConnection = {
  items: PullRequestReviewActivity[];
  nextCursor: string | null;
};

type ParsedOverviewPage = {
  pullRequest: PullRequestReviewPullRequest;
  comments: ParsedConnection;
  reviews: ParsedConnection;
};

const PULL_REQUEST_REVIEW_OVERVIEW_QUERY = `
query PullRequestReviewOverview(
  $owner: String!
  $name: String!
  $number: Int!
  $commentsCursor: String
  $reviewsCursor: String
  $includeComments: Boolean!
  $includeReviews: Boolean!
) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      url
      state
      isDraft
      comments(first: 100, after: $commentsCursor) @include(if: $includeComments) {
        nodes {
          id
          author {
            login
            avatarUrl(size: 64)
          }
          body
          url
          createdAt
          updatedAt
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      reviews(first: 100, after: $reviewsCursor) @include(if: $includeReviews) {
        nodes {
          id
          author {
            login
            avatarUrl(size: 64)
          }
          body
          state
          url
          createdAt
          submittedAt
          updatedAt
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`;

const optionalTextSchema = z.string().nullable().optional();
const actorSchema = z
  .object({
    login: optionalTextSchema,
    avatarUrl: optionalTextSchema,
  })
  .nullable()
  .optional();
const pageInfoSchema = z.discriminatedUnion("hasNextPage", [
  z.object({ hasNextPage: z.literal(true), endCursor: z.string().min(1) }),
  z.object({ hasNextPage: z.literal(false), endCursor: z.string().nullable() }),
]);
const overviewCommentSchema = z.object({
  id: z.string().min(1),
  author: actorSchema,
  body: z.string(),
  url: optionalTextSchema,
  createdAt: optionalTextSchema,
  updatedAt: optionalTextSchema,
});
const reviewStateSchema = z.enum(
  ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"],
  { error: "GitHub review state is invalid." },
);
const overviewReviewSchema = z.object({
  id: z.string().min(1),
  author: actorSchema,
  body: z.string({ error: "GitHub review body must be a string." }),
  state: reviewStateSchema,
  url: optionalTextSchema,
  createdAt: optionalTextSchema,
  submittedAt: optionalTextSchema,
  updatedAt: optionalTextSchema,
});
const overviewCommentConnectionSchema = z.object({
  nodes: z.array(overviewCommentSchema),
  pageInfo: pageInfoSchema,
});
const overviewReviewConnectionSchema = z.object({
  nodes: z.array(overviewReviewSchema),
  pageInfo: pageInfoSchema,
});
const overviewResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        number: z.number().int().positive(),
        title: z.string().min(1),
        url: z.string().min(1),
        state: z.enum(["OPEN", "CLOSED", "MERGED"]),
        isDraft: z.boolean(),
        comments: overviewCommentConnectionSchema.optional(),
        reviews: overviewReviewConnectionSchema.optional(),
      }),
    }),
  }),
});

type GithubPageInfo = z.output<typeof pageInfoSchema>;
type GithubOverviewComment = z.output<typeof overviewCommentSchema>;
type GithubOverviewReview = z.output<typeof overviewReviewSchema>;
type GithubOverviewPullRequest = z.output<
  typeof overviewResponseSchema
>["data"]["repository"]["pullRequest"];

const toNullableText = (value: string | null | undefined): string | null =>
  value && value.trim().length > 0 ? value : null;

const normalizeReviewState = (
  state: GithubOverviewPullRequest["state"],
  isDraft: boolean,
): PullRequestReviewState => {
  const normalized = state.toLowerCase();
  if (isDraft && normalized === "open") {
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

const parseComment = (comment: GithubOverviewComment): PullRequestReviewActivity | null => {
  if (!comment.body.trim()) {
    return null;
  }
  return {
    id: comment.id,
    author: toNullableText(comment.author?.login),
    authorAvatarUrl: toNullableText(comment.author?.avatarUrl),
    body: comment.body,
    patch: null,
    suggestionPatches: [],
    suggestionWarning: null,
    url: toNullableText(comment.url),
    createdAt: toNullableText(comment.createdAt),
    updatedAt: toNullableText(comment.updatedAt),
    path: null,
    line: null,
    threadId: null,
    isResolved: null,
    source: "comment",
  };
};

const parseReviewOutcome = (
  state: z.output<typeof reviewStateSchema>,
): PullRequestReviewOutcome | null => {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    case "DISMISSED":
      return "dismissed";
    case "PENDING":
      return null;
  }
};

const parseReview = (review: GithubOverviewReview): PullRequestReviewActivity | null => {
  const reviewOutcome = parseReviewOutcome(review.state);
  if (!reviewOutcome) {
    return null;
  }
  return {
    id: review.id,
    author: toNullableText(review.author?.login),
    authorAvatarUrl: toNullableText(review.author?.avatarUrl),
    body: review.body,
    patch: null,
    suggestionPatches: [],
    suggestionWarning: null,
    url: toNullableText(review.url),
    createdAt: toNullableText(review.submittedAt) ?? toNullableText(review.createdAt),
    updatedAt: toNullableText(review.updatedAt),
    path: null,
    line: null,
    threadId: null,
    isResolved: null,
    source: "review",
    reviewOutcome,
  };
};

const parseConnection = <Item>(
  connection: { nodes: Item[]; pageInfo: GithubPageInfo } | undefined,
  field: string,
  parseItem: (item: Item) => PullRequestReviewActivity | null,
  included: boolean,
): ParsedConnection => {
  if (!included) {
    return { items: [], nextCursor: null };
  }
  if (connection === undefined) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing.`,
    });
  }
  const items: PullRequestReviewActivity[] = [];
  for (const entry of connection.nodes) {
    const item = parseItem(entry);
    if (item) {
      items.push(item);
    }
  }
  return {
    items,
    nextCursor: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null,
  };
};

const parseOverviewPage = (
  payload: string,
  includeComments: boolean,
  includeReviews: boolean,
): ParsedOverviewPage => {
  const response = parseGithubJson(payload, "pull request review", overviewResponseSchema);
  const { pullRequest } = response.data.repository;
  return {
    pullRequest: {
      providerId: "github",
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      state: normalizeReviewState(pullRequest.state, pullRequest.isDraft),
    },
    comments: parseConnection(
      pullRequest.comments,
      "pullRequest.comments",
      parseComment,
      includeComments,
    ),
    reviews: parseConnection(
      pullRequest.reviews,
      "pullRequest.reviews",
      parseReview,
      includeReviews,
    ),
  };
};

const runOverviewGraphql = (
  input: GithubPullRequestReviewOverviewReadInput,
  variables: readonly GithubGraphqlVariable[],
): Effect.Effect<string, HostValidationError<{ pullRequestNumber: number }>> =>
  runGithubCommand(input.githubCommands, input.repoPath, input.repository.host, [
    "api",
    "graphql",
    "-f",
    `query=${PULL_REQUEST_REVIEW_OVERVIEW_QUERY}`,
    ...variables.flatMap(({ name, value, flag }) => [flag, `${name}=${value}`]),
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
  );

export const loadGithubPullRequestReviewOverview = (
  input: GithubPullRequestReviewOverviewReadInput,
): Effect.Effect<GithubPullRequestReviewOverview, HostValidationErrorAggregate> =>
  Effect.gen(function* () {
    const comments: PullRequestReviewActivity[] = [];
    const reviews: PullRequestReviewActivity[] = [];
    let pullRequest: PullRequestReviewPullRequest | null = null;
    let commentsCursor: string | null = null;
    let reviewsCursor: string | null = null;
    let includeComments = true;
    let includeReviews = true;

    do {
      const variables: GithubGraphqlVariable[] = [
        { name: "owner", value: input.repository.owner, flag: "-f" },
        { name: "name", value: input.repository.name, flag: "-f" },
        { name: "number", value: input.pullRequestNumber, flag: "-F" },
        { name: "includeComments", value: includeComments, flag: "-F" },
        { name: "includeReviews", value: includeReviews, flag: "-F" },
      ];
      if (commentsCursor) {
        variables.push({ name: "commentsCursor", value: commentsCursor, flag: "-f" });
      }
      if (reviewsCursor) {
        variables.push({ name: "reviewsCursor", value: reviewsCursor, flag: "-f" });
      }
      const payload = yield* runOverviewGraphql(input, variables);
      const page = yield* Effect.try({
        try: () => parseOverviewPage(payload, includeComments, includeReviews),
        catch: (cause) => {
          if (cause instanceof HostValidationError) {
            return cause;
          }
          return new HostValidationError({
            field: "github.pull_request",
            message: errorMessage(cause),
            cause,
          });
        },
      });
      pullRequest = page.pullRequest;
      comments.push(...page.comments.items);
      reviews.push(...page.reviews.items);
      commentsCursor = page.comments.nextCursor;
      reviewsCursor = page.reviews.nextCursor;
      includeComments = commentsCursor !== null;
      includeReviews = reviewsCursor !== null;
    } while (includeComments || includeReviews);

    if (!pullRequest) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "github.pull_request",
          message: "GitHub pull request review response did not include pull request metadata.",
        }),
      );
    }

    return {
      pullRequest,
      comments: [...comments, ...reviews],
    };
  });
