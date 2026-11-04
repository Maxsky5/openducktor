import type { GitProviderHealth, GitProviderId } from "@openducktor/contracts";

/** The health of a REST provider that is not available, with the reason to show. */
export const unavailableProviderHealth = (
  providerId: GitProviderId,
  reason: string,
  {
    enabled = true,
    authenticated = false,
    account = null,
    repositoryMappingValid = null,
  }: {
    enabled?: boolean;
    authenticated?: boolean;
    account?: string | null;
    repositoryMappingValid?: boolean | null;
  } = {},
): GitProviderHealth => ({
  providerId,
  enabled,
  available: false,
  reason,
  executablePath: null,
  version: null,
  authenticated,
  account,
  repositoryMappingValid,
});
