import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderHealth,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../../effect/host-errors";
import type { GitProviderHealthPort } from "../../../ports/git-provider-port";
import type { GithubCli } from "./cli";
import type { createGithubProviderRepositoryAdapter } from "./repository";

const GITHUB_PROVIDER_ID = GITHUB_PROVIDER_DESCRIPTOR.id;

type MatchRemote = ReturnType<typeof createGithubProviderRepositoryAdapter>["matchRemote"];

export const createGithubProviderHealthPort = ({
  githubCli,
  matchRemote,
}: {
  githubCli: GithubCli;
  matchRemote: MatchRemote;
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

      const commandResult = yield* Effect.either(githubCli.resolve());
      if (commandResult._tag === "Left") {
        return unhealthy({ reason: errorMessage(commandResult.left) });
      }
      const command = commandResult.right;
      const versionResult = yield* Effect.either(command.readVersion({ cwd: repoConfig.repoPath }));
      if (versionResult._tag === "Left" || versionResult.right === null) {
        const reason =
          versionResult._tag === "Left"
            ? `Failed to read GitHub CLI version: ${errorMessage(versionResult.left)}`
            : "Failed to read GitHub CLI version.";
        return unhealthy({ executablePath: command.executablePath, reason });
      }
      const version = versionResult.right;
      if (!provider.repository) {
        return unhealthy({
          executablePath: command.executablePath,
          version,
          reason: "GitHub repository coordinates are missing.",
        });
      }
      const repository = provider.repository;
      const authResult = yield* Effect.either(command.getAuth(repository.host));
      if (authResult._tag === "Left") {
        return unhealthy({
          executablePath: command.executablePath,
          version,
          reason: `Failed to check GitHub authentication: ${errorMessage(authResult.left)}`,
        });
      }
      if (!authResult.right.authenticated) {
        return unhealthy({
          executablePath: command.executablePath,
          version,
          reason:
            authResult.right.reason ??
            "GitHub authentication is not configured. Run `gh auth login`.",
        });
      }
      const account = authResult.right.account;
      const mappingResult = yield* Effect.either(matchRemote(repoConfig.repoPath, repository));
      if (mappingResult._tag === "Left") {
        const mappingError = mappingResult.left;
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
