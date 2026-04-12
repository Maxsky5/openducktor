import type { BeadsCheck, RepoStoreHealth } from "@openducktor/contracts";

const defaultRepoStoreDetail = (health: RepoStoreHealth): string => {
  switch (health.category) {
    case "initializing":
      return "Beads task store initialization is in progress.";
    case "healthy":
      return "Beads attachment and shared Dolt server are healthy.";
    case "check_call_failed":
      return "OpenDucktor could not check the Beads store health.";
    case "missing_attachment":
      return "Beads attachment is missing for this repository.";
    case "missing_shared_database":
      return "Shared Dolt database is missing and restore is required.";
    case "attachment_contract_invalid":
      return "Beads attachment metadata does not match the expected shared Dolt server contract.";
    case "attachment_verification_failed":
      return "Beads attachment verification failed.";
    case "shared_server_unavailable":
      return "Shared Dolt server is unavailable.";
  }
};

export const getRepoStoreHealth = (beadsCheck: BeadsCheck | null): RepoStoreHealth | null => {
  return beadsCheck?.repoStoreHealth ?? null;
};

export const isRepoStoreReady = (input: BeadsCheck | RepoStoreHealth | null): boolean => {
  if (!input) {
    return false;
  }

  if ("beadsOk" in input) {
    return input.repoStoreHealth.isReady;
  }

  return input.isReady;
};

export const getRepoStoreDetail = (health: RepoStoreHealth): string => {
  return health.detail ?? defaultRepoStoreDetail(health);
};

export const getRepoStoreCategoryLabel = (health: RepoStoreHealth): string => {
  switch (health.category) {
    case "initializing":
      return "Initializing";
    case "healthy":
      return "Healthy";
    case "check_call_failed":
      return "Check failed";
    case "missing_attachment":
      return "Missing attachment";
    case "missing_shared_database":
      return "Missing Dolt database";
    case "attachment_contract_invalid":
      return "Attachment contract invalid";
    case "attachment_verification_failed":
      return "Attachment verification failed";
    case "shared_server_unavailable":
      return "Dolt server unavailable";
  }
};

export const getRepoStoreStatusLabel = (health: RepoStoreHealth): string => {
  switch (health.status) {
    case "initializing":
      return "Preparing";
    case "ready":
      return "Ready";
    case "degraded":
      return "Degraded";
    case "blocking":
      return "Blocked";
    case "restore_needed":
      return "Restore needed";
  }
};

export const getRepoStoreOwnershipLabel = (health: RepoStoreHealth): string => {
  switch (health.sharedServer.ownershipState) {
    case "owned_by_current_process":
      return "Managed by this OpenDucktor window";
    case "reused_existing_server":
      return "Reusing another OpenDucktor-managed Dolt server";
    case "adopted_orphaned_server":
      return "Adopted an existing Dolt server";
    case "unavailable":
      return "Not available";
  }
};

export const buildRepoStoreUnavailableDescription = (health: RepoStoreHealth): string => {
  const detail = getRepoStoreDetail(health);

  switch (health.category) {
    case "initializing":
      return detail;
    case "check_call_failed":
      return `Beads diagnostics unavailable. ${detail}`;
    case "missing_attachment":
      return `Task store unavailable. ${detail} Open the repository again to initialize the Beads attachment.`;
    case "missing_shared_database":
      return `Task store unavailable. ${detail} Reopen the repository so OpenDucktor can restore the shared database from the attachment backup.`;
    case "attachment_contract_invalid":
      return `Task store unavailable. ${detail} The attachment metadata does not match the expected shared Dolt server.`;
    case "attachment_verification_failed":
      return `Task store unavailable. ${detail}`;
    case "shared_server_unavailable":
      return `Task store unavailable. ${detail} Check the shared Dolt server state and retry.`;
    case "healthy":
      return detail;
  }
};
