import type {
  PullRequestReviewComment,
  PullRequestReviewThreadsSummary,
} from "@openducktor/contracts";
import { errorMessage, HostValidationError } from "../../effect/host-errors";

type GithubGraphqlReviewThreadCommentPayload = {
  id?: unknown;
  author?: { login?: unknown } | null;
  body?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  url?: unknown;
  path?: unknown;
  line?: unknown;
};

type GithubGraphqlReviewThreadPayload = {
  id?: unknown;
  isResolved?: unknown;
  comments?: {
    nodes?: unknown;
  } | null;
};

type GithubGraphqlReviewThreadsPayload = {
  repository?: {
    pullRequest?: {
      reviewThreads?: {
        nodes?: unknown;
      } | null;
    } | null;
  } | null;
};

type ParsedReviewThreads = {
  comments: PullRequestReviewComment[];
  summary: PullRequestReviewThreadsSummary;
};

export const REVIEW_THREADS_QUERY = `
query PullRequestReviewThreads($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 100) {
            nodes {
              id
              author {
                login
              }
              body
              url
              createdAt
              updatedAt
              path
              line
            }
          }
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

const toNullableBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

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

const toReviewThreadComment = (
  payload: GithubGraphqlReviewThreadCommentPayload,
  thread: GithubGraphqlReviewThreadPayload,
): PullRequestReviewComment | null => {
  const body = typeof payload.body === "string" ? payload.body : "";
  if (!body.trim()) {
    return null;
  }
  return {
    id: requireString(payload.id, "id"),
    author: toNullableString(payload.author?.login),
    body,
    url: toNullableString(payload.url),
    createdAt: toNullableString(payload.createdAt),
    updatedAt: toNullableString(payload.updatedAt),
    path: toNullableString(payload.path),
    line: toNullableNumber(payload.line),
    threadId: requireString(thread.id, "thread.id"),
    isResolved: toNullableBoolean(thread.isResolved),
    source: "review_thread",
  };
};

export const parseReviewThreads = (payload: string): ParsedReviewThreads => {
  const parsed = parseJson(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HostValidationError({
      field: "payload",
      message: "Failed to parse GitHub pull request review threads response: expected an object.",
    });
  }
  const reviewThreads = (parsed as GithubGraphqlReviewThreadsPayload).repository?.pullRequest
    ?.reviewThreads;
  const comments: PullRequestReviewComment[] = [];
  let openCount = 0;
  for (const thread of Array.isArray(reviewThreads?.nodes) ? reviewThreads.nodes : []) {
    const reviewThread = thread as GithubGraphqlReviewThreadPayload;
    if (toNullableBoolean(reviewThread.isResolved) === false) {
      openCount += 1;
    }

    for (const comment of Array.isArray(reviewThread.comments?.nodes)
      ? reviewThread.comments.nodes
      : []) {
      const normalized = toReviewThreadComment(
        comment as GithubGraphqlReviewThreadCommentPayload,
        reviewThread,
      );
      if (normalized) {
        comments.push(normalized);
      }
    }
  }
  return {
    comments,
    summary: {
      openCount,
    },
  };
};
