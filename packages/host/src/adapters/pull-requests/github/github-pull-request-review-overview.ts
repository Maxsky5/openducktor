import type {
  GitProviderRepository,
  PullRequestReviewActivity,
  PullRequestReviewOutcome,
  PullRequestReviewPullRequest,
  PullRequestReviewState,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type GithubCommandDependencies,
  runGithubCommand,
} from "../../../application/tasks/support/github-pull-requests";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import {
  parseGithubJsonObject,
  parseGithubNextPageCursor,
  requireGithubObject,
  requireGithubString,
  toNullableGithubObject,
  toNullableGithubString,
} from "./github-pull-request-review-payload";

type GithubPullRequestReviewOverviewReadInput = {
  dependencies: GithubCommandDependencies;
  repoPath: string;
  repository: GitProviderRepository;
  pullRequestNumber: number;
};

type GithubGraphqlVariable = {
  name: string;
  value: string | number | boolean;
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

const parseComment = (payloadValue: unknown, field: string): PullRequestReviewActivity | null => {
  const payload = requireGithubObject(payloadValue, field);
  const body = typeof payload.body === "string" ? payload.body : "";
  if (!body.trim()) {
    return null;
  }
  const author = toNullableGithubObject(payload.author, `${field}.author`);
  return {
    id: requireGithubString(payload.id, `${field}.id`),
    author: toNullableGithubString(author?.login),
    authorAvatarUrl: toNullableGithubString(author?.avatarUrl),
    body,
    patch: null,
    suggestionPatches: [],
    url: toNullableGithubString(payload.url),
    createdAt: toNullableGithubString(payload.createdAt),
    updatedAt: toNullableGithubString(payload.updatedAt),
    path: null,
    line: null,
    threadId: null,
    isResolved: null,
    source: "comment",
  };
};

const parseReviewOutcome = (state: unknown, field: string): PullRequestReviewOutcome | null => {
  if (typeof state !== "string") {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review state '${field}' is missing or invalid.`,
      details: { receivedType: typeof state },
    });
  }
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
    default:
      throw new HostValidationError({
        field,
        message: `GitHub pull request review state '${field}' has unsupported value '${state}'.`,
        details: { state },
      });
  }
};

const parseReview = (payloadValue: unknown, field: string): PullRequestReviewActivity | null => {
  const payload = requireGithubObject(payloadValue, field);
  const reviewOutcome = parseReviewOutcome(payload.state, `${field}.state`);
  if (!reviewOutcome) {
    return null;
  }
  if (typeof payload.body !== "string") {
    throw new HostValidationError({
      field: `${field}.body`,
      message: `GitHub pull request review body '${field}.body' is missing or invalid.`,
      details: { receivedType: typeof payload.body },
    });
  }
  const author = toNullableGithubObject(payload.author, `${field}.author`);
  return {
    id: requireGithubString(payload.id, `${field}.id`),
    author: toNullableGithubString(author?.login),
    authorAvatarUrl: toNullableGithubString(author?.avatarUrl),
    body: payload.body,
    patch: null,
    suggestionPatches: [],
    url: toNullableGithubString(payload.url),
    createdAt:
      toNullableGithubString(payload.submittedAt) ?? toNullableGithubString(payload.createdAt),
    updatedAt: toNullableGithubString(payload.updatedAt),
    path: null,
    line: null,
    threadId: null,
    isResolved: null,
    source: "review",
    reviewOutcome,
  };
};

const parseConnection = (
  connectionValue: unknown,
  field: string,
  parseItem: (payload: unknown, field: string) => PullRequestReviewActivity | null,
  included: boolean,
): ParsedConnection => {
  if (!included) {
    return { items: [], nextCursor: null };
  }
  const connection = requireGithubObject(connectionValue, field);
  if (!Array.isArray(connection.nodes)) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}.nodes' is missing or invalid.`,
    });
  }
  const items: PullRequestReviewActivity[] = [];
  for (const [index, entry] of connection.nodes.entries()) {
    const item = parseItem(entry, `${field}.nodes.${index}`);
    if (item) {
      items.push(item);
    }
  }
  return {
    items,
    nextCursor: parseGithubNextPageCursor(connection.pageInfo, `${field}.pageInfo`),
  };
};

const parseOverviewPage = (
  payload: string,
  includeComments: boolean,
  includeReviews: boolean,
): ParsedOverviewPage => {
  const parsed = parseGithubJsonObject(payload, "pull request review");
  const data = requireGithubObject(parsed.data, "data");
  const repository = requireGithubObject(data.repository, "repository");
  const pullRequest = requireGithubObject(repository.pullRequest, "pullRequest");
  return {
    pullRequest: {
      providerId: "github",
      number: requirePositiveNumber(pullRequest.number, "number"),
      title: requireGithubString(pullRequest.title, "title"),
      url: requireGithubString(pullRequest.url, "url"),
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
): Effect.Effect<string, HostValidationError> =>
  runGithubCommand(input.dependencies, input.repoPath, input.repository.host, [
    "api",
    "graphql",
    "-f",
    `query=${PULL_REQUEST_REVIEW_OVERVIEW_QUERY}`,
    ...variables.flatMap(({ name, value }) => [
      typeof value === "string" ? "-f" : "-F",
      `${name}=${value}`,
    ]),
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
): Effect.Effect<GithubPullRequestReviewOverview, HostValidationError> =>
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
