import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  type AzureDevOpsRepository,
  type GitProviderHealth,
  type RepoConfig,
} from "@openducktor/contracts";
import { isAzureDevOpsRepository } from "@openducktor/core";
import { Effect } from "effect";
import { errorMessage } from "../../../effect/host-errors";
import type { AzureDevOpsConnectionPort } from "../../../ports/azure-devops-connection-port";
import type {
  GitProviderHealthPort,
  GitProviderRepositoryPort,
} from "../../../ports/git-provider-port";
import { parseAzureRepository } from "./models";
import type { AzureDevOpsRestClient } from "./rest-client";

const PROVIDER_ID = AZURE_DEVOPS_PROVIDER_DESCRIPTOR.id;

export const createAzureDevOpsHealthPort = ({
  client,
  connection,
  repositoryPort,
}: {
  client: AzureDevOpsRestClient;
  connection: AzureDevOpsConnectionPort;
  repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository>;
}): GitProviderHealthPort => ({
  getStatus(repoConfig: RepoConfig) {
    return Effect.gen(function* () {
      const provider = repoConfig.git.provider;
      if (provider?.id !== PROVIDER_ID || !provider.enabled) {
        return unhealthy("Azure DevOps is not enabled for this repository.", false);
      }
      if (!provider.repository || !isAzureDevOpsRepository(provider.repository)) {
        return unhealthy(
          "Complete the Azure DevOps service address, organization or collection, project, and repository.",
        );
      }
      const repository = provider.repository;
      const stateResult = yield* Effect.either(connection.getState(repoConfig, repository));
      if (stateResult._tag === "Left") {
        return unhealthy(errorMessage(stateResult.left));
      }
      const state = stateResult.right;
      if (state.status === "disconnected") {
        return unhealthy(
          repository.deployment === "services"
            ? "Sign in with a work or school account, or add a personal access token for this Azure DevOps organization."
            : "Add an Azure DevOps Server personal access token.",
        );
      }
      if (state.status === "pending") {
        return unhealthy(`Finish Microsoft Entra sign-in at ${state.deviceCode.verificationUri}.`);
      }
      if (state.status === "error") {
        return unhealthy(state.reason);
      }
      const resolved = yield* Effect.either(
        client.request(repoConfig, repository, {
          operation: "check repository access",
          path: `git/repositories/${encodeURIComponent(repository.name)}`,
        }),
      );
      if (resolved._tag === "Left") {
        const reason = errorMessage(resolved.left);
        const credentialRejected =
          resolved.left._tag === "HostOperationError" &&
          resolved.left.details !== undefined &&
          "status" in resolved.left.details &&
          resolved.left.details.status === 401;
        return unhealthy(reason, true, !credentialRejected, state.account);
      }
      const parsedRepository = yield* Effect.either(
        Effect.try({
          try: () => parseAzureRepository(resolved.right.body, repository),
          catch: (cause) => cause,
        }),
      );
      if (parsedRepository._tag === "Left") {
        return unhealthy(errorMessage(parsedRepository.left), true, true, state.account);
      }
      const mapping = yield* Effect.either(repositoryPort.getMapping(repoConfig));
      if (mapping._tag === "Left") {
        return unhealthy(errorMessage(mapping.left), true, true, state.account, false);
      }
      return {
        providerId: PROVIDER_ID,
        enabled: true,
        available: true,
        executablePath: null,
        version: null,
        authenticated: true,
        account: state.account,
        repositoryMappingValid: true,
      } satisfies GitProviderHealth;
    });
  },
});

const unhealthy = (
  reason: string,
  enabled = true,
  authenticated = false,
  account: string | null = null,
  repositoryMappingValid: boolean | null = null,
): GitProviderHealth => ({
  providerId: PROVIDER_ID,
  enabled,
  available: false,
  reason,
  executablePath: null,
  version: null,
  authenticated,
  account,
  repositoryMappingValid,
});
