import {
  GITHUB_PROVIDER_DESCRIPTOR,
  gitProviderRepositoryKey,
  parseGitProviderRepositoryFromRemoteUrl,
  type GitProviderRepository,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { GithubCommandDependencies } from "../../application/tasks/support/github-pull-requests";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import { GitProviderRepositoryError } from "../../ports/git-provider-errors";
import type { GitProviderRepositoryPort } from "../../ports/git-provider-port";

const GITHUB_PROVIDER_ID = GITHUB_PROVIDER_DESCRIPTOR.id;

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
    return provider.repository;
  });

const repositoriesFromRemotes = (urls: readonly string[]): GitProviderRepository[] => {
  const repositories = new Map<string, GitProviderRepository>();
  for (const url of urls) {
    const repository = parseGitProviderRepositoryFromRemoteUrl(url);
    if (repository) {
      repositories.set(gitProviderRepositoryKey(repository), repository);
    }
  }
  return [...repositories.values()];
};

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

const detectionError = (repoPath: string, repositories: readonly GitProviderRepository[]) => {
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

export const createGithubProviderRepositoryAdapter = ({
  githubDependencies,
  gitPort,
}: {
  githubDependencies: Pick<GithubCommandDependencies, "resolveGithubCommand">;
  gitPort: GitPort;
}) => {
  const matchingRemoteNames = (repoPath: string, repository: GitProviderRepository) =>
    Effect.gen(function* () {
      const expectedKey = gitProviderRepositoryKey(repository);
      return (yield* gitPort.listRemotes(repoPath)).flatMap((remote) => {
        const parsed = parseGitProviderRepositoryFromRemoteUrl(remote.url);
        return parsed !== null && gitProviderRepositoryKey(parsed) === expectedKey
          ? [remote.name]
          : [];
      });
    });

  const requireSingleMatchingRemote = (repoPath: string, repository: GitProviderRepository) =>
    Effect.gen(function* () {
      const remoteNames = yield* matchingRemoteNames(repoPath, repository);
      if (remoteNames.length === 1) {
        return remoteNames[0] ?? "";
      }
      return yield* Effect.fail(mappingError({ repoPath, repository, remoteNames }));
    });

  const requireAuthentication = (repoPath: string, host: string) =>
    Effect.gen(function* () {
      const command = yield* githubDependencies.resolveGithubCommand().pipe(
        Effect.mapError(
          (cause) =>
            new HostValidationError({
              field: "githubCli",
              message: `GitHub operations require the gh CLI. ${errorMessage(cause)}`,
              details: { repoPath },
            }),
        ),
      );
      const authentication = yield* command.githubCli.getAuthentication(command.ghCommand, host);
      if (authentication.authenticated) {
        return;
      }
      return yield* Effect.fail(
        new HostValidationError({
          field: "github.auth",
          message:
            authentication.reason ||
            "GitHub authentication is not configured. Run `gh auth login`.",
          details: { host },
        }),
      );
    });

  const getReadRepository = (repoConfig: RepoConfig) =>
    Effect.gen(function* () {
      const repository = yield* configuredRepository(repoConfig);
      yield* requireAuthentication(repoConfig.repoPath, repository.host);
      return repository;
    });

  const getMappedRepositoryContext = (repoConfig: RepoConfig) =>
    Effect.gen(function* () {
      const repository = yield* getReadRepository(repoConfig);
      const remoteName = yield* requireSingleMatchingRemote(repoConfig.repoPath, repository);
      return { repository, remoteName };
    });

  const port: GitProviderRepositoryPort = {
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
        const repositories = repositoriesFromRemotes(remotes.map((remote) => remote.url));
        const repository = repositories[0];
        if (repositories.length === 1 && repository) {
          return repository;
        }
        return yield* Effect.fail(detectionError(canonicalRepoPath, repositories));
      }),
    getReadRepository,
    getMappedRepositoryContext,
  };

  return { port, requireSingleMatchingRemote };
};
