export type TaskExecutionCiCommentFilters = {
  hideResolved: boolean;
};

const CI_COMMENT_FILTERS_STORAGE_KEY = "openducktor:agent-studio:ci-comment-filters:v1";
const DEFAULT_CI_COMMENT_FILTERS: TaskExecutionCiCommentFilters = {
  hideResolved: false,
};

let cachedFilters:
  | {
      filters: TaskExecutionCiCommentFilters;
      storage: Storage;
    }
  | undefined;

const parseFilters = (raw: string | null): TaskExecutionCiCommentFilters => {
  if (!raw) {
    return DEFAULT_CI_COMMENT_FILTERS;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    return DEFAULT_CI_COMMENT_FILTERS;
  }

  const hideResolved = (parsed as { hideResolved?: unknown }).hideResolved;
  return typeof hideResolved === "boolean" ? { hideResolved } : DEFAULT_CI_COMMENT_FILTERS;
};

export const readTaskExecutionCiCommentFilters = (): TaskExecutionCiCommentFilters => {
  if (typeof globalThis.localStorage === "undefined") {
    return DEFAULT_CI_COMMENT_FILTERS;
  }

  const storage = globalThis.localStorage;
  if (cachedFilters?.storage === storage) {
    return cachedFilters.filters;
  }

  try {
    const filters = parseFilters(storage.getItem(CI_COMMENT_FILTERS_STORAGE_KEY));
    cachedFilters = { filters, storage };
    return filters;
  } catch (error) {
    console.error("[agent-studio-ci-comments] Failed to read persisted filters.", { error });
    cachedFilters = { filters: DEFAULT_CI_COMMENT_FILTERS, storage };
    return DEFAULT_CI_COMMENT_FILTERS;
  }
};

export const persistTaskExecutionCiCommentFilters = (
  filters: TaskExecutionCiCommentFilters,
): void => {
  if (typeof globalThis.localStorage === "undefined") {
    return;
  }

  const storage = globalThis.localStorage;
  try {
    storage.setItem(CI_COMMENT_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    cachedFilters = { filters, storage };
  } catch (error) {
    console.error("[agent-studio-ci-comments] Failed to persist filters.", { error });
  }
};
