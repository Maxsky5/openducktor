import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderHealth,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { GithubCommandDependencies } from "../../application/tasks/support/github-pull-requests";
import { errorMessage } from "../../effect/host-errors";
import type { GitProviderHealthPort } from "../../ports/git-provider-port";
import type { createGithubProviderRepositoryAdapter } from "./github-provider-repository";

const GITHUB_PROVIDER_ID = GITHUB_PROVIDER_DESCRIPTOR.id;

const failure = ({
  enabled = true,
  executablePath = null,
  version = null,
  authenticated = false,
  account = null,
  repositoryMappingValid = null,
  reason,
}: Partial<Omit<GitProviderHealth, "providerId" | "available">> & {
  reason: string;
}): GitProviderHealth => ({
  providerId: GITHUB_PROVIDER_ID,
  enabled,
  available: false,
  executablePath,
  version,
  authenticated,
  account,
  repositoryMappingValid,
  reason,
});

type RepositoryMapping = ReturnType<
  typeof createGithubProviderRepositoryAdapter
>["requireSingleMatchingRemote"];

export const createGithubProviderHealthPort = ({
  githubDependencies,
  requireSingleMatchingRemote,
}: {
  githubDependencies: GithubCommandDependencies;
  requireSingleMatchingRemote: RepositoryMapping;
}): GitProviderHealthPort => ({
  getStatus: (repoConfig: RepoConfig) =>
    Effect.gen(function* () {
      const provider = repoConfig.git.provider;
      if (provider?.id !== GITHUB_PROVIDER_ID || !provider.enabled) {
        return failure({
          enabled: false,
          reason: "GitHub provider is not enabled for this repository.",
        });
      }

      const commandResult = yield* Effect.either(githubDependencies.resolveGithubCommand());
      if (commandResult._tag === "Left") {
        return failure({ reason: errorMessage(commandResult.left) });
      }
      const command = commandResult.right;
      const versionResult = yield* Effect.either(
        command.githubCli.readVersion(command.ghCommand, { cwd: repoConfig.repoPath }),
      );
      if (versionResult._tag === "Left" || versionResult.right === null) {
        const reason =
          versionResult._tag === "Left"
            ? `Failed to read GitHub CLI version: ${errorMessage(versionResult.left)}`
            : "Failed to read GitHub CLI version.";
        return failure({ executablePath: command.ghCommand, reason });
      }
      const version = versionResult.right;
      if (!provider.repository) {
        return failure({
          executablePath: command.ghCommand,
          version,
          reason: "GitHub repository coordinates are missing.",
        });
      }
      const repository = provider.repository;
      const authResult = yield* Effect.either(
        command.githubCli.getAuthentication(command.ghCommand, repository.host),
      );
      if (authResult._tag === "Left") {
        return failure({
          executablePath: command.ghCommand,
          version,
          reason: `Failed to check GitHub authentication: ${errorMessage(authResult.left)}`,
        });
      }
      if (!authResult.right.authenticated) {
        return failure({
          executablePath: command.ghCommand,
          version,
          reason:
            authResult.right.reason ??
            "GitHub authentication is not configured. Run `gh auth login`.",
        });
      }
      const account = authResult.right.account;
      const mappingResult = yield* Effect.either(
        requireSingleMatchingRemote(repoConfig.repoPath, repository),
      );
      if (mappingResult._tag === "Left") {
        const mappingError = mappingResult.left;
        if (mappingError._tag !== "GitProviderRepositoryError") {
          return yield* Effect.fail(mappingError);
        }
        return failure({
          executablePath: command.ghCommand,
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
        executablePath: command.ghCommand,
        version,
        authenticated: true,
        account,
        repositoryMappingValid: true,
      } satisfies GitProviderHealth;
    }),
});
