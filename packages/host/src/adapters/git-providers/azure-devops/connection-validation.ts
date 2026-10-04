import type { RepoConfig, AzureDevOpsRepository } from "@openducktor/contracts";
import { azureDevOpsCollectionUrl } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";

export const requireClientId = (clientId: string | undefined) =>
  clientId
    ? Effect.succeed(clientId)
    : Effect.fail(
        new HostValidationError({
          field: "OPENDUCKTOR_AZURE_DEVOPS_CLIENT_ID",
          message:
            "Azure DevOps Services sign-in is unavailable because the OpenDucktor Entra client ID is not configured.",
        }),
      );

export const requireConnectionTransport = (
  repoConfig: RepoConfig,
  repository: AzureDevOpsRepository,
) =>
  Effect.gen(function* () {
    const collectionUrl = azureDevOpsCollectionUrl(repository);
    const protocol = new URL(collectionUrl).protocol;
    if (repository.deployment === "services" && protocol !== "https:") {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.repository.serviceUrl",
          message: "Azure DevOps Services requires HTTPS.",
        }),
      );
    }
    if (
      repository.deployment === "server" &&
      protocol === "http:" &&
      repoConfig.git.provider?.settings?.httpConsentCollectionUrl !== collectionUrl
    ) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.settings.httpConsentCollectionUrl",
          message: `Confirm the unencrypted Azure DevOps Server connection for ${collectionUrl} before sending credentials.`,
        }),
      );
    }
  });
