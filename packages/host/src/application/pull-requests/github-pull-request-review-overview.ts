import type {
  GitProviderRepository,
  PullRequestReviewComment,
  PullRequestReviewPullRequest,
  PullRequestReviewState,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import {
  type GithubCommandDependencies,
  runGithubCommand,
} from "../tasks/support/github-pull-requests";

type GithubGraphqlPageInfoPayload = {
  hasNextPage?: unknown;
  endCursor?: unknown;
};

type GithubAuthorPayload = {
  avatarUrl?: unknown;
  login?: unknown;
};

type GithubReviewItemPayload = {
  author?: GithubAuthorPayload | null;
  body?: unknown;
  createdAt?: unknown;
  id?: unknown;
  submittedAt?: unknown;
  updatedAt?: unknown;
  url?: unknown;
};

type GithubReviewConnectionPayload = {
  nodes?: unknown;
  pageInfo?: GithubGraphqlPageInfoPayload | null;
};

type GithubPullRequestPayload = {
  comments?: GithubReviewConnectionPayload | null;
  isDraft?: unknown;
  number?: unknown;
  reviews?: GithubReviewConnectionPayload | null;
  state?: unknown;
  title?: unknown;
  url?: unknown;
};

type GithubReviewOverviewPayload = {
  data?: {
    repository?: {
      pullRequest?: GithubPullRequestPayload | null;
    } | null;
  } | null;
};

type GithubPullRequestReviewOverviewReadInput = {
  dependencies: GithubCommandDependencies;
  repoPath: string;
  repository: GitProviderRepository;
  pullRequestNumber: number;
};

type ParsedConnection = {
  comments: PullRequestReviewComment[];
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

const toNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const requireString = (value: unknown, field: string): string => {
  const parsed = toNullableString(value);
  if (parsed) {
    return parsed;
  }
  throw new HostValidationError({
    field,
    message: `GitHub pull request review field '${field}' is missing or invalid.`,
  });
};

const requirePositiveNumber = (value: unknown, field: string): number => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new HostValidationError({
    field,
    message: `GitHub pull request review field '${field}' is missing or invalid.`,
  });
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

const parseNextCursor = (
  pageInfo: GithubGraphqlPageInfoPayload | null | undefined,
  field: string,
): string | null => {
  if (!pageInfo || typeof pageInfo.hasNextPage !== "boolean") {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing or invalid.`,
    });
  }
  return pageInfo.hasNextPage ? requireString(pageInfo.endCursor, `${field}.endCursor`) : null;
};

const parseComment = (
  payload: GithubReviewItemPayload,
  source: "comment" | "review",
  field: string,
): PullRequestReviewComment | null => {
  const body = typeof payload.body === "string" ? payload.body : "";
  if (!body.trim()) {
    return null;
  }
  const submittedAt = source === "review" ? toNullableString(payload.submittedAt) : null;
  return {
    id: requireString(payload.id, `${field}.id`),
    author: toNullableString(payload.author?.login),
    authorAvatarUrl: toNullableString(payload.author?.avatarUrl),
    body,
    patch: null,
    suggestionPatches: [],
    url: toNullableString(payload.url),
    createdAt: submittedAt ?? toNullableString(payload.createdAt),
    updatedAt: toNullableString(payload.updatedAt),
    path: null,
    line: null,
    threadId: null,
    isResolved: null,
    source,
  };
};

const parseConnection = (
  connection: GithubReviewConnectionPayload | null | undefined,
  field: string,
  source: "comment" | "review",
  included: boolean,
): ParsedConnection => {
  if (!included) {
    return { comments: [], nextCursor: null };
  }
  if (!connection || !Array.isArray(connection.nodes)) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}.nodes' is missing or invalid.`,
    });
  }
  const comments: PullRequestReviewComment[] = [];
  for (const [index, entry] of connection.nodes.entries()) {
    const comment = parseComment(
      entry as GithubReviewItemPayload,
      source,
      `${field}.nodes.${index}`,
    );
    if (comment) {
      comments.push(comment);
    }
  }
  return {
    comments,
    nextCursor: parseNextCursor(connection.pageInfo, `${field}.pageInfo`),
  };
};

const parseOverviewPage = (
  payload: string,
  includeComments: boolean,
  includeReviews: boolean,
): ParsedOverviewPage => {
  let parsed: GithubReviewOverviewPayload;
  try {
    parsed = JSON.parse(payload) as GithubReviewOverviewPayload;
  } catch (cause) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub pull request review response: ${errorMessage(cause)}`,
      cause,
    });
  }
  const pullRequest = parsed.data?.repository?.pullRequest;
  if (!pullRequest) {
    throw new HostValidationError({
      field: "pullRequest",
      message:
        "Failed to parse GitHub pull request review response: expected data.repository.pullRequest.",
    });
  }
  return {
    pullRequest: {
      providerId: "github",
      number: requirePositiveNumber(pullRequest.number, "number"),
      title: requireString(pullRequest.title, "title"),
      url: requireString(pullRequest.url, "url"),
      state: normalizeReviewState(pullRequest.state, pullRequest.isDraft),
    },
    comments: parseConnection(
      pullRequest.comments,
      "pullRequest.comments",
      "comment",
      includeComments,
    ),
    reviews: parseConnection(pullRequest.reviews, "pullRequest.reviews", "review", includeReviews),
  };
};

const runOverviewGraphql = (
  input: GithubPullRequestReviewOverviewReadInput,
  variables: readonly { name: string; value: string | number | boolean }[],
) =>
  runGithubCommand(input.dependencies, input.repoPath, input.repository.host, [
    "api",
    "graphql",
    "-f",
    `query=${PULL_REQUEST_REVIEW_OVERVIEW_QUERY}`,
    ...variables.flatMap(({ name, value }) => ["-F", `${name}=${value}`]),
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
) =>
  Effect.gen(function* () {
    const comments: PullRequestReviewComment[] = [];
    const reviews: PullRequestReviewComment[] = [];
    let pullRequest: PullRequestReviewPullRequest | null = null;
    let commentsCursor: string | null = null;
    let reviewsCursor: string | null = null;
    let includeComments = true;
    let includeReviews = true;

    do {
      const variables: Array<{ name: string; value: string | number | boolean }> = [
        { name: "owner", value: input.repository.owner },
        { name: "name", value: input.repository.name },
        { name: "number", value: input.pullRequestNumber },
        { name: "includeComments", value: includeComments },
        { name: "includeReviews", value: includeReviews },
      ];
      if (commentsCursor) {
        variables.push({ name: "commentsCursor", value: commentsCursor });
      }
      if (reviewsCursor) {
        variables.push({ name: "reviewsCursor", value: reviewsCursor });
      }
      const payload = yield* runOverviewGraphql(input, variables);
      const page = yield* Effect.try({
        try: () => parseOverviewPage(payload, includeComments, includeReviews),
        catch: (cause) =>
          new HostValidationError({
            field: "github.pull_request",
            message: errorMessage(cause),
            cause,
          }),
      });
      pullRequest = page.pullRequest;
      comments.push(...page.comments.comments);
      reviews.push(...page.reviews.comments);
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
