import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderHealth,
  type GithubGitProviderRepository,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../../effect/host-errors";
import type {
  GitProviderHealthPort,
  GitProviderRepositoryPort,
} from "../../../ports/git-provider-port";
import type { GithubCli } from "./cli";

const GITHUB_PROVIDER_ID = GITHUB_PROVIDER_DESCRIPTOR.id;

export const createGithubProviderHealthPort = ({
  githubCli,
  repositoryPort,
}: {
  githubCli: GithubCli;
  repositoryPort: GitProviderRepositoryPort<GithubGitProviderRepository>;
}): GitProviderHealthPort => ({
  getStatus: (repoConfig: RepoConfig) =>
    Effect.gen(function* () {
      const provider = repoConfig.git.provider;
      if (provider?.id !== GITHUB_PROVIDER_ID || !provider.enabled) {
        return unhealthy({
          enabled: false,
          reason: "GitHub provider is not enabled for this repository.",
        });
      }

      const commandResult = yield* Effect.result(githubCli.resolve());
      if (commandResult._tag === "Failure") {
        return unhealthy({ reason: errorMessage(commandResult.failure) });
      }
      const command = commandResult.success;
      const versionResult = yield* Effect.result(command.readVersion({ cwd: repoConfig.repoPath }));
      if (versionResult._tag === "Failure" || versionResult.success === null) {
        const reason =
          versionResult._tag === "Failure"
            ? `Failed to read GitHub CLI version: ${errorMessage(versionResult.failure)}`
            : "Failed to read GitHub CLI version.";
        return unhealthy({ executablePath: command.executablePath, reason });
      }
      const version = versionResult.success;
      if (!provider.repository) {
        return unhealthy({
          executablePath: command.executablePath,
          version,
          reason: "GitHub repository coordinates are missing.",
        });
      }
      const repositoryResult = yield* Effect.result(repositoryPort.getRepository(repoConfig));
      if (repositoryResult._tag === "Failure") {
        return unhealthy({
          executablePath: command.executablePath,
          version,
          repositoryMappingValid: false,
          reason: errorMessage(repositoryResult.failure),
        });
      }
      const authResult = yield* Effect.result(command.getAuth(repositoryResult.success.host));
      if (authResult._tag === "Failure") {
        return unhealthy({
          executablePath: command.executablePath,
          version,
          reason: `Failed to check GitHub authentication: ${errorMessage(authResult.failure)}`,
        });
      }
      if (!authResult.success.authenticated) {
        return unhealthy({
          executablePath: command.executablePath,
          version,
          reason:
            authResult.success.reason ??
            "GitHub authentication is not configured. Run `gh auth login`.",
        });
      }
      const account = authResult.success.account;
      const mappingResult = yield* Effect.result(repositoryPort.getMapping(repoConfig));
      if (mappingResult._tag === "Failure") {
        const mappingError = mappingResult.failure;
        if (mappingError._tag !== "GitProviderRepositoryError") {
          return yield* Effect.fail(mappingError);
        }
        return unhealthy({
          executablePath: command.executablePath,
          version,
          authenticated: true,
          account,
          repositoryMappingValid: false,
          reason: mappingError.message,
        });
      }
      return {
        providerId: GITHUB_PROVIDER_ID,
        enabled: true,
        available: true,
        executablePath: command.executablePath,
        version,
        authenticated: true,
        account,
        repositoryMappingValid: true,
      } satisfies GitProviderHealth;
    }),
});

function unhealthy({
  enabled = true,
  executablePath = null,
  version = null,
  authenticated = false,
  account = null,
  repositoryMappingValid = null,
  reason,
}: Partial<Omit<GitProviderHealth, "providerId" | "available">> & {
  reason: string;
}): GitProviderHealth {
  return {
    providerId: GITHUB_PROVIDER_ID,
    enabled,
    available: false,
    executablePath,
    version,
    authenticated,
    account,
    repositoryMappingValid,
    reason,
  };
}
