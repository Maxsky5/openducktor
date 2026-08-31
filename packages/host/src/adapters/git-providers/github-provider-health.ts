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

const commandOutput = (stdout: string, stderr: string): string =>
  [stdout.trim(), stderr.trim()].filter((value) => value.length > 0).join("\n");

const parseAccount = (output: string): string | null => {
  const marker = "account ";
  const markerIndex = output.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const remainder = output.slice(markerIndex + marker.length).trimStart();
  const account = remainder.split(/[\s(']/)[0]?.trim() ?? "";
  return account.length > 0 ? account : null;
};

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
        command.githubCli.run(command.ghCommand, ["auth", "status", "--hostname", repository.host]),
      );
      if (authResult._tag === "Left") {
        return failure({
          executablePath: command.ghCommand,
          version,
          reason: `Failed to check GitHub authentication: ${errorMessage(authResult.left)}`,
        });
      }
      const authOutput = commandOutput(authResult.right.stdout, authResult.right.stderr);
      if (!authResult.right.ok) {
        return failure({
          executablePath: command.ghCommand,
          version,
          reason: authOutput || "GitHub authentication is not configured. Run `gh auth login`.",
        });
      }
      const account = parseAccount(authOutput);
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
