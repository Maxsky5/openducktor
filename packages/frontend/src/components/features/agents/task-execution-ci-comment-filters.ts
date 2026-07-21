export type TaskExecutionCiCommentFilters = {
  hideResolved: boolean;
};

const CI_COMMENT_FILTERS_STORAGE_KEY = "openducktor:agent-studio:ci-comment-filters:v1";
const DEFAULT_CI_COMMENT_FILTERS: TaskExecutionCiCommentFilters = {
  hideResolved: false,
};

const parseFilters = (raw: string | null): TaskExecutionCiCommentFilters => {
  if (raw === null) {
    return DEFAULT_CI_COMMENT_FILTERS;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Persisted CI comment filters are invalid.");
  }

  const hideResolved = (parsed as { hideResolved?: unknown }).hideResolved;
  if (typeof hideResolved !== "boolean") {
    throw new Error("Persisted CI comment filters are invalid.");
  }
  return { hideResolved };
};

export const readTaskExecutionCiCommentFilters = (): TaskExecutionCiCommentFilters => {
  if (typeof globalThis.localStorage === "undefined") {
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
  if (typeof globalThis.localStorage === "undefined") {
    return;
  }

  try {
    globalThis.localStorage.setItem(CI_COMMENT_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch (cause) {
    throw new Error("Failed to persist CI comment filters.", { cause });
  }
};
