import type { GitProviderRepository } from "./git-schemas";

const SSH_GIT_PREFIX = "git@";
const HTTPS_PREFIX = "https://";
const SSH_URL_PREFIX = "ssh://git@";

type ParsedGitRemote = {
  host: string;
  path: string;
};

type RepositoryPath = {
  name: string;
  owner: string;
};

const stripGitSuffix = (value: string): string => {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
};

const parseScpStyleRemote = (value: string): ParsedGitRemote | null => {
  const remainder = value.slice(SSH_GIT_PREFIX.length);
  const separatorIndex = remainder.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    return null;
  }

  return {
    host: remainder.slice(0, separatorIndex),
    path: remainder.slice(separatorIndex + 1),
  };
};

const parseSlashSeparatedRemote = (value: string, prefix: string): ParsedGitRemote | null => {
  try {
    const parsed = new URL(value);
    if (
      !value.startsWith(prefix) ||
      parsed.hostname.length === 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return null;
    }
    return {
      host: prefix === SSH_URL_PREFIX ? parsed.hostname : parsed.host,
      path: parsed.pathname.slice(1),
    };
  } catch {
    return null;
  }
};

const splitRepositoryPath = (path: string): RepositoryPath | null => {
  const segments = path.split("/");
  if (segments.length !== 2) {
    return null;
  }
  const owner = segments[0]?.trim() ?? "";
  const name = stripGitSuffix(segments[1]?.trim() ?? "");
  if (owner.length === 0 || name.length === 0) {
    return null;
  }

  return {
    owner: owner.trim(),
    name: name.trim(),
  };
};

export const parseGitProviderRepositoryFromRemoteUrl = (
  remoteUrl: string,
): GitProviderRepository | null => {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsedRemote = trimmed.startsWith(SSH_GIT_PREFIX)
    ? parseScpStyleRemote(trimmed)
    : trimmed.startsWith(HTTPS_PREFIX)
      ? parseSlashSeparatedRemote(trimmed, HTTPS_PREFIX)
      : trimmed.startsWith(SSH_URL_PREFIX)
        ? parseSlashSeparatedRemote(trimmed, SSH_URL_PREFIX)
        : null;

  if (!parsedRemote) {
    return null;
  }

  const host = parsedRemote.host.includes("@")
    ? (parsedRemote.host.split("@").at(-1) ?? "")
    : parsedRemote.host;
  const repositoryPath = splitRepositoryPath(parsedRemote.path);
  if (!host.trim() || !repositoryPath) {
    return null;
  }

  return {
    host: host.trim(),
    owner: repositoryPath.owner,
    name: repositoryPath.name,
  };
};

export const gitProviderRepositoryKey = (repository: GitProviderRepository): string => {
  return `${repository.host.toLowerCase()}::${repository.owner.toLowerCase()}::${repository.name.toLowerCase()}`;
};
