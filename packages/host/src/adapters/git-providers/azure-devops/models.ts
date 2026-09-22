import { type AzureDevOpsRepository, type PullRequest } from "@openducktor/contracts";
import { azureDevOpsRepositoryKey, azureDevOpsResolvedRepositoryIdentity } from "@openducktor/core";
import { HostValidationError } from "../../../effect/host-errors";
import type { ProviderPullRequest } from "../../../ports/git-provider-port";
import {
  azureDevOpsJsonRecordSchema,
  azureDevOpsNonEmptyStringSchema,
  azureDevOpsPositiveIntegerSchema,
  azureDevOpsTimestampSchema,
  type AzureDevOpsJson,
  type AzureDevOpsJsonRecord,
} from "./json";
import { azureDevOpsProjectUrl } from "./repository-identity";

const jsonRecordSchema = azureDevOpsJsonRecordSchema;

export type ResolvedAzureDevOpsRepository = AzureDevOpsRepository & {
  projectId: string;
  repositoryId: string;
};

export const parseAzureRepository = (
  value: AzureDevOpsJson | undefined,
  configured: AzureDevOpsRepository,
): ResolvedAzureDevOpsRepository => {
  const record = requireRecord(value, "repository");
  const project = requireRecord(record.project, "repository.project");
  const resolved = {
    ...configured,
    name: requireString(record.name, "repository.name"),
    repositoryId: requireString(record.id, "repository.id"),
    project: requireString(project.name, "repository.project.name"),
    projectId: requireString(project.id, "repository.project.id"),
  } satisfies ResolvedAzureDevOpsRepository;
  if (azureDevOpsRepositoryKey(resolved) !== azureDevOpsRepositoryKey(configured)) {
    throw new HostValidationError({
      field: "git.provider.repository",
      message: "Azure DevOps returned a different repository than the configured identity.",
    });
  }
  return resolved;
};

export const parseAzurePullRequest = (
  value: AzureDevOpsJson | undefined,
  configured: AzureDevOpsRepository,
  observedAt = new Date().toISOString(),
): ProviderPullRequest => {
  const record = requireRecord(value, "pullRequest");
  const repository = parseAzureRepository(record.repository, configured);
  const number = requirePositiveInteger(record.pullRequestId, "pullRequest.pullRequestId");
  const status = requireString(record.status, "pullRequest.status");
  const sourceBranch = stripHeadRef(
    requireString(record.sourceRefName, "pullRequest.sourceRefName"),
  );
  const targetBranch = stripHeadRef(
    requireString(record.targetRefName, "pullRequest.targetRefName"),
  );
  const createdAt = requireTimestamp(record.creationDate, "pullRequest.creationDate");
  const closedAt = optionalTimestamp(record.closedDate, "pullRequest.closedDate");
  const state = azurePullRequestState(status, record.isDraft === true);
  const url = pullRequestWebUrl(record, repository, number);
  const pullRequest: PullRequest = {
    providerId: "azure_devops",
    repositoryIdentity: azureDevOpsResolvedRepositoryIdentity(repository),
    number,
    url,
    state,
    createdAt,
    updatedAt: closedAt ?? observedAt,
  };
  if (state === "merged" && closedAt) pullRequest.mergedAt = closedAt;
  if (state === "closed_unmerged" && closedAt) pullRequest.closedAt = closedAt;
  return { record: pullRequest, sourceBranch, targetBranch };
};

export const requireAzureLinkedRepository = (
  pullRequest: PullRequest,
  repository?: ResolvedAzureDevOpsRepository,
): void => {
  if (pullRequest.providerId !== "azure_devops") {
    throw new HostValidationError({
      field: "pullRequest.providerId",
      message: `Pull request provider '${pullRequest.providerId}' does not match configured provider 'azure_devops'.`,
    });
  }
  if (!pullRequest.repositoryIdentity) {
    throw new HostValidationError({
      field: "pullRequest.repositoryIdentity",
      message:
        "The linked Azure DevOps pull request has no repository identity. Unlink it and link it again before retrying.",
    });
  }
  if (
    repository &&
    pullRequest.repositoryIdentity !== azureDevOpsResolvedRepositoryIdentity(repository)
  ) {
    throw new HostValidationError({
      field: "pullRequest.repositoryIdentity",
      message:
        "The linked Azure DevOps pull request belongs to another repository. Restore the original repository settings or unlink it and link the correct pull request.",
    });
  }
};

export const headRef = (branch: string): string =>
  branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;

export const stripHeadRef = (branch: string): string =>
  branch.startsWith("refs/heads/") ? branch.slice("refs/heads/".length) : branch;

export const requireRecord = (
  value: AzureDevOpsJson | undefined,
  field: string,
): AzureDevOpsJsonRecord => {
  const parsed = jsonRecordSchema.safeParse(value);
  if (!parsed.success) throw malformed(field);
  return parsed.data;
};

export const optionalRecord = (value: AzureDevOpsJson | undefined): AzureDevOpsJsonRecord | null =>
  jsonRecordSchema.safeParse(value).data ?? null;

export const requireString = (value: AzureDevOpsJson | undefined, field: string): string => {
  const parsed = azureDevOpsNonEmptyStringSchema.safeParse(value);
  if (!parsed.success) throw malformed(field);
  return parsed.data;
};

export const optionalString = (value: AzureDevOpsJson | undefined): string | null =>
  azureDevOpsNonEmptyStringSchema.safeParse(value).data ?? null;

export const requirePositiveInteger = (
  value: AzureDevOpsJson | undefined,
  field: string,
): number => {
  const parsed = azureDevOpsPositiveIntegerSchema.safeParse(value);
  if (!parsed.success) throw malformed(field);
  return parsed.data;
};

const requireTimestamp = (value: AzureDevOpsJson | undefined, field: string): string => {
  const parsed = azureDevOpsTimestampSchema.safeParse(value);
  if (!parsed.success) throw malformed(field);
  return parsed.data;
};

const optionalTimestamp = (
  value: AzureDevOpsJson | undefined,
  field: string,
): string | undefined =>
  value === undefined || value === null ? undefined : requireTimestamp(value, field);

const azurePullRequestState = (status: string, draft: boolean): PullRequest["state"] => {
  if (status === "active") {
    return draft ? "draft" : "open";
  }
  if (status === "completed") {
    return "merged";
  }
  if (status === "abandoned") {
    return "closed_unmerged";
  }
  throw new HostValidationError({
    field: "pullRequest.status",
    message: `Azure DevOps returned unsupported pull request state '${status}'.`,
  });
};

const pullRequestWebUrl = (
  record: AzureDevOpsJsonRecord,
  repository: AzureDevOpsRepository,
  number: number,
): string => {
  const links = jsonRecordSchema.safeParse(record._links).data;
  const web = jsonRecordSchema.safeParse(links?.web).data;
  const href = optionalString(web?.href);
  if (href) {
    return href;
  }
  return `${azureDevOpsProjectUrl(repository)}/_git/${encodeURIComponent(repository.name)}/pullrequest/${number}`;
};

const malformed = (field: string): HostValidationError =>
  new HostValidationError({
    field,
    message: `Azure DevOps returned a malformed ${field} value.`,
  });
