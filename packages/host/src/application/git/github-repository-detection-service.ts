import { type GitProviderRepository, gitProviderRepositorySchema } from "@openducktor/contracts";
import type { GitPort } from "../../ports/git-port";

export type GithubRepositoryDetectionService = {
  detectGithubRepository(
    input: GithubRepositoryDetectionInput,
  ): Promise<GitProviderRepository | null>;
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
  async detectGithubRepository(input) {
    const { repoPath } = input;
    const canonicalRepoPath = await gitPort.canonicalizePath(repoPath).catch((error: unknown) => {
      throw new Error(`repo_path does not exist or is not accessible: ${repoPath}`, {
        cause: error,
      });
    });

    if (!(await gitPort.isGitRepository(canonicalRepoPath))) {
      throw new Error(`Not a git repository: ${canonicalRepoPath}`);
    }

    const repositoriesByKey = new Map<string, GitProviderRepository>();
    for (const remote of await gitPort.listRemotes(canonicalRepoPath)) {
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
  },
});
