import {
  GITLAB_COM_INSTANCE_URL,
  type GitProviderRepository,
  type GitlabRepository,
} from "@openducktor/contracts";

export const isGitlabRepository = (
  repository: GitProviderRepository,
): repository is GitlabRepository =>
  "providerId" in repository && repository.providerId === "gitlab";

/** Lowercase scheme and host, no default port, no trailing slash. A sub-path stays. */
export const canonicalGitlabInstanceUrl = (value: string): string => {
  const parsed = new URL(value.trim());
  const path = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
};

/** The GitLab account that a provider config links, if any. */
export const linkedGitlabAccountId = (
  provider: { id: string; settings?: { accountId?: string | undefined } | undefined } | undefined,
): string | undefined => (provider?.id === "gitlab" ? provider.settings?.accountId : undefined);

export const isGitlabComInstance = (instanceUrl: string): boolean =>
  canonicalGitlabInstanceUrl(instanceUrl) === GITLAB_COM_INSTANCE_URL;

/** The display name of an instance, such as `gitlab.com` or `example.com/gitlab`. */
export const gitlabInstanceLabel = (instanceUrl: string): string => {
  const canonical = canonicalGitlabInstanceUrl(instanceUrl);
  return canonical.startsWith("https://") ? canonical.slice("https://".length) : canonical;
};

/** Compares GitLab projects by canonical instance URL and lowercase project path. */
export const gitlabRepositoryKey = (repository: GitlabRepository): string =>
  [
    "gitlab",
    canonicalGitlabInstanceUrl(repository.instanceUrl),
    repository.projectPath.toLowerCase(),
  ].join("::");

/** The identity of a resolved project. A project rename keeps it. */
export const gitlabResolvedRepositoryIdentity = (repository: {
  instanceUrl: string;
  projectId: number;
}): string =>
  ["gitlab", canonicalGitlabInstanceUrl(repository.instanceUrl), String(repository.projectId)].join(
    "::",
  );

export const gitlabProjectWebUrl = (repository: GitlabRepository): string =>
  `${canonicalGitlabInstanceUrl(repository.instanceUrl)}/${repository.projectPath}`;

/** The token page of an instance, with the name and the `api` scope filled in. */
export const gitlabTokenPageUrl = (instanceUrl: string): string =>
  `${canonicalGitlabInstanceUrl(instanceUrl)}/-/user_settings/personal_access_tokens?name=OpenDucktor&scopes=api`;

export type GitlabRemoteUrl = {
  kind: "web" | "ssh";
  /** The web origin of an HTTP or HTTPS remote, such as `https://host:8443`. */
  origin: string | null;
  /** The host name without the port. */
  hostname: string;
  /** The path without leading or trailing slashes and without `.git`. */
  path: string;
};

const SCP_REMOTE = /^[^@/\s]+@([^:/\s]+):(?!\/\/)(.+)$/u;

/** Reads `https://host/path`, `git@host:path`, and `ssh://git@host:port/path` remote URLs. */
export const parseGitlabRemoteUrl = (remoteUrl: string): GitlabRemoteUrl | null => {
  const value = remoteUrl.trim();
  const scp = SCP_REMOTE.exec(value);
  if (scp?.[1] && scp[2]) {
    const path = cleanRemotePath(scp[2]);
    return path ? { kind: "ssh", origin: null, hostname: scp[1].toLowerCase(), path } : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.password || parsed.search || parsed.hash || !parsed.hostname) return null;
  const path = cleanRemotePath(parsed.pathname);
  if (!path) return null;
  if (parsed.protocol === "ssh:") {
    return { kind: "ssh", origin: null, hostname: parsed.hostname.toLowerCase(), path };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return {
    kind: "web",
    origin: `${parsed.protocol}//${parsed.host}`,
    hostname: parsed.hostname.toLowerCase(),
    path,
  };
};

const cleanRemotePath = (value: string): string | null => {
  const path = value
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
  const segments = path.split("/");
  return segments.length >= 2 && segments.every((segment) => segment.length > 0) ? path : null;
};

const hostnameOf = (instanceUrl: string): string => new URL(instanceUrl).hostname.toLowerCase();

/**
 * Resolves the GitLab project of a remote URL. A known instance on the same host gives the
 * instance URL and removes its sub-path from an HTTP or HTTPS remote path. Otherwise an HTTP or
 * HTTPS remote gives its own origin, and an SSH remote gives `https://<host>`.
 */
export const gitlabRepositoryFromRemote = (
  remote: GitlabRemoteUrl,
  knownInstanceUrls: readonly string[],
): GitlabRepository | null => {
  const known = knownInstanceUrls
    .map(canonicalGitlabInstanceUrl)
    .filter((instanceUrl) => {
      const url = new URL(instanceUrl);
      if (remote.kind === "ssh") return url.hostname.toLowerCase() === remote.hostname;
      const subPath = url.pathname.replace(/^\/+/u, "");
      return (
        `${url.protocol}//${url.host}` === remote.origin &&
        (subPath === "" || remote.path.toLowerCase().startsWith(`${subPath.toLowerCase()}/`))
      );
    })
    .sort((left, right) => right.length - left.length)[0];
  let instanceUrl = known ?? remote.origin ?? `https://${remote.hostname}`;
  let projectPath = remote.path;
  if (known && remote.kind === "web") {
    const subPath = new URL(known).pathname.replace(/^\/+/u, "");
    if (subPath) projectPath = remote.path.slice(subPath.length + 1);
  }
  instanceUrl = canonicalGitlabInstanceUrl(instanceUrl);
  if (projectPath.split("/").length < 2) return null;
  return { providerId: "gitlab", instanceUrl, projectPath };
};

/** The GitLab project of a remote URL, or null when the URL names none. */
export const gitlabRepositoryFromRemoteUrl = (
  remoteUrl: string,
  knownInstanceUrls: readonly string[],
): GitlabRepository | null => {
  const remote = parseGitlabRemoteUrl(remoteUrl);
  return remote ? gitlabRepositoryFromRemote(remote, knownInstanceUrls) : null;
};

/** A host counts as GitLab when it contains "gitlab", as gitlab.com does, or is a known instance. */
export const isGitlabHost = (hostname: string, knownInstanceUrls: readonly string[]): boolean => {
  const host = hostname.toLowerCase();
  return (
    host.includes("gitlab") ||
    knownInstanceUrls.some((instanceUrl) => hostnameOf(instanceUrl) === host)
  );
};
