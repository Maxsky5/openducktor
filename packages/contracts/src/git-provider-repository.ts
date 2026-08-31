import type { GitProviderRepository } from "./git-schemas";

const SSH_GIT_PREFIX = "git@";
const HTTPS_PREFIX = "https://";
const SSH_URL_PREFIX = "ssh://git@";

type RemoteParts = {
  host: string;
  path: string;
};

type RepositoryPath = {
  name: string;
  owner: string;
};

export function parseGitRepositoryUrl(remoteUrl: string): GitProviderRepository | null {
  const value = remoteUrl.trim();
  if (value.length === 0) {
    return null;
  }

  const remote = parseRemote(value);
  if (!remote) {
    return null;
  }

  const host = remote.host.includes("@") ? (remote.host.split("@").at(-1) ?? "") : remote.host;
  const repository = parseRepositoryPath(remote.path);
  if (!host.trim() || !repository) {
    return null;
  }

  return {
    host: host.trim(),
    owner: repository.owner,
    name: repository.name,
  };
}

export function gitRepositoryKey(repository: GitProviderRepository): string {
  return `${repository.host.toLowerCase()}::${repository.owner.toLowerCase()}::${repository.name.toLowerCase()}`;
}

function parseRemote(value: string): RemoteParts | null {
  if (value.startsWith(SSH_GIT_PREFIX)) {
    return parseScpRemote(value);
  }
  if (value.startsWith(HTTPS_PREFIX) || value.startsWith(SSH_URL_PREFIX)) {
    return parseUrlRemote(value);
  }
  return null;
}

function parseScpRemote(value: string): RemoteParts | null {
  const remainder = value.slice(SSH_GIT_PREFIX.length);
  const separatorIndex = remainder.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    return null;
  }

  return {
    host: remainder.slice(0, separatorIndex),
    path: remainder.slice(separatorIndex + 1),
  };
}

function parseUrlRemote(value: string): RemoteParts | null {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.length === 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
      return null;
    }
    return {
      host: parsed.protocol === "ssh:" ? parsed.hostname : parsed.host,
      path: parsed.pathname.slice(1),
    };
  } catch {
    return null;
  }
}

function parseRepositoryPath(path: string): RepositoryPath | null {
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
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}
