import {
  azureDevOpsRepositorySchema,
  type AzureDevOpsConnectionState,
  type AzureDevOpsDeviceCode,
  type AzureDevOpsRepository,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";

export type AzureDevOpsConnectionServiceError = HostError | WorkspaceSettingsError;

export type AzureDevOpsConnectionInput = {
  repoPath: string;
  repository: AzureDevOpsRepository;
  httpConsentCollectionUrl?: string;
};

export type AzureDevOpsConnectionService = {
  getConnection(
    input: AzureDevOpsConnectionInput,
  ): Effect.Effect<AzureDevOpsConnectionState, AzureDevOpsConnectionServiceError>;
  startSignIn(
    input: AzureDevOpsConnectionInput,
  ): Effect.Effect<AzureDevOpsDeviceCode, AzureDevOpsConnectionServiceError>;
  cancelSignIn(attemptId: string): Effect.Effect<void, AzureDevOpsConnectionServiceError>;
  replacePat(
    input: AzureDevOpsConnectionInput & { pat: string },
  ): Effect.Effect<AzureDevOpsConnectionState, AzureDevOpsConnectionServiceError>;
  disconnect(
    input: AzureDevOpsConnectionInput,
  ): Effect.Effect<void, AzureDevOpsConnectionServiceError>;
};

export const createAzureDevOpsConnectionService = ({
  connection,
  workspaceSettingsService,
}: {
  connection?: AzureDevOpsConnectionPort | undefined;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
}): AzureDevOpsConnectionService => {
  const requireConnection = () =>
    connection
      ? Effect.succeed(connection)
      : Effect.fail(
          new HostValidationError({
            field: "git.provider.connection",
            message: "Azure DevOps connection support is unavailable in this host.",
          }),
        );

  const readConfig = (input: AzureDevOpsConnectionInput, requireEnabled: boolean) =>
    Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(input.repoPath);
      const provider = repoConfig.git.provider;
      const savedRepository = azureDevOpsRepositorySchema.safeParse(provider?.repository);
      const requestedRepository = azureDevOpsRepositorySchema.safeParse(input.repository);
      if (
        provider?.id !== "azure_devops" ||
        !savedRepository.success ||
        !requestedRepository.success ||
        !sameRepository(savedRepository.data, requestedRepository.data)
      ) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "git.provider.repository",
            message:
              "Save the matching Azure DevOps repository configuration before changing its connection.",
          }),
        );
      }
      if (requireEnabled && !provider.enabled) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "git.provider.enabled",
            message: "Azure DevOps is not enabled for this repository.",
          }),
        );
      }
      return repoConfig;
    });

  return {
    getConnection(input) {
      return Effect.gen(function* () {
        const port = yield* requireConnection();
        const repoConfig = yield* readConfig(input, false);
        return yield* port.getState(repoConfig, input.repository);
      });
    },
    startSignIn(input) {
      return Effect.gen(function* () {
        const port = yield* requireConnection();
        const repoConfig = yield* readConfig(input, true);
        return yield* port.startCloudSignIn(repoConfig, input.repository);
      });
    },
    cancelSignIn(attemptId) {
      return Effect.flatMap(requireConnection(), (port) => port.cancelCloudSignIn(attemptId));
    },
    replacePat(input) {
      return Effect.gen(function* () {
        const port = yield* requireConnection();
        const repoConfig = yield* readConfig(input, true);
        yield* port.replaceServerPat(repoConfig, input.repository, input.pat);
        return yield* port.getState(repoConfig, input.repository);
      });
    },
    disconnect(input) {
      return Effect.gen(function* () {
        const port = yield* requireConnection();
        const repoConfig = yield* readConfig(input, false);
        yield* port.disconnect(repoConfig, input.repository);
      });
    },
  };
};

const sameRepository = (left: AzureDevOpsRepository, right: AzureDevOpsRepository): boolean => {
  if (left.deployment !== right.deployment || left.serviceUrl !== right.serviceUrl) {
    return false;
  }
  const leftIdentity = [left.organization, left.project, left.name];
  const rightIdentity = [right.organization, right.project, right.name];
  if (left.deployment === "services") {
    return leftIdentity.every(
      (value, index) => value.toLowerCase() === rightIdentity[index]?.toLowerCase(),
    );
  }
  return leftIdentity.every((value, index) => value === rightIdentity[index]);
};
