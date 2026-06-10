import type { RepoStoreHealth, TaskStoreCheck } from "@openducktor/contracts";
import { errorMessage } from "@/lib/errors";
import { buildRepoStoreUnavailableDescription } from "@/lib/repo-store-health";

const TASK_STORE_HINT =
  "OpenDucktor stores tasks in ~/.openducktor/task-stores/<workspaceId>/database.sqlite. Initialization is automatic on repo open; retry if this is the first load.";

export type TaskLoadFailureContext = {
  error: unknown;
  repoStoreHealth?: RepoStoreHealth | null;
};

export const getBlockingRepoStoreHealth = (
  input: TaskStoreCheck | RepoStoreHealth | null,
): RepoStoreHealth | null => {
  if (!input) {
    return null;
  }

  if ("taskStoreOk" in input) {
    return input.repoStoreHealth.isReady ? null : input.repoStoreHealth;
  }

  return input.isReady ? null : input;
};

export const summarizeTaskLoadError = ({
  error,
  repoStoreHealth = null,
}: TaskLoadFailureContext): string => {
  const message = (errorMessage(error).split("\n").at(0) ?? "Unknown error").trim();
  const taskStoreFailure = /sqlite|database\.sqlite|task store|repo store/i.test(message);

  if (repoStoreHealth && taskStoreFailure) {
    return buildRepoStoreUnavailableDescription(repoStoreHealth);
  }

  if (taskStoreFailure) {
    return `Task store unavailable. ${message} ${TASK_STORE_HINT}`;
  }

  return message;
};
