import type { PullRequestReviewActivity } from "@openducktor/contracts";
import { useCallback, useState } from "react";
import { z } from "zod";
import { useClientConnection } from "../connection/client-connection-react";
import { errorMessage } from "../lib/errors";
import type { ClientStorage } from "../platform/client-storage";
import { isBotCommentAuthor } from "./task-execution-ci-presentation";

export type PullRequestCommentAuthorFilter = "all" | "humans" | "bots";

export const PULL_REQUEST_COMMENT_FILTERS: ReadonlyArray<{
  id: PullRequestCommentAuthorFilter;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "humans", label: "Humans" },
  { id: "bots", label: "Bots" },
];

export type TaskExecutionCiCommentFilters = {
  hideResolved: boolean;
};

const CI_COMMENT_FILTERS_STORAGE_KEY = "openducktor:agent-studio:ci-comment-filters:v1";
const DEFAULT_CI_COMMENT_FILTERS: TaskExecutionCiCommentFilters = {
  hideResolved: false,
};

const ciCommentFiltersSchema = z.object({ hideResolved: z.boolean() });

const parseFilters = (raw: string | null): TaskExecutionCiCommentFilters => {
  if (raw === null) {
    return DEFAULT_CI_COMMENT_FILTERS;
  }

  const parsed = ciCommentFiltersSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error("Persisted CI comment filters are invalid.");
  }
  return parsed.data;
};

/** Reads the comment filters that this host connection keeps on the device. */
export const readTaskExecutionCiCommentFilters = (
  storage: ClientStorage,
): TaskExecutionCiCommentFilters => {
  try {
    return parseFilters(storage.getItem(CI_COMMENT_FILTERS_STORAGE_KEY));
  } catch (cause) {
    throw new Error("Failed to read persisted CI comment filters.", { cause });
  }
};

export const persistTaskExecutionCiCommentFilters = (
  storage: ClientStorage,
  filters: TaskExecutionCiCommentFilters,
): void => {
  try {
    storage.setItem(CI_COMMENT_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch (cause) {
    throw new Error("Failed to persist CI comment filters.", { cause });
  }
};

const commentTimestamp = (comment: PullRequestReviewActivity): number => {
  const timestamp = Date.parse(comment.createdAt ?? comment.updatedAt ?? "");
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
};

const withoutResolved = (
  comments: readonly PullRequestReviewActivity[],
  hideResolved: boolean,
): readonly PullRequestReviewActivity[] =>
  hideResolved ? comments.filter((comment) => comment.isResolved !== true) : comments;

/** The comments that a filter shows, newest first. */
export const filterPullRequestComments = (
  comments: readonly PullRequestReviewActivity[],
  filter: PullRequestCommentAuthorFilter,
  hideResolved: boolean,
): PullRequestReviewActivity[] => {
  const commentsByResolution = withoutResolved(comments, hideResolved);
  let commentsByAuthor = commentsByResolution;
  if (filter !== "all") {
    commentsByAuthor = commentsByResolution.filter((comment) => {
      const isBot = isBotCommentAuthor(comment.author);
      if (filter === "bots") {
        return isBot;
      }
      return !isBot;
    });
  }
  return commentsByAuthor.toSorted(
    (left, right) => commentTimestamp(right) - commentTimestamp(left),
  );
};

/** The comment count of each author filter. Resolved comments count only when they show. */
export type PullRequestCommentCounts = { all: number; humans: number; bots: number };

export const countPullRequestComments = (
  comments: readonly PullRequestReviewActivity[],
  hideResolved: boolean,
): PullRequestCommentCounts => {
  const countable = withoutResolved(comments, hideResolved);
  const bots = countable.filter((comment) => isBotCommentAuthor(comment.author)).length;
  return { all: countable.length, bots, humans: countable.length - bots };
};

export type HideResolvedCommentsChoice = {
  hideResolved: boolean;
  setHideResolved: (hideResolved: boolean) => void;
};

/**
 * The Hide resolved choice of the comment list. The connection storage keeps it for the host. A
 * failed save keeps the current choice and tells the user.
 */
export function useHideResolvedComments(): HideResolvedCommentsChoice {
  const { storage, feedback } = useClientConnection();
  const [filters, setFilters] = useState(() => readTaskExecutionCiCommentFilters(storage));
  const setHideResolved = useCallback(
    (hideResolved: boolean): void => {
      const nextFilters = { hideResolved };
      try {
        persistTaskExecutionCiCommentFilters(storage, nextFilters);
        setFilters(nextFilters);
      } catch (error) {
        feedback.show("error", "Failed to save comment filters", {
          description: errorMessage(error),
        });
      }
    },
    [feedback, storage],
  );
  return { hideResolved: filters.hideResolved, setHideResolved };
}
