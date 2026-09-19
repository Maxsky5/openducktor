import type { AzureDevOpsRepository, GitProviderRepository } from "@openducktor/contracts";

const CLOUD_HTTPS_HOST = "dev.azure.com";
const CLOUD_SSH_HOST = "ssh.dev.azure.com";
const LEGACY_CLOUD_SUFFIX = ".visualstudio.com";
const SCP_GIT_PREFIX = "git@";

type RemoteParts = {
  host: string;
  path: string;
};

export const isAzureDevOpsRepository = (
  repository: GitProviderRepository,
): repository is AzureDevOpsRepository =>
  "providerId" in repository && repository.providerId === "azure_devops";

export const azureDevOpsRepositoryKey = (repository: AzureDevOpsRepository): string => {
  const values = [repository.organization, repository.project, repository.name];
  const identity = repository.deployment === "services" ? values.map(lower) : values;
  return [
    "azure_devops",
    repository.deployment,
    canonicalServiceUrl(repository.serviceUrl),
    ...identity,
  ].join("::");
};

export const azureDevOpsConnectionConfigurationFingerprint = (
  workspaceId: string,
  repoPath: string,
  repository: AzureDevOpsRepository,
): string =>
  [workspaceId, repoPath, "azure_devops", azureDevOpsRepositoryKey(repository)].join("\n");

export const azureDevOpsCollectionUrl = (repository: AzureDevOpsRepository): string =>
  joinUrl(canonicalServiceUrl(repository.serviceUrl), repository.organization);

export const azureDevOpsResolvedRepositoryIdentity = (repository: {
  deployment: AzureDevOpsRepository["deployment"];
  serviceUrl: string;
  organization: string;
  projectId: string;
  repositoryId: string;
}): string =>
  [
    "azure_devops",
    joinUrl(
      canonicalServiceUrl(repository.serviceUrl),
      repository.deployment === "services"
        ? lower(repository.organization)
        : repository.organization,
    ),
    repository.projectId,
    repository.repositoryId,
  ].join("::");

export const azureDevOpsProjectUrl = (repository: AzureDevOpsRepository): string =>
  joinUrl(azureDevOpsCollectionUrl(repository), repository.project);

export const parseAzureDevOpsRepositoryUrl = (remoteUrl: string): AzureDevOpsRepository | null => {
  const value = remoteUrl.trim();
  if (!value) {
    return null;
  }

  const scp = parseScpRemote(value);
  if (scp) {
    if (scp.host.toLowerCase() !== CLOUD_SSH_HOST) {
      return null;
    }
    return parseCloudSshPath(scp.path);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !["http:", "https:", "ssh:"].includes(parsed.protocol)
  ) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const segments = decodePathSegments(parsed.pathname);
  if (!segments) {
    return null;
  }
  if (parsed.protocol === "ssh:") {
    return host === CLOUD_SSH_HOST ? parseCloudSshSegments(segments) : null;
  }
  if (host === CLOUD_HTTPS_HOST) {
    return parseCloudHttpsSegments(segments);
  }
  if (host.endsWith(LEGACY_CLOUD_SUFFIX)) {
    return parseLegacyCloudSegments(host, segments);
  }
  return parseServerSegments(parsed, segments);
};

const parseCloudSshPath = (path: string): AzureDevOpsRepository | null => {
  const segments = decodePathSegments(path);
  return segments ? parseCloudSshSegments(segments) : null;
};

const parseCloudSshSegments = (segments: string[]): AzureDevOpsRepository | null => {
  if (segments.length !== 4 || segments[0] !== "v3") {
    return null;
  }
  return cloudRepository(segments[1]!, segments[2]!, segments[3]!);
};

const parseCloudHttpsSegments = (segments: string[]): AzureDevOpsRepository | null => {
  if (segments.length !== 4 || segments[2] !== "_git") {
    return null;
  }
  return cloudRepository(segments[0]!, segments[1]!, segments[3]!);
};

const parseLegacyCloudSegments = (
  host: string,
  segments: string[],
): AzureDevOpsRepository | null => {
  const organization = host.slice(0, -LEGACY_CLOUD_SUFFIX.length);
  const offset = segments[0]?.toLowerCase() === "defaultcollection" ? 1 : 0;
  if (segments.length !== offset + 3 || segments[offset + 1] !== "_git") {
    return null;
  }
  return cloudRepository(organization, segments[offset]!, segments[offset + 2]!);
};

const cloudRepository = (
  organization: string,
  project: string,
  repository: string,
): AzureDevOpsRepository | null => {
  const name = stripGitSuffix(repository);
  if (!organization || !project || !name) {
    return null;
  }
  return {
    providerId: "azure_devops",
    deployment: "services",
    serviceUrl: `https://${CLOUD_HTTPS_HOST}`,
    organization,
    project,
    name,
  };
};

const parseServerSegments = (parsed: URL, segments: string[]): AzureDevOpsRepository | null => {
  const gitIndex = segments.length - 2;
  if (segments.length < 4 || segments[gitIndex] !== "_git") {
    return null;
  }
  const organizationIndex = segments.length - 4;
  const organization = segments[organizationIndex];
  const project = segments[organizationIndex + 1];
  const name = stripGitSuffix(segments[organizationIndex + 3] ?? "");
  if (!organization || !project || !name) {
    return null;
  }
  const installationPath = segments.slice(0, organizationIndex).map(encodeURIComponent).join("/");
  const serviceUrl = `${parsed.protocol}//${parsed.host}${installationPath ? `/${installationPath}` : ""}`;
  return {
    providerId: "azure_devops",
    deployment: "server",
    serviceUrl,
    organization,
    project,
    name,
  };
};

const parseScpRemote = (value: string): RemoteParts | null => {
  if (!value.startsWith(SCP_GIT_PREFIX)) {
    return null;
  }
  const remainder = value.slice(SCP_GIT_PREFIX.length);
  const separatorIndex = remainder.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    return null;
  }
  return {
    host: remainder.slice(0, separatorIndex),
    path: remainder.slice(separatorIndex + 1),
  };
};

const decodePathSegments = (path: string): string[] | null => {
  const rawSegments = path.replace(/^\/+|\/+$/gu, "").split("/");
  if (rawSegments.length === 1 && rawSegments[0] === "") {
    return [];
  }
  try {
    const segments = rawSegments.map((segment) => decodeURIComponent(segment));
    return segments.some((segment) => !segment || segment === "." || segment === "..")
      ? null
      : segments;
  } catch {
    return null;
  }
};

const canonicalServiceUrl = (value: string): string => {
  const parsed = new URL(value);
  const path = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
};

const joinUrl = (base: string, segment: string): string =>
  `${base.replace(/\/+$/u, "")}/${encodeURIComponent(segment)}`;

const stripGitSuffix = (value: string): string =>
  value.endsWith(".git") ? value.slice(0, -4) : value;

const lower = (value: string): string => value.toLowerCase();
