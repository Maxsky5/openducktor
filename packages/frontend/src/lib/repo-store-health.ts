import type { RepoStoreHealth, TaskStoreCheck } from "@openducktor/contracts";

const defaultRepoStoreDetail = (health: RepoStoreHealth): string => {
  switch (health.category) {
    case "healthy":
      return "SQLite task store is ready.";
    case "check_call_failed":
      return "OpenDucktor could not check the task store health.";
    case "database_unavailable":
      return "SQLite task store database is unavailable.";
  }
};

export const getRepoStoreHealth = (
  taskStoreCheck: TaskStoreCheck | null,
): RepoStoreHealth | null => {
  return taskStoreCheck?.repoStoreHealth ?? null;
};

export const isRepoStoreReady = (input: TaskStoreCheck | RepoStoreHealth | null): boolean => {
  if (!input) {
    return false;
  }

  if ("taskStoreOk" in input) {
    return input.repoStoreHealth.isReady;
  }

  return input.isReady;
};

export const getRepoStoreDetail = (health: RepoStoreHealth): string => {
  return health.detail ?? defaultRepoStoreDetail(health);
};

export const getRepoStoreCategoryLabel = (health: RepoStoreHealth): string => {
  switch (health.category) {
    case "healthy":
      return "Healthy";
    case "check_call_failed":
      return "Check failed";
    case "database_unavailable":
      return "Database unavailable";
  }
};

export const getRepoStoreStatusLabel = (health: RepoStoreHealth): string => {
  switch (health.status) {
    case "ready":
      return "Ready";
    case "degraded":
      return "Degraded";
    case "blocking":
      return "Blocked";
  }
};

export const buildRepoStoreUnavailableDescription = (health: RepoStoreHealth): string => {
  const detail = getRepoStoreDetail(health);

  switch (health.category) {
    case "check_call_failed":
      return `Task store diagnostics unavailable. ${detail}`;
    case "database_unavailable":
      return `Task store unavailable. ${detail}`;
    case "healthy":
      return detail;
  }
};
