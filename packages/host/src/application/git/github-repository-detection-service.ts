import { type GitProviderRepository, gitProviderRepositorySchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";

export type GithubRepositoryDetectionError = GitPortError | HostValidationError;

export type GithubRepositoryDetectionService = {
  detectGithubRepository(
    input: GithubRepositoryDetectionInput,
  ): Effect.Effect<GitProviderRepository | null, GithubRepositoryDetectionError>;
};
export type GithubRepositoryDetectionInput = {
  repoPath: string;
};
const repositoryKey = (repository: GitProviderRepository): string =>
  `${repository.host}/${repository.owner}/${repository.name}`.toLowerCase();
export const parseGithubRemoteUrl = (url: string): GitProviderRepository | null => {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  const withoutSuffix = trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;
  let hostAndPath: [string, string] | null = null;
  if (withoutSuffix.startsWith("git@")) {
    const rest = withoutSuffix.slice("git@".length);
    const [host, path] = rest.split(":", 2);
    if (host && path) {
      hostAndPath = [host, path];
    }
  } else if (withoutSuffix.startsWith("https://")) {
    const rest = withoutSuffix.slice("https://".length);
    const slashIndex = rest.indexOf("/");
    if (slashIndex > 0) {
      hostAndPath = [rest.slice(0, slashIndex), rest.slice(slashIndex + 1)];
    }
  } else if (withoutSuffix.startsWith("ssh://git@")) {
    const rest = withoutSuffix.slice("ssh://git@".length);
    const slashIndex = rest.indexOf("/");
    if (slashIndex > 0) {
      hostAndPath = [rest.slice(0, slashIndex), rest.slice(slashIndex + 1)];
    }
  }
  if (!hostAndPath) {
    return null;
  }
  const [rawHost, rawPath] = hostAndPath;
  const host = rawHost.includes("@") ? rawHost.split("@").at(-1) : rawHost;
  const [owner, name] = rawPath.split("/", 2).map((segment) => segment.trim());
  if (!host?.trim() || !owner || !name) {
    return null;
  }
  return gitProviderRepositorySchema.parse({
    host: host.trim(),
    owner,
    name,
  });
};
export const createGithubRepositoryDetectionService = (
  gitPort: GitPort,
): GithubRepositoryDetectionService => ({
  detectGithubRepository(input) {
    return Effect.gen(function* () {
      const { repoPath } = input;
      const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath).pipe(
        Effect.mapError(
          (error) =>
            new HostValidationError({
              message: `repo_path does not exist or is not accessible: ${repoPath}`,
              field: "repoPath",
              cause: error,
            }),
        ),
      );
      if (!(yield* gitPort.isGitRepository(canonicalRepoPath))) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Not a git repository: ${canonicalRepoPath}`,
            field: "repoPath",
          }),
        );
      }
      const repositoriesByKey = new Map<string, GitProviderRepository>();
      for (const remote of yield* gitPort.listRemotes(canonicalRepoPath)) {
        const repository = parseGithubRemoteUrl(remote.url);
        if (repository) {
          repositoriesByKey.set(repositoryKey(repository), repository);
        }
      }
      if (repositoriesByKey.size !== 1) {
        return null;
      }
      const [repository] = repositoriesByKey.values();
      return repository ?? null;
    });
  },
});
