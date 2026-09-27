import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  type AzureDevOpsRemoteMapping,
  type AzureDevOpsRepository,
  type RepoConfig,
} from "@openducktor/contracts";
import { azureDevOpsRepositoryKey, isAzureDevOpsRepository } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { GitPort, GitRemoteEndpoint } from "../../../ports/git-port";
import { GitProviderRepositoryError } from "../../../ports/git-provider-errors";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import { parseAzureDevOpsRepositoryUrl } from "./repository-identity";

const PROVIDER_ID = AZURE_DEVOPS_PROVIDER_DESCRIPTOR.id;

export const createAzureDevOpsRepositoryAdapter = ({
  gitPort,
}: {
  gitPort: GitPort;
}): GitProviderRepositoryPort<AzureDevOpsRepository> => {
  const getRepository = (repoConfig: RepoConfig) => configuredRepository(repoConfig);

  return {
    detectRepository(repoPath) {
      return Effect.gen(function* () {
        const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath).pipe(
          Effect.mapError(
            (cause) =>
              new HostValidationError({
                field: "repoPath",
                message: `Repository path is not accessible: ${repoPath}`,
                cause,
              }),
          ),
        );
        if (!(yield* gitPort.isGitRepository(canonicalRepoPath))) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "repoPath",
              message: `Not a git repository: ${canonicalRepoPath}`,
            }),
          );
        }
        const endpoints = yield* gitPort.listRemoteEndpoints(canonicalRepoPath);
        const repositories = uniqueRepositories(
          endpoints.flatMap((remote) => [...remote.fetchUrls, ...remote.pushUrls]),
        );
        const repository = repositories[0];
        if (repositories.length === 1 && repository) {
          return repository;
        }
        return yield* Effect.fail(detectionError(canonicalRepoPath, repositories));
      });
    },
    getRepository,
    getMapping(repoConfig) {
      return Effect.gen(function* () {
        const repository = yield* getRepository(repoConfig);
        const endpoints = yield* gitPort.listRemoteEndpoints(repoConfig.repoPath);
        const remoteNames = endpoints.flatMap((remote) =>
          remoteMatches(repoConfig, repository, remote) ? [remote.name] : [],
        );
        const remoteName = remoteNames[0];
        if (remoteNames.length === 1 && remoteName) {
          return { repository, remoteName };
        }
        return yield* Effect.fail(mappingError(repoConfig.repoPath, repository, remoteNames));
      });
    },
  } satisfies GitProviderRepositoryPort<AzureDevOpsRepository>;
};

function configuredRepository(repoConfig: RepoConfig) {
  return Effect.gen(function* () {
    const provider = repoConfig.git.provider;
    if (provider?.id !== PROVIDER_ID || !provider.enabled) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.enabled",
          message: "Azure DevOps is not enabled for this repository.",
        }),
      );
    }
    if (!provider.repository || !isAzureDevOpsRepository(provider.repository)) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.repository",
          message:
            "Azure DevOps service address, organization or collection, project, and repository are required.",
        }),
      );
    }
    return provider.repository;
  });
}

const remoteMatches = (
  repoConfig: RepoConfig,
  repository: AzureDevOpsRepository,
  remote: GitRemoteEndpoint,
): boolean => {
  const explicit = repoConfig.git.provider?.settings?.remoteMappings?.find(
    (mapping) => mapping.remoteName === remote.name,
  );
  if (explicit) {
    return explicitMappingMatches(explicit, repository, remote);
  }
  const parsed = [...remote.fetchUrls, ...remote.pushUrls].map(parseAzureDevOpsRepositoryUrl);
  return (
    parsed.length > 0 &&
    parsed.every(
      (candidate) =>
        candidate !== null &&
        azureDevOpsRepositoryKey(candidate) === azureDevOpsRepositoryKey(repository),
    )
  );
};

const explicitMappingMatches = (
  mapping: AzureDevOpsRemoteMapping,
  repository: AzureDevOpsRepository,
  remote: GitRemoteEndpoint,
): boolean =>
  azureDevOpsRepositoryKey(mapping.repository) === azureDevOpsRepositoryKey(repository) &&
  remote.fetchUrls.includes(mapping.fetchUrl) &&
  sameValues(mapping.pushUrls, remote.pushUrls);

const sameValues = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  [...left].sort().every((value, index) => value === [...right].sort()[index]);

const uniqueRepositories = (urls: readonly string[]): AzureDevOpsRepository[] => {
  const repositories = new Map<string, AzureDevOpsRepository>();
  for (const url of urls) {
    const repository = parseAzureDevOpsRepositoryUrl(url);
    if (repository) {
      repositories.set(azureDevOpsRepositoryKey(repository), repository);
    }
  }
  return [...repositories.values()];
};

const detectionError = (
  repoPath: string,
  repositories: readonly AzureDevOpsRepository[],
): GitProviderRepositoryError =>
  new GitProviderRepositoryError({
    reason: repositories.length === 0 ? "no_matching_remote" : "ambiguous_matching_remotes",
    providerId: PROVIDER_ID,
    repoPath,
    repositories,
    message:
      repositories.length === 0
        ? `No supported Azure DevOps remote was found in ${repoPath}. Enter the service address and repository identity manually for SSH aliases or custom deployments.`
        : `Several Azure DevOps repository identities were found in ${repoPath}. Configure the intended repository before continuing.`,
  });

const mappingError = (
  repoPath: string,
  repository: AzureDevOpsRepository,
  remoteNames: readonly string[],
): GitProviderRepositoryError =>
  new GitProviderRepositoryError({
    reason: remoteNames.length === 0 ? "no_matching_remote" : "ambiguous_matching_remotes",
    providerId: PROVIDER_ID,
    repoPath,
    remoteNames,
    repositories: [repository],
    message:
      remoteNames.length === 0
        ? "No local Git remote maps to the configured Azure DevOps repository. Add an explicit remote mapping for an SSH alias or custom deployment."
        : `Several local Git remotes map to the configured Azure DevOps repository: ${remoteNames.join(", ")}. Keep one matching publish remote.`,
  });
