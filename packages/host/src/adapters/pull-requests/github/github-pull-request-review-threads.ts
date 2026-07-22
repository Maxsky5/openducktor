import type { GitProviderRepository, PullRequestReviewActivity } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type GithubCommandDependencies,
  runGithubCommand,
} from "../../../application/tasks/support/github-pull-requests";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import {
  parseGithubJsonObject,
  requireGithubBoolean,
  requireGithubObject,
  requireGithubString,
  toNullableGithubObject,
  toNullableGithubString,
} from "./github-pull-request-review-payload";
import { parseGithubReviewCommentContent } from "./github-pull-request-review-suggestions";

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

const toNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

const parseNextCursor = (pageInfoValue: unknown, field: string): string | null => {
  const pageInfo = requireGithubObject(pageInfoValue, field);
  const hasNextPage = requireGithubBoolean(pageInfo.hasNextPage, `${field}.hasNextPage`);
  return hasNextPage ? requireGithubString(pageInfo.endCursor, `${field}.endCursor`) : null;
};

const toReviewThreadComment = (
  payloadValue: unknown,
  field: string,
  threadId: string,
  isResolved: boolean,
): PullRequestReviewActivity | null => {
  const payload = requireGithubObject(payloadValue, field);
  const body = typeof payload.body === "string" ? payload.body : "";
  const patch = toNullableGithubString(payload.diffHunk);
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
  const author = toNullableGithubObject(payload.author, `${field}.author`);
  return {
    id: requireGithubString(payload.id, `${field}.id`),
    author: toNullableGithubString(author?.login),
    authorAvatarUrl: toNullableGithubString(author?.avatarUrl),
    body: content.body,
    patch,
    suggestionPatches: content.suggestionPatches,
    url: toNullableGithubString(payload.url),
    createdAt: toNullableGithubString(payload.createdAt),
    updatedAt: toNullableGithubString(payload.updatedAt),
    path: toNullableGithubString(payload.path),
    line,
    threadId,
    isResolved,
    source: "review_thread",
  };
};

const parseThread = (threadValue: unknown, field: string) => {
  const thread = requireGithubObject(threadValue, field);
  const threadId = requireGithubString(thread.id, `${field}.id`);
  const isResolved = requireGithubBoolean(thread.isResolved, `${field}.isResolved`);
  const commentsConnection = requireGithubObject(thread.comments, `${field}.comments`);
  if (!Array.isArray(commentsConnection.nodes)) {
    throw new HostValidationError({
      field: `${field}.comments.nodes`,
      message: `GitHub pull request review field '${field}.comments.nodes' is missing or invalid.`,
    });
  }
  const comments: PullRequestReviewActivity[] = [];
  for (const [index, comment] of commentsConnection.nodes.entries()) {
    const normalized = toReviewThreadComment(
      comment,
      `${field}.comments.nodes.${index}`,
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
    nextCommentsCursor: parseNextCursor(commentsConnection.pageInfo, `${field}.comments.pageInfo`),
    threadId,
  };
};

const parseReviewThreadsPage = (payload: string): ParsedReviewThreadsPage => {
  const parsed = parseGithubJsonObject(payload, "pull request review threads");
  const data = requireGithubObject(parsed.data, "data");
  const repository = requireGithubObject(data.repository, "repository");
  const pullRequest = requireGithubObject(repository.pullRequest, "pullRequest");
  const reviewThreads = requireGithubObject(pullRequest.reviewThreads, "reviewThreads");
  if (!Array.isArray(reviewThreads.nodes)) {
    throw new HostValidationError({
      field: "reviewThreads.nodes",
      message:
        "Failed to parse GitHub pull request review threads response: expected data.repository.pullRequest.reviewThreads.nodes.",
    });
  }
  const comments: PullRequestReviewActivity[] = [];
  const openThreadIds: string[] = [];
  const commentPageCursors: ReviewThreadCommentsCursor[] = [];
  for (const [index, thread] of reviewThreads.nodes.entries()) {
    const parsedThread = parseThread(thread, `reviewThreads.nodes.${index}`);
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
  const parsed = parseGithubJsonObject(payload, "pull request review thread comments");
  const data = requireGithubObject(parsed.data, "data");
  const thread = parseThread(data.node, "node");
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
        catch: (cause) => {
          if (cause instanceof HostValidationError) {
            return cause;
          }
          return new HostValidationError({
            field: "github.review_threads",
            message: errorMessage(cause),
            cause,
          });
        },
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
            catch: (cause) => {
              if (cause instanceof HostValidationError) {
                return cause;
              }
              return new HostValidationError({
                field: "github.review_threads",
                message: errorMessage(cause),
                cause,
              });
            },
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
