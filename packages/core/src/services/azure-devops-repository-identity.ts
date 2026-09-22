import type { AzureDevOpsRepository, GitProviderRepository } from "@openducktor/contracts";

export const isAzureDevOpsRepository = (
  repository: GitProviderRepository,
): repository is AzureDevOpsRepository =>
  "providerId" in repository && repository.providerId === "azure_devops";

export const canonicalAzureDevOpsServiceUrl = (value: string): string => {
  const parsed = new URL(value);
  const path = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
};

export const azureDevOpsRepositoryKey = (repository: AzureDevOpsRepository): string => {
  const values = [repository.organization, repository.project, repository.name];
  const identity =
    repository.deployment === "services" ? values.map((value) => value.toLowerCase()) : values;
  return [
    "azure_devops",
    repository.deployment,
    canonicalAzureDevOpsServiceUrl(repository.serviceUrl),
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
  `${canonicalAzureDevOpsServiceUrl(repository.serviceUrl)}/${encodeURIComponent(repository.organization)}`;

export const azureDevOpsResolvedRepositoryIdentity = (repository: {
  deployment: AzureDevOpsRepository["deployment"];
  serviceUrl: string;
  organization: string;
  projectId: string;
  repositoryId: string;
}): string =>
  [
    "azure_devops",
    `${canonicalAzureDevOpsServiceUrl(repository.serviceUrl)}/${encodeURIComponent(
      repository.deployment === "services"
        ? repository.organization.toLowerCase()
        : repository.organization,
    )}`,
    repository.projectId,
    repository.repositoryId,
  ].join("::");
