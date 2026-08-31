import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderRepository,
  type PullRequest,
  pullRequestSchema,
} from "@openducktor/contracts";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import { parseJson } from "../../../effect/json";
import { z, type JSONType } from "zod";

export const GITHUB_PROVIDER_ID = GITHUB_PROVIDER_DESCRIPTOR.id;

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

const nonBlankStringSchema = z
  .string()
  .refine((value) => value.length > 0 && value === value.trim(), {
    error: "String must not be blank or padded with whitespace",
  });

const githubPullBranchRefSchema = z.object({
  ref: nonBlankStringSchema,
});

const githubPullResponseSchema = z.object({
  number: z.number().int().positive(),
  html_url: nonBlankStringSchema,
  state: nonBlankStringSchema,
  draft: z.boolean().optional(),
  created_at: nonBlankStringSchema,
  updated_at: nonBlankStringSchema,
  merged_at: nonBlankStringSchema.nullable().optional(),
  closed_at: nonBlankStringSchema.nullable().optional(),
  head: githubPullBranchRefSchema,
  base: githubPullBranchRefSchema,
});

export type GithubPullBranchRef = z.infer<typeof githubPullBranchRefSchema>;

export type GithubPullResponse = z.infer<typeof githubPullResponseSchema>;

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

const parseGithubPullPayload = (value: JSONType): GithubPullResponse => {
  const parsed = githubPullResponseSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  const field = parsed.error.issues[0]?.path.join(".") || "payload";
  throw new HostValidationError({
    field,
    message: `GitHub pull request response field ${field} is missing or invalid.`,
    cause: parsed.error,
  });
};

const normalizeGithubPullRequest = (response: GithubPullResponse): ResolvedPullRequest => {
  const mergedAt = response.merged_at ?? undefined;
  const closedAt = response.closed_at ?? undefined;
  const rawState = response.state.toLowerCase();
  const state =
    mergedAt !== undefined
      ? "merged"
      : response.draft === true
        ? "draft"
        : rawState === "open"
          ? "open"
          : "closed_unmerged";
  const recordInput: z.input<typeof pullRequestSchema> = {
    providerId: GITHUB_PROVIDER_ID,
    number: response.number,
    url: response.html_url,
    state,
    createdAt: response.created_at,
    updatedAt: response.updated_at,
    lastSyncedAt: new Date().toISOString(),
  };
  if (mergedAt !== undefined) {
    recordInput.mergedAt = mergedAt;
  }
  if (closedAt !== undefined) {
    recordInput.closedAt = closedAt;
  }
  return {
    record: pullRequestSchema.parse(recordInput),
    sourceBranch: response.head.ref,
    targetBranch: response.base.ref,
  };
};

export const parseGithubPullListResponse = (payload: string): ResolvedPullRequest[] => {
  let parsed: JSONType;
  try {
    parsed = parseJson(payload);
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
    return normalizeGithubPullRequest(parseGithubPullPayload(entry));
  });
};

export const parseGithubPullResponse = (payload: string): ResolvedPullRequest => {
  let parsed: JSONType;
  try {
    parsed = parseJson(payload);
  } catch (cause) {
    throw new HostValidationError({
      field: "payload",
      message: `Failed to parse GitHub pull request response: ${errorMessage(cause)}`,
      cause,
    });
  }
  return normalizeGithubPullRequest(parseGithubPullPayload(parsed));
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
