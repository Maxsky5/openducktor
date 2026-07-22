import type { GitProviderRepository, PullRequestReviewActivity } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type GithubCommandDependencies,
  runGithubCommand,
} from "../../../application/tasks/support/github-pull-requests";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import { parseGithubReviewCommentContent } from "./github-pull-request-review-suggestions";

type GithubGraphqlPageInfoPayload = {
  hasNextPage?: unknown;
  endCursor?: unknown;
};

type GithubGraphqlReviewThreadCommentPayload = {
  id?: unknown;
  author?: { login?: unknown; avatarUrl?: unknown } | null;
  body?: unknown;
  diffHunk?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  url?: unknown;
  path?: unknown;
  line?: unknown;
  startLine?: unknown;
  originalLine?: unknown;
  originalStartLine?: unknown;
};

type GithubGraphqlReviewThreadPayload = {
  id?: unknown;
  isResolved?: unknown;
  comments?: {
    nodes?: unknown;
    pageInfo?: GithubGraphqlPageInfoPayload | null;
  } | null;
};

type GithubGraphqlReviewThreadsPayload = {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: unknown;
          pageInfo?: GithubGraphqlPageInfoPayload | null;
        } | null;
      } | null;
    } | null;
  } | null;
};

type GithubGraphqlReviewThreadCommentsPayload = {
  data?: {
    node?: GithubGraphqlReviewThreadPayload | null;
  } | null;
};

export type ReviewThreadCommentsCursor = {
  threadId: string;
  cursor: string;
};

export type ParsedReviewThreadsPage = {
  comments: PullRequestReviewActivity[];
  openThreadIds: string[];
  nextThreadsCursor: string | null;
  commentPageCursors: ReviewThreadCommentsCursor[];
};

export type ParsedReviewThreadCommentsPage = {
  comments: PullRequestReviewActivity[];
  nextCommentsCursor: string | null;
  threadId: string;
};

const REVIEW_THREAD_COMMENT_FIELDS = `
  id
  author {
    login
    avatarUrl(size: 64)
  }
  body
  diffHunk
  url
  createdAt
  updatedAt
  path
  line
  startLine
  originalLine
  originalStartLine
`;

const REVIEW_THREADS_QUERY = `
query PullRequestReviewThreads(
  $owner: String!
  $name: String!
  $number: Int!
  $threadsCursor: String
) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $threadsCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isResolved
          comments(first: 100) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              ${REVIEW_THREAD_COMMENT_FIELDS}
            }
          }
        }
      }
    }
  }
}
`;

const REVIEW_THREAD_COMMENTS_QUERY = `
query PullRequestReviewThreadComments($threadId: ID!, $commentsCursor: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      id
      isResolved
      comments(first: 100, after: $commentsCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ${REVIEW_THREAD_COMMENT_FIELDS}
        }
      }
    }
  }
}
`;

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

const requireBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing or invalid.`,
    });
  }
  return value;
};

const parseJson = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch (cause) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub pull request review threads response: ${errorMessage(cause)}`,
      cause,
    });
  }
};

const parseNextCursor = (
  pageInfo: GithubGraphqlPageInfoPayload | null | undefined,
  field: string,
): string | null => {
  if (!pageInfo) {
    throw new HostValidationError({
      field,
      message: `GitHub pull request review field '${field}' is missing or invalid.`,
    });
  }
  const hasNextPage = requireBoolean(pageInfo.hasNextPage, `${field}.hasNextPage`);
  return hasNextPage ? requireString(pageInfo.endCursor, `${field}.endCursor`) : null;
};

const toReviewThreadComment = (
  payload: GithubGraphqlReviewThreadCommentPayload,
  threadId: string,
  isResolved: boolean,
): PullRequestReviewActivity | null => {
  const body = typeof payload.body === "string" ? payload.body : "";
  const patch = toNullableString(payload.diffHunk);
  const line = toNullableNumber(payload.line) ?? toNullableNumber(payload.originalLine);
  const startLine =
    toNullableNumber(payload.startLine) ?? toNullableNumber(payload.originalStartLine) ?? line;
  const content = parseGithubReviewCommentContent({
    body,
    diffHunk: patch,
    startLine,
    endLine: line,
  });
  if (!content.body && content.suggestionPatches.length === 0) {
    return null;
  }
  return {
    id: requireString(payload.id, "id"),
    author: toNullableString(payload.author?.login),
    authorAvatarUrl: toNullableString(payload.author?.avatarUrl),
    body: content.body,
    patch,
    suggestionPatches: content.suggestionPatches,
    url: toNullableString(payload.url),
    createdAt: toNullableString(payload.createdAt),
    updatedAt: toNullableString(payload.updatedAt),
    path: toNullableString(payload.path),
    line,
    threadId,
    isResolved,
    source: "review_thread",
  };
};

const parseThread = (thread: GithubGraphqlReviewThreadPayload) => {
  const threadId = requireString(thread.id, "thread.id");
  const isResolved = requireBoolean(thread.isResolved, "thread.isResolved");
  if (!Array.isArray(thread.comments?.nodes)) {
    throw new HostValidationError({
      field: "thread.comments.nodes",
      message: "GitHub pull request review field 'thread.comments.nodes' is missing or invalid.",
    });
  }
  const comments: PullRequestReviewActivity[] = [];
  for (const comment of thread.comments.nodes) {
    const normalized = toReviewThreadComment(
      comment as GithubGraphqlReviewThreadCommentPayload,
      threadId,
      isResolved,
    );
    if (normalized) {
      comments.push(normalized);
    }
  }
  return {
    comments,
    isResolved,
    nextCommentsCursor: parseNextCursor(thread.comments.pageInfo, "thread.comments.pageInfo"),
    threadId,
  };
};

const requireObjectPayload = (payload: string): Record<string, unknown> => {
  const parsed = parseJson(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HostValidationError({
      field: "payload",
      message: "Failed to parse GitHub pull request review threads response: expected an object.",
    });
  }
  return parsed as Record<string, unknown>;
};

const parseReviewThreadsPage = (payload: string): ParsedReviewThreadsPage => {
  const parsed = requireObjectPayload(payload) as GithubGraphqlReviewThreadsPayload;
  const reviewThreads = parsed.data?.repository?.pullRequest?.reviewThreads;
  if (!Array.isArray(reviewThreads?.nodes)) {
    throw new HostValidationError({
      field: "reviewThreads.nodes",
      message:
        "Failed to parse GitHub pull request review threads response: expected data.repository.pullRequest.reviewThreads.nodes.",
    });
  }
  const comments: PullRequestReviewActivity[] = [];
  const openThreadIds: string[] = [];
  const commentPageCursors: ReviewThreadCommentsCursor[] = [];
  for (const thread of reviewThreads.nodes) {
    const parsedThread = parseThread(thread as GithubGraphqlReviewThreadPayload);
    comments.push(...parsedThread.comments);
    if (!parsedThread.isResolved) {
      openThreadIds.push(parsedThread.threadId);
    }
    if (parsedThread.nextCommentsCursor) {
      commentPageCursors.push({
        threadId: parsedThread.threadId,
        cursor: parsedThread.nextCommentsCursor,
      });
    }
  }
  return {
    comments,
    openThreadIds,
    nextThreadsCursor: parseNextCursor(reviewThreads.pageInfo, "reviewThreads.pageInfo"),
    commentPageCursors,
  };
};

const parseReviewThreadCommentsPage = (payload: string): ParsedReviewThreadCommentsPage => {
  const parsed = requireObjectPayload(payload) as GithubGraphqlReviewThreadCommentsPayload;
  if (!parsed.data?.node) {
    throw new HostValidationError({
      field: "node",
      message:
        "Failed to parse GitHub pull request review thread comments response: expected data.node.",
    });
  }
  const thread = parseThread(parsed.data.node);
  return {
    comments: thread.comments,
    nextCommentsCursor: thread.nextCommentsCursor,
    threadId: thread.threadId,
  };
};

type GithubReviewThreadsReadInput = {
  dependencies: GithubCommandDependencies;
  repoPath: string;
  repository: GitProviderRepository;
  pullRequestNumber: number;
};

const runReviewGraphql = (
  input: GithubReviewThreadsReadInput,
  query: string,
  variables: readonly { name: string; value: string | number }[],
) =>
  runGithubCommand(input.dependencies, input.repoPath, input.repository.host, [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    ...variables.flatMap(({ name, value }) => ["-F", `${name}=${value}`]),
  ]).pipe(
    Effect.mapError(
      (cause) =>
        new HostValidationError({
          field: "github.review_threads",
          message: errorMessage(cause),
          cause,
          details: { pullRequestNumber: input.pullRequestNumber },
        }),
    ),
  );

export const loadGithubReviewThreads = (input: GithubReviewThreadsReadInput) =>
  Effect.gen(function* () {
    const comments: PullRequestReviewActivity[] = [];
    const openThreadIds = new Set<string>();
    let threadsCursor: string | null = null;

    do {
      const variables: { name: string; value: string | number }[] = [
        { name: "owner", value: input.repository.owner },
        { name: "name", value: input.repository.name },
        { name: "number", value: input.pullRequestNumber },
      ];
      if (threadsCursor) {
        variables.push({ name: "threadsCursor", value: threadsCursor });
      }
      const payload = yield* runReviewGraphql(input, REVIEW_THREADS_QUERY, variables);
      const page = yield* Effect.try({
        try: () => parseReviewThreadsPage(payload),
        catch: (cause) =>
          new HostValidationError({
            field: "github.review_threads",
            message: errorMessage(cause),
            cause,
          }),
      });
      comments.push(...page.comments);
      for (const threadId of page.openThreadIds) {
        openThreadIds.add(threadId);
      }

      for (const commentPage of page.commentPageCursors) {
        let commentsCursor: string | null = commentPage.cursor;
        while (commentsCursor) {
          const commentsPayload: string = yield* runReviewGraphql(
            input,
            REVIEW_THREAD_COMMENTS_QUERY,
            [
              { name: "threadId", value: commentPage.threadId },
              { name: "commentsCursor", value: commentsCursor },
            ],
          );
          const parsedCommentsPage: ParsedReviewThreadCommentsPage = yield* Effect.try({
            try: () => parseReviewThreadCommentsPage(commentsPayload),
            catch: (cause) =>
              new HostValidationError({
                field: "github.review_threads",
                message: errorMessage(cause),
                cause,
              }),
          });
          if (parsedCommentsPage.threadId !== commentPage.threadId) {
            return yield* Effect.fail(
              new HostValidationError({
                field: "github.review_threads.threadId",
                message: `GitHub returned comments for unexpected review thread '${parsedCommentsPage.threadId}'.`,
              }),
            );
          }
          comments.push(...parsedCommentsPage.comments);
          commentsCursor = parsedCommentsPage.nextCommentsCursor;
        }
      }

      threadsCursor = page.nextThreadsCursor;
    } while (threadsCursor);

    return {
      comments,
      summary: { openCount: openThreadIds.size },
    };
  });
