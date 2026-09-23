import {
  azureDevOpsRemoteMappingSchema,
  azureDevOpsRepositorySchema,
  type AzureDevOpsDeployment,
  type AzureDevOpsRemoteMapping,
  type AzureDevOpsRepository,
  type HostEventPayload,
} from "@openducktor/contracts";
import { azureDevOpsCollectionUrl } from "@openducktor/core";

export type AzureRepositoryDraft = {
  deployment: AzureDevOpsDeployment;
  serviceUrl: string;
  organization: string;
  project: string;
  name: string;
};

export type AzureRemoteMappingDraft = {
  draftId: string;
  remoteName: string;
  fetchUrl: string;
  pushUrls: string;
};

export type AzureRepositoryDraftField = keyof AzureRepositoryDraft;
export type AzureRemoteMappingDraftField = keyof AzureRemoteMappingDraft;
export type AzureRepositoryDraftErrors = {
  deployment: string | null;
  serviceUrl: string | null;
  organization: string | null;
  project: string | null;
  name: string | null;
};
export type AzureRemoteMappingDraftErrors = {
  remoteName: string | null;
  fetchUrl: string | null;
  pushUrls: string | null;
};

type AzureConnectionSelection = {
  workspaceId: string;
  repoPath: string;
  configurationFingerprint: string | null;
  attemptId: string | null;
};

export const isAzureDevOpsConnectionEventCurrent = (
  event: HostEventPayload<"openducktor://azure-devops-connection-updated">,
  selection: AzureConnectionSelection,
): boolean =>
  event.workspaceId === selection.workspaceId &&
  event.repoPath === selection.repoPath &&
  event.providerId === "azure_devops" &&
  event.configurationFingerprint === selection.configurationFingerprint &&
  event.attemptId === selection.attemptId;

export const buildAzureRepositoryDraft = (
  repository: AzureDevOpsRepository | undefined,
): AzureRepositoryDraft => ({
  deployment: repository?.deployment ?? "services",
  serviceUrl: repository?.serviceUrl ?? "https://dev.azure.com",
  organization: repository?.organization ?? "",
  project: repository?.project ?? "",
  name: repository?.name ?? "",
});

export const buildAzureRemoteMappingDrafts = (
  mappings: readonly AzureDevOpsRemoteMapping[] | undefined,
): AzureRemoteMappingDraft[] =>
  (mappings ?? []).map((mapping, index) => ({
    draftId: `saved:${index}:${mapping.remoteName}`,
    remoteName: mapping.remoteName,
    fetchUrl: mapping.fetchUrl,
    pushUrls: mapping.pushUrls.join("\n"),
  }));

export const parseAzureRepositoryDraft = (draft: AzureRepositoryDraft) =>
  azureDevOpsRepositorySchema.safeParse({ providerId: "azure_devops", ...draft });

export const azureDevOpsHttpConsentCollectionUrl = (
  repository: AzureDevOpsRepository | undefined,
): string | null =>
  repository?.deployment === "server" && new URL(repository.serviceUrl).protocol === "http:"
    ? azureDevOpsCollectionUrl(repository)
    : null;

export const azureRepositoryDraftErrors = (
  draft: AzureRepositoryDraft,
): AzureRepositoryDraftErrors => {
  const parsed = parseAzureRepositoryDraft(draft);
  const errors = parsed.success ? {} : parsed.error.flatten().fieldErrors;
  return {
    deployment: errors.deployment?.[0] ?? null,
    serviceUrl: errors.serviceUrl?.[0] ?? null,
    organization: errors.organization?.[0] ?? null,
    project: errors.project?.[0] ?? null,
    name: errors.name?.[0] ?? null,
  };
};

export const parseAzureRemotePushUrls = (value: string): string[] =>
  value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);

export const toAzureRemoteMappings = (
  drafts: readonly AzureRemoteMappingDraft[],
  repository: AzureDevOpsRepository,
): AzureDevOpsRemoteMapping[] =>
  drafts.map((draft) => ({
    remoteName: draft.remoteName,
    fetchUrl: draft.fetchUrl,
    pushUrls: parseAzureRemotePushUrls(draft.pushUrls),
    repository,
  }));

export const azureRemoteMappingDraftErrors = (
  draft: AzureRemoteMappingDraft,
  repository: AzureDevOpsRepository | undefined,
): AzureRemoteMappingDraftErrors => {
  if (!repository) {
    return { remoteName: null, fetchUrl: null, pushUrls: null };
  }
  const parsed = azureDevOpsRemoteMappingSchema.safeParse(
    toAzureRemoteMappings([draft], repository)[0],
  );
  const errors = parsed.success ? {} : parsed.error.flatten().fieldErrors;
  return {
    remoteName: errors.remoteName?.[0] ?? null,
    fetchUrl: errors.fetchUrl?.[0] ?? null,
    pushUrls: errors.pushUrls?.[0] ?? null,
  };
};

export const azureRemoteMappingDraftListErrors = (
  drafts: readonly AzureRemoteMappingDraft[],
  repository: AzureDevOpsRepository | undefined,
): AzureRemoteMappingDraftErrors[] => {
  const remoteNames = new Set<string>();
  return drafts.map((draft) => {
    const errors = azureRemoteMappingDraftErrors(draft, repository);
    const remoteName = draft.remoteName.trim();
    if (remoteName && remoteNames.has(remoteName)) {
      errors.remoteName = "Each Azure DevOps remote mapping must use a different remote name.";
    }
    remoteNames.add(remoteName);
    return errors;
  });
};
