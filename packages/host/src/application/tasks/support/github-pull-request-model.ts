import type { GitProviderRepository, PullRequest } from "@openducktor/contracts";
import { pullRequestSchema } from "@openducktor/contracts";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";

export const GITHUB_PROVIDER_ID = "github";
export const GH_NON_INTERACTIVE_ENV = { GH_PROMPT_DISABLED: "1" };

export const repositoryKey = (repository: { host: string; owner: string; name: string }): string =>
  `${repository.host}/${repository.owner}/${repository.name}`.toLowerCase();

export const combinedCommandOutput = (stdout: string, stderr: string): string => {
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();
  if (!trimmedStdout) {
    return trimmedStderr;
  }
  if (!trimmedStderr) {
    return trimmedStdout;
  }
  return `${trimmedStdout}\n${trimmedStderr}`;
};

export type GithubPullBranchRef = {
  ref?: unknown;
};

export type GithubPullResponse = {
  number?: unknown;
  html_url?: unknown;
  draft?: unknown;
  state?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  merged_at?: unknown;
  closed_at?: unknown;
  head?: GithubPullBranchRef;
  base?: GithubPullBranchRef;
};

export type ResolvedPullRequest = {
  record: PullRequest;
  sourceBranch: string;
  targetBranch: string;
};

export type GithubPullRequestContext = {
  repository: GitProviderRepository;
  remoteName: string;
};

export type GithubPullRequestSyncPolicy = {
  providerId: typeof GITHUB_PROVIDER_ID;
  available: boolean;
  repository?: GitProviderRepository;
};

const requireGithubString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HostValidationError({
      field: label,
      message: `GitHub pull request response field ${label} is missing or invalid.`,
    });
  }
  return value;
};

const requireGithubNumber = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new HostValidationError({
      field: label,
      message: `GitHub pull request response field ${label} is missing or invalid.`,
    });
  }
  return value;
};

const normalizeGithubPullRequest = (response: GithubPullResponse): ResolvedPullRequest => {
  const mergedAt = typeof response.merged_at === "string" ? response.merged_at : undefined;
  const closedAt = typeof response.closed_at === "string" ? response.closed_at : undefined;
  const rawState = requireGithubString(response.state, "state").trim().toLowerCase();
  const state =
    mergedAt !== undefined
      ? "merged"
      : response.draft === true
        ? "draft"
        : rawState === "open"
          ? "open"
          : "closed_unmerged";
  return {
    record: pullRequestSchema.parse({
      providerId: GITHUB_PROVIDER_ID,
      number: requireGithubNumber(response.number, "number"),
      url: requireGithubString(response.html_url, "html_url"),
      state,
      createdAt: requireGithubString(response.created_at, "created_at"),
      updatedAt: requireGithubString(response.updated_at, "updated_at"),
      lastSyncedAt: new Date().toISOString(),
      mergedAt,
      closedAt,
    }),
    sourceBranch: requireGithubString(response.head?.ref, "head.ref"),
    targetBranch: requireGithubString(response.base?.ref, "base.ref"),
  };
};

export const parseGithubPullListResponse = (payload: string): ResolvedPullRequest[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub pull request list response: ${errorMessage(error)}`,
      cause: error,
    });
  }
  const responses = Array.isArray(parsed) ? parsed : undefined;
  if (!responses) {
    throw new HostValidationError({
      field: "payload",
      message: "Failed to parse GitHub pull request list response: expected an array.",
    });
  }
  const flattened = responses.every((entry) => Array.isArray(entry)) ? responses.flat() : responses;
  return flattened.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HostValidationError({
        field: "payload",
        message: "Failed to parse GitHub pull request list response: expected objects.",
      });
    }
    return normalizeGithubPullRequest(entry as GithubPullResponse);
  });
};

export const parseGithubPullResponse = (payload: string): ResolvedPullRequest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub pull request response: ${errorMessage(error)}`,
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HostValidationError({
      field: "payload",
      message: "Failed to parse GitHub pull request response: expected an object.",
    });
  }
  return normalizeGithubPullRequest(parsed as GithubPullResponse);
};

const comparablePullRequestRecord = ({
  lastSyncedAt: _lastSyncedAt,
  ...pullRequest
}: PullRequest): Omit<PullRequest, "lastSyncedAt"> => pullRequest;

export const pullRequestRecordsMatch = (left: PullRequest, right: PullRequest): boolean =>
  JSON.stringify(comparablePullRequestRecord(left)) ===
  JSON.stringify(comparablePullRequestRecord(right));

export const isEditablePullRequest = (pullRequest: PullRequest | undefined): boolean =>
  pullRequest?.providerId === GITHUB_PROVIDER_ID &&
  (pullRequest.state === "open" || pullRequest.state === "draft");
