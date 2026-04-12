import type { BeadsCheck, RepoStoreHealth } from "@openducktor/contracts";
import { errorMessage } from "@/lib/errors";
import { buildRepoStoreUnavailableDescription } from "@/lib/repo-store-health";

const TASK_STORE_HINT =
  "OpenDucktor uses centralized Beads at ~/.openducktor/beads/<repo-id>/.beads. Initialization is automatic on repo open; retry if this is the first load.";

export type TaskLoadFailureContext = {
  error: unknown;
  repoStoreHealth?: RepoStoreHealth | null;
};

export const getBlockingRepoStoreHealth = (
  input: BeadsCheck | RepoStoreHealth | null,
): RepoStoreHealth | null => {
  if (!input) {
    return null;
  }

  if ("beadsOk" in input) {
    return input.repoStoreHealth.isReady || input.repoStoreHealth.status === "initializing"
      ? null
      : input.repoStoreHealth;
  }

  return input.isReady || input.status === "initializing" ? null : input;
};

export const summarizeTaskLoadError = ({
  error,
  repoStoreHealth = null,
}: TaskLoadFailureContext): string => {
  if (repoStoreHealth) {
    return buildRepoStoreUnavailableDescription(repoStoreHealth);
  }

  const message = (errorMessage(error).split("\n").at(0) ?? "Unknown error").trim();
  const beadsFailure = /beads|beads_dir|\bbd\b|task store/i.test(message);
  if (beadsFailure) {
    return `Task store unavailable. ${message} ${TASK_STORE_HINT}`;
  }

  return `Task store unavailable. ${message}`;
};
