import type { GitProviderRepository } from "./git-schemas";

const SSH_GIT_PREFIX = "git@";
const HTTPS_PREFIX = "https://";
const SSH_URL_PREFIX = "ssh://git@";

const stripGitSuffix = (value: string): string => {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
};

const parseScpStyleRemote = (value: string): { host: string; path: string } | null => {
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

const parseSlashSeparatedRemote = (
  value: string,
  prefix: string,
): { host: string; path: string } | null => {
  const remainder = value.slice(prefix.length);
  const separatorIndex = remainder.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    return null;
  }

  return {
    host: remainder.slice(0, separatorIndex),
    path: remainder.slice(separatorIndex + 1),
  };
};

const splitRepositoryPath = (path: string): { owner: string; name: string } | null => {
  const [owner, name] = path.split("/", 3);
  if (!owner?.trim() || !name?.trim()) {
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

  const withoutSuffix = stripGitSuffix(trimmed);
  const parsedRemote = withoutSuffix.startsWith(SSH_GIT_PREFIX)
    ? parseScpStyleRemote(withoutSuffix)
    : withoutSuffix.startsWith(HTTPS_PREFIX)
      ? parseSlashSeparatedRemote(withoutSuffix, HTTPS_PREFIX)
      : withoutSuffix.startsWith(SSH_URL_PREFIX)
        ? parseSlashSeparatedRemote(withoutSuffix, SSH_URL_PREFIX)
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
