import type { GitProviderRepository, JsonValue, PullRequest } from "@openducktor/contracts";
import { pullRequestSchema, hasRuntimeType, jsonValueSchema } from "@openducktor/contracts";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";

export const GITHUB_PROVIDER_ID = "github";

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

export type GithubPullBranchRef = Record<string, JsonValue>;

export type GithubPullResponse = Record<string, JsonValue>;

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

const requireGithubString = (value: JsonValue | undefined, label: string): string => {
  if (!hasRuntimeType(value, "string") || value.trim().length === 0) {
    throw new HostValidationError({
      field: label,
      message: `GitHub pull request response field ${label} is missing or invalid.`,
    });
  }
  return value;
};

const requireGithubNumber = (value: JsonValue | undefined, label: string): number => {
  if (!Number.isInteger(value) || !hasRuntimeType(value, "number") || value <= 0) {
    throw new HostValidationError({
      field: label,
      message: `GitHub pull request response field ${label} is missing or invalid.`,
    });
  }
  return value;
};

const isJsonRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeGithubPullRequest = (response: GithubPullResponse): ResolvedPullRequest => {
  const mergedAt = hasRuntimeType(response.merged_at, "string") ? response.merged_at : undefined;
  const closedAt = hasRuntimeType(response.closed_at, "string") ? response.closed_at : undefined;
  const rawState = requireGithubString(response.state, "state").trim().toLowerCase();
  const state =
    mergedAt !== undefined
      ? "merged"
      : response.draft === true
        ? "draft"
        : rawState === "open"
          ? "open"
          : "closed_unmerged";
  const head = isJsonRecord(response.head) ? response.head : undefined;
  const base = isJsonRecord(response.base) ? response.base : undefined;
  return {
    record: pullRequestSchema.parse({
      providerId: GITHUB_PROVIDER_ID,
      number: requireGithubNumber(response.number, "number"),
      url: requireGithubString(response.html_url, "html_url"),
      state,
      createdAt: requireGithubString(response.created_at, "created_at"),
      updatedAt: requireGithubString(response.updated_at, "updated_at"),
      lastSyncedAt: new Date().toISOString(),
      ...(mergedAt !== undefined ? { mergedAt } : undefined),
      ...(closedAt !== undefined ? { closedAt } : undefined),
    }),
    sourceBranch: requireGithubString(head?.ref, "head.ref"),
    targetBranch: requireGithubString(base?.ref, "base.ref"),
  };
};

export const parseGithubPullListResponse = (payload: string): ResolvedPullRequest[] => {
  let parsed: JsonValue;
  try {
    parsed = jsonValueSchema.parse(JSON.parse(payload));
  } catch (cause) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub pull request list response: ${errorMessage(cause)}`,
      cause,
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
    if (!isJsonRecord(entry)) {
      throw new HostValidationError({
        field: "payload",
        message: "Failed to parse GitHub pull request list response: expected objects.",
      });
    }
    return normalizeGithubPullRequest(entry);
  });
};

export const parseGithubPullResponse = (payload: string): ResolvedPullRequest => {
  let parsed: JsonValue;
  try {
    parsed = jsonValueSchema.parse(JSON.parse(payload));
  } catch (cause) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub pull request response: ${errorMessage(cause)}`,
      cause,
    });
  }
  if (!isJsonRecord(parsed)) {
    throw new HostValidationError({
      field: "payload",
      message: "Failed to parse GitHub pull request response: expected an object.",
    });
  }
  return normalizeGithubPullRequest(parsed);
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
