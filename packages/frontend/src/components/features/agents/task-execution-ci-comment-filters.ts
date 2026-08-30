import { z } from "zod";

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

export const readTaskExecutionCiCommentFilters = (): TaskExecutionCiCommentFilters => {
  if (globalThis.localStorage === undefined) {
    return DEFAULT_CI_COMMENT_FILTERS;
  }

  try {
    return parseFilters(globalThis.localStorage.getItem(CI_COMMENT_FILTERS_STORAGE_KEY));
  } catch (cause) {
    throw new Error("Failed to read persisted CI comment filters.", { cause });
  }
};

export const persistTaskExecutionCiCommentFilters = (
  filters: TaskExecutionCiCommentFilters,
): void => {
  if (globalThis.localStorage === undefined) {
    return;
  }

  try {
    globalThis.localStorage.setItem(CI_COMMENT_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch (cause) {
    throw new Error("Failed to persist CI comment filters.", { cause });
  }
};
