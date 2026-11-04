import { GITLAB_PROVIDER_DESCRIPTOR, type GitlabRepository } from "@openducktor/contracts";
import {
  canonicalGitlabInstanceUrl,
  gitlabRepositoryFromRemoteUrl,
  gitlabRepositoryKey,
  isGitlabRepository,
  parseGitlabRemoteUrl,
} from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { GitPort, GitRemoteEndpoint } from "../../../ports/git-port";
import { GitProviderRepositoryError } from "../../../ports/git-provider-errors";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import type { GitlabConnectionPort } from "../../../ports/gitlab-connection-port";
import { requireLocalGitRepository } from "../local-repository";
import type { GitProviderWorkspace } from "../../../ports/git-provider-workspace";

const PROVIDER_ID = GITLAB_PROVIDER_DESCRIPTOR.id;

const remoteUrls = (remote: GitRemoteEndpoint) => [...remote.fetchUrls, ...remote.pushUrls];

/** The GitLab project of the first URL of the origin remote, or null when it names none. */
export const gitlabOriginRepository = (
  endpoints: readonly GitRemoteEndpoint[],
  knownInstances: readonly string[],
): GitlabRepository | null => {
  const origin = endpoints.find((endpoint) => endpoint.name === "origin");
  const url = origin ? remoteUrls(origin)[0] : undefined;
  return url ? gitlabRepositoryFromRemoteUrl(url, knownInstances) : null;
};

/** A remote matches when each of its URLs names the configured project on its instance. */
const remoteMatches = (remote: GitRemoteEndpoint, repository: GitlabRepository): boolean => {
  const urls = remoteUrls(remote);
  const key = gitlabRepositoryKey(repository);
  return (
    urls.length > 0 &&
    urls.every((url) => {
      const parsed = gitlabRepositoryFromRemoteUrl(url, [repository.instanceUrl]);
      return parsed !== null && gitlabRepositoryKey(parsed) === key;
    })
  );
};

/** A named remote with an SSH host alias, which the instance cannot match, matches on its project path. */
const aliasMatches = (remote: GitRemoteEndpoint, repository: GitlabRepository): boolean => {
  const urls = remoteUrls(remote);
  const projectPath = repository.projectPath.toLowerCase();
  return (
    urls.length > 0 &&
    urls.every((url) => {
      // HTTP and HTTPS remotes name their real host, so only the instance match applies to them.
      const remote = parseGitlabRemoteUrl(url);
      return remote?.kind === "ssh" && remote.path.toLowerCase() === projectPath;
    })
  );
};

export const configuredGitlabRepository = (repoConfig: GitProviderWorkspace) =>
  Effect.gen(function* () {
    const provider = repoConfig.git.provider;
    if (provider?.id !== PROVIDER_ID || !provider.enabled)
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.enabled",
          message: "GitLab is not enabled for this repository.",
        }),
      );
    if (!provider.repository || !isGitlabRepository(provider.repository))
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.repository",
          message: "Enter the GitLab instance URL and project path in the repository Git settings.",
        }),
      );
    return {
      ...provider.repository,
      instanceUrl: canonicalGitlabInstanceUrl(provider.repository.instanceUrl),
    } satisfies GitlabRepository;
  });

export const createGitlabRepositoryAdapter = ({
  gitPort,
  connection,
}: {
  gitPort: GitPort;
  connection: Pick<GitlabConnectionPort, "knownInstances">;
}): GitProviderRepositoryPort<GitlabRepository> => ({
  detectRepository(repoPath) {
    return Effect.gen(function* () {
      const canonicalRepoPath = yield* requireLocalGitRepository(gitPort, repoPath);
      const endpoints = yield* gitPort.listRemoteEndpoints(canonicalRepoPath);
      const repository = gitlabOriginRepository(endpoints, yield* connection.knownInstances());
      if (repository) return repository;
      return yield* Effect.fail(
        new GitProviderRepositoryError({
          reason: "no_matching_remote",
          providerId: PROVIDER_ID,
          repoPath: canonicalRepoPath,
          remoteNames: endpoints.map((endpoint) => endpoint.name),
          message: origin
            ? `The origin remote of ${canonicalRepoPath} does not name a GitLab project. Enter the instance URL and project path.`
            : `${canonicalRepoPath} has no origin remote. Enter the GitLab instance URL and project path.`,
        }),
      );
    });
  },
  getRepository: configuredGitlabRepository,
  getMapping(repoConfig) {
    return Effect.gen(function* () {
      const repository = yield* configuredGitlabRepository(repoConfig);
      const endpoints = yield* gitPort.listRemoteEndpoints(repoConfig.repoPath);
      const configuredRemote = repoConfig.git.provider?.settings?.remoteName;
      const remoteNames = endpoints.flatMap((remote) => {
        if (configuredRemote !== undefined)
          return remote.name === configuredRemote &&
            (remoteMatches(remote, repository) || aliasMatches(remote, repository))
            ? [remote.name]
            : [];
        return remoteMatches(remote, repository) ? [remote.name] : [];
      });
      const remoteName = remoteNames[0];
      if (remoteNames.length === 1 && remoteName) return { repository, remoteName };
      const project = repository.projectPath;
      const localNames = endpoints.map((endpoint) => endpoint.name).join(", ") || "none";
      let message = `Several local Git remotes point to the GitLab project ${project}: ${remoteNames.join(", ")}. Keep one, or enter one in Project remote.`;
      if (remoteNames.length === 0 && configuredRemote !== undefined)
        message = `The remote ${configuredRemote} does not point to the GitLab project ${project}. Local remotes: ${localNames}. Enter the correct remote in Project remote.`;
      else if (remoteNames.length === 0)
        message = `No local Git remote points to the GitLab project ${project}. Local remotes: ${localNames}. For an SSH host alias, enter its remote name in Project remote.`;
      return yield* Effect.fail(
        new GitProviderRepositoryError({
          reason: remoteNames.length === 0 ? "no_matching_remote" : "ambiguous_matching_remotes",
          providerId: PROVIDER_ID,
          repoPath: repoConfig.repoPath,
          remoteNames,
          repositories: [repository],
          message,
        }),
      );
    });
  },
});
