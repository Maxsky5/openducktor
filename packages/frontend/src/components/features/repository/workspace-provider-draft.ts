import {
  gitProviderConfigSchema,
  githubGitProviderRepositorySchema,
  type GitProviderConfig,
  type WorkspaceProviderSetupSelection,
} from "@openducktor/contracts";
import {
  buildAzureRepositoryDraft,
  buildAzureRemoteMappingDrafts,
  parseAzureRepositoryDraft,
  toAzureRemoteMappings,
  azureDevOpsHttpConsentCollectionUrl,
  azureRepositoryDraftErrors,
  type AzureRepositoryDraft,
  type AzureRemoteMappingDraft,
} from "../settings/azure-devops-git-provider-form-model";

export type WorkspaceProviderDraft = {
  providerId: "github" | "azure_devops" | null;
  enabled: boolean;
  autoDetected: boolean;
  github: { host: string; owner: string; name: string };
  azure: AzureRepositoryDraft;
  mappings: AzureRemoteMappingDraft[];
  consent: string | null;
  areaPath: string;
};
export const emptyWorkspaceProviderDraft = (): WorkspaceProviderDraft => ({
  providerId: null,
  enabled: true,
  autoDetected: false,
  github: { host: "github.com", owner: "", name: "" },
  azure: buildAzureRepositoryDraft(undefined),
  mappings: [],
  consent: null,
  areaPath: "",
});
export const detectedWorkspaceProviderDraft = (
  config: GitProviderConfig,
): WorkspaceProviderDraft => {
  const draft = emptyWorkspaceProviderDraft();
  if (config.id !== "github" && config.id !== "azure_devops")
    throw new Error("Unsupported Git provider.");
  draft.providerId = config.id;
  draft.enabled = config.enabled;
  draft.autoDetected = config.autoDetected;
  const repository = config.repository;
  if (repository && "deployment" in repository) {
    draft.azure = buildAzureRepositoryDraft(repository);
    draft.mappings = buildAzureRemoteMappingDrafts(config.settings?.remoteMappings);
    draft.consent = config.settings?.httpConsentCollectionUrl ?? null;
    draft.areaPath = config.settings?.areaPath ?? "";
  } else if (repository) draft.github = repository;
  return draft;
};
type WorkspaceProviderDraftResult = {
  selection: WorkspaceProviderSetupSelection;
  errors: Record<string, string>;
};
export const parseWorkspaceProviderDraft = (
  draft: WorkspaceProviderDraft,
): WorkspaceProviderDraftResult => {
  if (!draft.providerId) return { selection: { kind: "none" }, errors: {} };
  const emptyIdentity =
    draft.providerId === "github"
      ? !draft.github.owner.trim() && !draft.github.name.trim()
      : !draft.azure.organization.trim() &&
        !draft.azure.project.trim() &&
        !draft.azure.name.trim() &&
        (draft.azure.deployment === "services" || !draft.azure.serviceUrl.trim());
  const azure = parseAzureRepositoryDraft(draft.azure);
  const repository =
    draft.providerId === "github" ? draft.github : { providerId: "azure_devops", ...draft.azure };
  const config = {
    id: draft.providerId,
    enabled: draft.enabled,
    autoDetected: draft.autoDetected,
  };
  if (draft.enabled || !emptyIdentity || draft.mappings.length)
    Object.assign(config, { repository });
  if (draft.providerId === "azure_devops") {
    const settings = {};
    if (draft.mappings.length)
      Object.assign(settings, {
        remoteMappings: azure.success
          ? toAzureRemoteMappings(draft.mappings, azure.data)
          : draft.mappings,
      });
    if (draft.areaPath.trim()) Object.assign(settings, { areaPath: draft.areaPath.trim() });
    if (draft.consent) Object.assign(settings, { httpConsentCollectionUrl: draft.consent });
    Object.assign(config, { settings });
  }
  const parsed = gitProviderConfigSchema.safeParse(config);
  const errors: Record<string, string> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) errors[issue.path.join(".")] ??= issue.message;
  if (draft.providerId === "github" && (draft.enabled || !emptyIdentity)) {
    const identity = githubGitProviderRepositorySchema.safeParse(draft.github);
    if (!identity.success)
      for (const issue of identity.error.issues)
        errors[`repository.${issue.path.join(".")}`] = issue.message;
  }
  if (
    draft.providerId === "github" &&
    !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(draft.github.host.trim())
  )
    errors["repository.host"] = "Enter a GitHub host name without a protocol or path.";
  if (draft.providerId === "azure_devops" && (draft.enabled || !emptyIdentity)) {
    const serviceError = azureRepositoryDraftErrors(draft.azure).serviceUrl;
    if (serviceError) errors["repository.serviceUrl"] = serviceError;
  }
  if (parsed.success && !Object.keys(errors).length)
    return { selection: { kind: "configured", config: parsed.data }, errors };
  return { selection: { kind: "incomplete", providerId: draft.providerId }, errors };
};
export const httpConsentUrl = (draft: WorkspaceProviderDraft): string | null => {
  const parsed = parseAzureRepositoryDraft(draft.azure);
  return parsed.success ? azureDevOpsHttpConsentCollectionUrl(parsed.data) : null;
};
