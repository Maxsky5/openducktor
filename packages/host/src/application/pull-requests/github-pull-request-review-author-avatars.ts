import type { GitProviderRepository } from "@openducktor/contracts";
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

type GithubAuthorAvatarNodePayload = {
  id?: unknown;
  author?: { avatarUrl?: unknown } | null;
};

type GithubAuthorAvatarConnectionPayload = {
  nodes?: unknown;
  pageInfo?: GithubGraphqlPageInfoPayload | null;
};

type GithubAuthorAvatarsPayload = {
  data?: {
    repository?: {
      pullRequest?: {
        comments?: GithubAuthorAvatarConnectionPayload | null;
        reviews?: GithubAuthorAvatarConnectionPayload | null;
      } | null;
    } | null;
  } | null;
};

type GithubAuthorAvatarsReadInput = {
  dependencies: GithubCommandDependencies;
  repoPath: string;
  repository: GitProviderRepository;
  pullRequestNumber: number;
};

const AUTHOR_AVATARS_QUERY = `
query PullRequestReviewAuthorAvatars(
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
      comments(first: 100, after: $commentsCursor) @include(if: $includeComments) {
        nodes {
          id
          author {
            avatarUrl(size: 64)
          }
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
            avatarUrl(size: 64)
          }
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

const requireString = (value: unknown, field: string): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new HostValidationError({
    field,
    message: `GitHub pull request review field '${field}' is missing or invalid.`,
  });
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

const parseConnection = (
  connection: GithubAuthorAvatarConnectionPayload | null | undefined,
  field: string,
  included: boolean,
): { entries: Array<readonly [string, string]>; nextCursor: string | null } => {
  if (!included) {
    return { entries: [], nextCursor: null };
  }
  if (!connection || !Array.isArray(connection.nodes)) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}.nodes' is missing or invalid.`,
    });
  }
  const entries: Array<readonly [string, string]> = [];
  for (const entry of connection.nodes) {
    const node = entry as GithubAuthorAvatarNodePayload;
    const avatarUrl = node.author?.avatarUrl;
    if (typeof avatarUrl === "string" && avatarUrl.trim().length > 0) {
      entries.push([requireString(node.id, `${field}.nodes.id`), avatarUrl]);
    }
  }
  return {
    entries,
    nextCursor: parseNextCursor(connection.pageInfo, `${field}.pageInfo`),
  };
};

const parseAuthorAvatarsPage = (
  payload: string,
  includeComments: boolean,
  includeReviews: boolean,
) => {
  let parsed: GithubAuthorAvatarsPayload;
  try {
    parsed = JSON.parse(payload) as GithubAuthorAvatarsPayload;
  } catch (cause) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub pull request author avatars response: ${errorMessage(cause)}`,
      cause,
    });
  }
  const pullRequest = parsed.data?.repository?.pullRequest;
  if (!pullRequest) {
    throw new HostValidationError({
      field: "pullRequest",
      message:
        "Failed to parse GitHub pull request author avatars response: expected data.repository.pullRequest.",
    });
  }
  return {
    comments: parseConnection(pullRequest.comments, "pullRequest.comments", includeComments),
    reviews: parseConnection(pullRequest.reviews, "pullRequest.reviews", includeReviews),
  };
};

const runAuthorAvatarsGraphql = (
  input: GithubAuthorAvatarsReadInput,
  variables: readonly { name: string; value: string | number | boolean }[],
) =>
  runGithubCommand(input.dependencies, input.repoPath, input.repository.host, [
    "api",
    "graphql",
    "-f",
    `query=${AUTHOR_AVATARS_QUERY}`,
    ...variables.flatMap(({ name, value }) => ["-F", `${name}=${value}`]),
  ]).pipe(
    Effect.mapError(
      (cause) =>
        new HostValidationError({
          field: "github.review_author_avatars",
          message: errorMessage(cause),
          cause,
          details: { pullRequestNumber: input.pullRequestNumber },
        }),
    ),
  );

export const loadGithubReviewAuthorAvatars = (input: GithubAuthorAvatarsReadInput) =>
  Effect.gen(function* () {
    const avatarUrls = new Map<string, string>();
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
      const payload = yield* runAuthorAvatarsGraphql(input, variables);
      const page = yield* Effect.try({
        try: () => parseAuthorAvatarsPage(payload, includeComments, includeReviews),
        catch: (cause) =>
          new HostValidationError({
            field: "github.review_author_avatars",
            message: errorMessage(cause),
            cause,
          }),
      });
      for (const [id, avatarUrl] of [...page.comments.entries, ...page.reviews.entries]) {
        avatarUrls.set(id, avatarUrl);
      }
      commentsCursor = page.comments.nextCursor;
      reviewsCursor = page.reviews.nextCursor;
      includeComments = commentsCursor !== null;
      includeReviews = reviewsCursor !== null;
    } while (includeComments || includeReviews);

    return avatarUrls;
  });
