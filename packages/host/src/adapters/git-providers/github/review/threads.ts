import type { GitProviderRepository, PullRequestReviewActivity } from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, HostValidationError } from "../../../../effect/host-errors";
import { runGithubApi, type GithubCli } from "../cli";
import { parseGithubJson } from "./payload";
import { type GithubReviewCommentLineRange, parseGithubReviewCommentContent } from "./suggestions";

export type ReviewThreadCommentsCursor = {
  threadId: string;
  cursor: string;
};

export type ParsedReviewThreadsPage = {
  comments: PullRequestReviewActivity[];
  openThreadIds: string[];
  nextThreadsCursor: string | null;
  commentPageCursors: ReviewThreadCommentsCursor[];
  reviewIdsWithComments: string[];
};

export type ParsedReviewThreadCommentsPage = {
  comments: PullRequestReviewActivity[];
  nextCommentsCursor: string | null;
  reviewIdsWithComments: string[];
  threadId: string;
};

type ParsedReviewThreadComment = {
  activity: PullRequestReviewActivity;
  reviewId: string | null;
};

const REVIEW_THREAD_COMMENT_FIELDS = `
  id
  author {
    login
    avatarUrl(size: 64)
  }
  body
  pullRequestReview {
    id
  }
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

const optionalTextSchema = z.string().nullable().optional();
const optionalLineSchema = z.number().int().positive().nullable().optional();
const actorSchema = z
  .object({
    login: optionalTextSchema,
    avatarUrl: optionalTextSchema,
  })
  .nullable()
  .optional();
const pullRequestReviewSchema = z
  .object({ id: z.string().min(1) })
  .nullable()
  .optional();
const reviewThreadCommentSchema = z.object({
  id: z.string().min(1),
  author: actorSchema,
  body: z.string(),
  pullRequestReview: pullRequestReviewSchema,
  diffHunk: optionalTextSchema,
  url: optionalTextSchema,
  createdAt: optionalTextSchema,
  updatedAt: optionalTextSchema,
  path: optionalTextSchema,
  line: optionalLineSchema,
  startLine: optionalLineSchema,
  originalLine: optionalLineSchema,
  originalStartLine: optionalLineSchema,
});
const pageInfoSchema = z.discriminatedUnion("hasNextPage", [
  z.object({ hasNextPage: z.literal(true), endCursor: z.string().min(1) }),
  z.object({ hasNextPage: z.literal(false), endCursor: z.string().nullable() }),
]);
const reviewThreadSchema = z.object({
  id: z.string().min(1),
  isResolved: z.boolean(),
  comments: z.object({
    pageInfo: pageInfoSchema,
    nodes: z.array(reviewThreadCommentSchema),
  }),
});
const reviewThreadsResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          pageInfo: pageInfoSchema,
          nodes: z.array(reviewThreadSchema),
        }),
      }),
    }),
  }),
});
const reviewThreadCommentsResponseSchema = z.object({
  data: z.object({ node: reviewThreadSchema }),
});

type GithubReviewThread = z.output<typeof reviewThreadSchema>;
type GithubReviewThreadComment = z.output<typeof reviewThreadCommentSchema>;

const toNullableText = (value: string | null | undefined): string | null =>
  value && value.trim().length > 0 ? value : null;

const nextPageCursor = (pageInfo: z.output<typeof pageInfoSchema>): string | null =>
  pageInfo.hasNextPage ? pageInfo.endCursor : null;

const toLineRange = (
  startLine: number | null,
  endLine: number | null,
): GithubReviewCommentLineRange | null =>
  endLine === null ? null : { startLine: startLine ?? endLine, endLine };

const toReviewThreadComment = (
  comment: GithubReviewThreadComment,
  threadId: string,
  isResolved: boolean,
): ParsedReviewThreadComment | null => {
  const patch = toNullableText(comment.diffHunk);
  const currentLine = comment.line ?? null;
  const originalLine = comment.originalLine ?? null;
  const line = currentLine ?? originalLine;
  const lineRanges = [
    toLineRange(comment.originalStartLine ?? null, originalLine),
    toLineRange(comment.startLine ?? null, currentLine),
  ].filter((lineRange): lineRange is GithubReviewCommentLineRange => lineRange !== null);
  const content = parseGithubReviewCommentContent({
    body: comment.body,
    diffHunk: patch,
    lineRanges,
  });
  if (!content.body && content.suggestionPatches.length === 0) {
    return null;
  }
  return {
    activity: {
      id: comment.id,
      author: toNullableText(comment.author?.login),
      authorAvatarUrl: toNullableText(comment.author?.avatarUrl),
      body: content.body,
      patch,
      suggestionPatches: content.suggestionPatches,
      suggestionWarning: content.suggestionWarning,
      url: toNullableText(comment.url),
      createdAt: toNullableText(comment.createdAt),
      updatedAt: toNullableText(comment.updatedAt),
      path: toNullableText(comment.path),
      line,
      threadId,
      isResolved,
      source: "review_thread",
    },
    reviewId: comment.pullRequestReview?.id ?? null,
  };
};

const parseThread = (thread: GithubReviewThread) => {
  const comments: PullRequestReviewActivity[] = [];
  const reviewIdsWithComments: string[] = [];
  for (const comment of thread.comments.nodes) {
    const normalized = toReviewThreadComment(comment, thread.id, thread.isResolved);
    if (normalized) {
      comments.push(normalized.activity);
      if (normalized.reviewId) {
        reviewIdsWithComments.push(normalized.reviewId);
      }
    }
  }
  return {
    comments,
    isResolved: thread.isResolved,
    nextCommentsCursor: nextPageCursor(thread.comments.pageInfo),
    reviewIdsWithComments,
    threadId: thread.id,
  };
};

const parseReviewThreadsPage = (payload: string): ParsedReviewThreadsPage => {
  const response = parseGithubJson(
    payload,
    "pull request review threads",
    reviewThreadsResponseSchema,
  );
  const { reviewThreads } = response.data.repository.pullRequest;
  const comments: PullRequestReviewActivity[] = [];
  const openThreadIds: string[] = [];
  const commentPageCursors: ReviewThreadCommentsCursor[] = [];
  const reviewIdsWithComments: string[] = [];
  for (const thread of reviewThreads.nodes) {
    const parsedThread = parseThread(thread);
    comments.push(...parsedThread.comments);
    reviewIdsWithComments.push(...parsedThread.reviewIdsWithComments);
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
    nextThreadsCursor: nextPageCursor(reviewThreads.pageInfo),
    commentPageCursors,
    reviewIdsWithComments,
  };
};

const parseReviewThreadCommentsPage = (payload: string): ParsedReviewThreadCommentsPage => {
  const response = parseGithubJson(
    payload,
    "pull request review thread comments",
    reviewThreadCommentsResponseSchema,
  );
  const thread = parseThread(response.data.node);
  return {
    comments: thread.comments,
    nextCommentsCursor: thread.nextCommentsCursor,
    reviewIdsWithComments: thread.reviewIdsWithComments,
    threadId: thread.threadId,
  };
};

type GithubReviewThreadsReadInput = {
  githubCli: GithubCli;
  repoPath: string;
  repository: GitProviderRepository;
  pullRequestNumber: number;
};

const runReviewGraphql = (
  input: GithubReviewThreadsReadInput,
  query: string,
  variables: readonly { name: string; value: string | number }[],
) =>
  runGithubApi(input.githubCli, input.repoPath, input.repository.host, [
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
    const reviewIdsWithComments = new Set<string>();
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
      for (const reviewId of page.reviewIdsWithComments) {
        reviewIdsWithComments.add(reviewId);
      }
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
          for (const reviewId of parsedCommentsPage.reviewIdsWithComments) {
            reviewIdsWithComments.add(reviewId);
          }
          commentsCursor = parsedCommentsPage.nextCommentsCursor;
        }
      }

      threadsCursor = page.nextThreadsCursor;
    } while (threadsCursor);

    return {
      comments,
      reviewIdsWithComments,
      summary: { openCount: openThreadIds.size },
    };
  });
