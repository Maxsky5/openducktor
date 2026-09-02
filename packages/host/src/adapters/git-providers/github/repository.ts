import {
  GITHUB_PROVIDER_DESCRIPTOR,
  gitRepositoryKey,
  parseGitRepositoryUrl,
  type GitProviderRepository,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import { GitProviderRepositoryError } from "../../../ports/git-provider-errors";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";

const GITHUB_PROVIDER_ID = GITHUB_PROVIDER_DESCRIPTOR.id;

export const createGithubProviderRepositoryAdapter = ({ gitPort }: { gitPort: GitPort }) => {
  const findRemoteNames = (repoPath: string, repository: GitProviderRepository) =>
    Effect.gen(function* () {
      const expectedKey = gitRepositoryKey(repository);
      return (yield* gitPort.listRemotes(repoPath)).flatMap((remote) => {
        const parsed = parseGitRepositoryUrl(remote.url);
        return parsed !== null && gitRepositoryKey(parsed) === expectedKey ? [remote.name] : [];
      });
    });

  const matchRemote = (repoPath: string, repository: GitProviderRepository) =>
    Effect.gen(function* () {
      const remoteNames = yield* findRemoteNames(repoPath, repository);
      const remoteName = remoteNames[0];
      if (remoteNames.length === 1 && remoteName !== undefined) {
        return remoteName;
      }
      return yield* Effect.fail(mappingError({ repoPath, repository, remoteNames }));
    });

  const getRepository = (repoConfig: RepoConfig) => configuredRepository(repoConfig);

  const getMapping = (repoConfig: RepoConfig) =>
    Effect.gen(function* () {
      const repository = yield* getRepository(repoConfig);
      const remoteName = yield* matchRemote(repoConfig.repoPath, repository);
      return { repository, remoteName };
    });

  return {
    detectRepository: (repoPath) =>
      Effect.gen(function* () {
        const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath).pipe(
          Effect.mapError(
            (cause) =>
              new HostValidationError({
                field: "repoPath",
                message: `repo_path does not exist or is not accessible: ${repoPath}`,
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
        const remotes = yield* gitPort.listRemotes(canonicalRepoPath);
        const repositories = uniqueRepositories(remotes.map((remote) => remote.url));
        const repository = repositories[0];
        if (repositories.length === 1 && repository) {
          return repository;
        }
        return yield* Effect.fail(detectError(canonicalRepoPath, repositories));
      }),
    getRepository,
    getMapping,
  } satisfies GitProviderRepositoryPort;
};

const configuredRepository = (repoConfig: RepoConfig) =>
  Effect.gen(function* () {
    const provider = repoConfig.git.provider;
    if (provider?.id !== GITHUB_PROVIDER_ID || !provider.enabled) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.enabled",
          message: "GitHub provider is not enabled for this repository.",
          details: { repoPath: repoConfig.repoPath },
        }),
      );
    }
    if (!provider.repository) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.repository",
          message: "GitHub repository coordinates are missing.",
          details: { repoPath: repoConfig.repoPath },
        }),
      );
    }
    if (!isGithubCliHost(provider.repository.host)) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.repository.host",
          message: `GitHub CLI does not support repository hosts with ports: ${provider.repository.host}.`,
          details: { repoPath: repoConfig.repoPath },
        }),
      );
    }
    return provider.repository;
  });

const uniqueRepositories = (urls: readonly string[]): GitProviderRepository[] => {
  const repositories = new Map<string, GitProviderRepository>();
  for (const url of urls) {
    const repository = parseGitRepositoryUrl(url);
    if (repository && isGithubCliHost(repository.host)) {
      repositories.set(gitRepositoryKey(repository), repository);
    }
  }
  return [...repositories.values()];
};

const isGithubCliHost = (host: string): boolean => !host.includes(":");

const mappingError = ({
  repoPath,
  repository,
  remoteNames,
}: {
  repoPath: string;
  repository: GitProviderRepository;
  remoteNames: readonly string[];
}) => {
  const reason = remoteNames.length === 0 ? "no_matching_remote" : "ambiguous_matching_remotes";
  return new GitProviderRepositoryError({
    reason,
    providerId: GITHUB_PROVIDER_ID,
    repoPath,
    remoteNames,
    repositories: [repository],
    message:
      reason === "no_matching_remote"
        ? `No git remote matches the configured GitHub repository ${repository.host}:${repository.owner}/${repository.name}.`
        : `Multiple git remotes match the configured GitHub repository ${repository.host}:${repository.owner}/${repository.name}: ${remoteNames.join(", ")}. Configure a single matching remote before opening or updating a pull request.`,
  });
};

const detectError = (repoPath: string, repositories: readonly GitProviderRepository[]) => {
  const reason = repositories.length === 0 ? "no_matching_remote" : "ambiguous_matching_remotes";
  return new GitProviderRepositoryError({
    reason,
    providerId: GITHUB_PROVIDER_ID,
    repoPath,
    repositories,
    message:
      reason === "no_matching_remote"
        ? `No supported GitHub remote was found in ${repoPath}.`
        : `Multiple GitHub repository identities were found in ${repoPath}: ${repositories.map((repository) => `${repository.host}:${repository.owner}/${repository.name}`).join(", ")}. Configure remotes for one repository before continuing.`,
  });
};
