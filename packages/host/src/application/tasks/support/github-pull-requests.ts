import type {
  GitProviderAvailability,
  GitProviderRepository,
  PullRequest,
  RepoConfig,
  TaskApprovalContext,
} from "@openducktor/contracts";
import { pullRequestSchema } from "@openducktor/contracts";
import { checkoutBranch } from "../../../domain/task";
import type { GitPort } from "../../../ports/git-port";
import type { SystemCommandPort, SystemCommandRunResult } from "../../../ports/system-command-port";
import { parseGithubRemoteUrl } from "../../git/github-repository-detection-service";
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
export const githubProviderStatus = async (
  dependencies: {
    gitPort: GitPort;
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  repoConfig: RepoConfig,
): Promise<GitProviderAvailability> => {
  const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
  if (!providerConfig?.enabled) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: false,
      available: false,
      reason: "GitHub provider is not enabled for this repository.",
    };
  }
  const ghError = await dependencies.systemCommands.requiredCommandError("gh");
  if (ghError !== null) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason: "gh CLI is not installed.",
    };
  }
  const repository = providerConfig.repository;
  if (!repository) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason: "GitHub repository coordinates are missing.",
    };
  }
  let authStatus: SystemCommandRunResult;
  try {
    authStatus = await dependencies.systemCommands.runCommandAllowFailure(
      "gh",
      ["auth", "status", "--hostname", repository.host],
      { env: GH_NON_INTERACTIVE_ENV },
    );
  } catch (error) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason: `Failed to check GitHub authentication: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (!authStatus.ok) {
    const output = combinedCommandOutput(authStatus.stdout, authStatus.stderr);
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason:
        output.length > 0
          ? output
          : "GitHub authentication is not configured. Run `gh auth login`.",
    };
  }
  const expectedKey = repositoryKey(repository);
  const hasMatchingRemote = (await dependencies.gitPort.listRemotes(repoPath)).some((remote) => {
    const parsed = parseGithubRemoteUrl(remote.url);
    return parsed !== null && repositoryKey(parsed) === expectedKey;
  });
  if (!hasMatchingRemote) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason: `No matching Git remote is configured for ${repository.owner}/${repository.name} on ${repository.host}.`,
    };
  }
  return {
    providerId: GITHUB_PROVIDER_ID,
    enabled: true,
    available: true,
  };
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
export const requireGithubString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`GitHub pull request response field ${label} is missing or invalid.`);
  }
  return value;
};
export const requireGithubNumber = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new Error(`GitHub pull request response field ${label} is missing or invalid.`);
  }
  return value;
};
export const normalizeGithubPullRequest = (response: GithubPullResponse): ResolvedPullRequest => {
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
    throw new Error(
      `Failed to parse GitHub pull request list response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const responses = Array.isArray(parsed) ? parsed : undefined;
  if (!responses) {
    throw new Error("Failed to parse GitHub pull request list response: expected an array.");
  }
  const flattened = responses.every((entry) => Array.isArray(entry)) ? responses.flat() : responses;
  return flattened.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Failed to parse GitHub pull request list response: expected objects.");
    }
    return normalizeGithubPullRequest(entry as GithubPullResponse);
  });
};
export const parseGithubPullResponse = (payload: string): ResolvedPullRequest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `Failed to parse GitHub pull request response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Failed to parse GitHub pull request response: expected an object.");
  }

  return normalizeGithubPullRequest(parsed as GithubPullResponse);
};

export const runGithubCommand = async (
  systemCommands: SystemCommandPort,
  repoPath: string,
  host: string,
  args: string[],
): Promise<string> => {
  const hostArgs = host.trim() ? ["--hostname", host.trim(), ...args] : args;
  const result = await systemCommands.runCommandAllowFailure("gh", hostArgs, {
    cwd: repoPath,
    env: GH_NON_INTERACTIVE_ENV,
  });
  if (result.ok) {
    return result.stdout;
  }

  throw new Error(combinedCommandOutput(result.stdout, result.stderr) || "gh command failed.");
};

export const matchingGithubRemoteNames = async (
  gitPort: GitPort,
  repoPath: string,
  repository: GitProviderRepository,
): Promise<string[]> => {
  const expectedKey = repositoryKey(repository);
  return (await gitPort.listRemotes(repoPath)).flatMap((remote) => {
    const parsed = parseGithubRemoteUrl(remote.url);
    return parsed !== null && repositoryKey(parsed) === expectedKey ? [remote.name] : [];
  });
};

export const requireSingleGithubRemoteName = async (
  gitPort: GitPort,
  repoPath: string,
  repository: GitProviderRepository,
): Promise<string> => {
  const matches = await matchingGithubRemoteNames(gitPort, repoPath, repository);
  if (matches.length === 1) {
    return matches[0] ?? "";
  }
  if (matches.length === 0) {
    throw new Error(
      `No git remote matches the configured GitHub repository ${repository.host}:${repository.owner}/${repository.name}.`,
    );
  }

  throw new Error(
    `Multiple git remotes match the configured GitHub repository ${repository.host}:${repository.owner}/${repository.name}: ${matches.join(", ")}. Configure a single matching remote before opening or updating a pull request.`,
  );
};

export const probeGithubAuthOrThrow = async (
  systemCommands: SystemCommandPort,
  host: string,
): Promise<void> => {
  const result = await systemCommands.runCommandAllowFailure(
    "gh",
    ["auth", "status", "--hostname", host],
    { env: GH_NON_INTERACTIVE_ENV },
  );
  if (result.ok) {
    return;
  }
  throw new Error(
    combinedCommandOutput(result.stdout, result.stderr) ||
      "GitHub authentication is not configured. Run `gh auth login`.",
  );
};

export const requireGithubPullRequestContext = async (
  dependencies: {
    gitPort: GitPort;
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  repoConfig: RepoConfig,
): Promise<GithubPullRequestContext> => {
  const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
  if (!providerConfig?.enabled) {
    throw new Error("GitHub pull request support is not enabled for this repository.");
  }
  const ghError = await dependencies.systemCommands.requiredCommandError("gh");
  if (ghError !== null) {
    throw new Error("GitHub pull request support requires the gh CLI to be installed.");
  }

  const repository = providerConfig.repository;
  if (!repository) {
    throw new Error("GitHub pull request support requires repository coordinates.");
  }
  await probeGithubAuthOrThrow(dependencies.systemCommands, repository.host);
  const remoteName = await requireSingleGithubRemoteName(
    dependencies.gitPort,
    repoPath,
    repository,
  );

  return { repository, remoteName };
};

export const selectGithubPullRequestForBranch = (
  pullRequests: ResolvedPullRequest[],
  sourceBranch: string,
  state: "open" | "all",
): ResolvedPullRequest | undefined => {
  if (state === "all") {
    return pullRequests
      .filter((pullRequest) => pullRequest.record.state === "merged")
      .sort((left, right) => left.record.updatedAt.localeCompare(right.record.updatedAt))
      .at(-1);
  }

  if (pullRequests.length > 1) {
    throw new Error(
      `Multiple pull requests were found for branch ${sourceBranch} while querying state=open.`,
    );
  }
  return pullRequests[0];
};

export const findGithubPullRequestForBranch = async (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  context: GithubPullRequestContext,
  sourceBranch: string,
  state: "open" | "all",
): Promise<ResolvedPullRequest | undefined> => {
  const repoSlug = `${context.repository.owner}/${context.repository.name}`;
  const payload = await runGithubCommand(
    dependencies.systemCommands,
    repoPath,
    context.repository.host,
    [
      "api",
      "--method",
      "GET",
      `repos/${repoSlug}/pulls`,
      "-f",
      `state=${state}`,
      "-f",
      `head=${context.repository.owner}:${sourceBranch}`,
    ],
  );
  return selectGithubPullRequestForBranch(
    parseGithubPullListResponse(payload),
    sourceBranch,
    state,
  );
};

export const fetchGithubPullRequestByNumber = async (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  context: GithubPullRequestContext,
  number: number,
): Promise<ResolvedPullRequest> => {
  const repoSlug = `${context.repository.owner}/${context.repository.name}`;
  const payload = await runGithubCommand(
    dependencies.systemCommands,
    repoPath,
    context.repository.host,
    ["api", `repos/${repoSlug}/pulls/${number}`],
  );
  return parseGithubPullResponse(payload);
};

export type GithubPullRequestSyncPolicy = {
  providerId: typeof GITHUB_PROVIDER_ID;
  available: boolean;
  repository?: GitProviderRepository;
};

export const githubPullRequestSyncPolicy = async (
  systemCommands: SystemCommandPort,
  repoConfig: RepoConfig,
): Promise<GithubPullRequestSyncPolicy> => {
  const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
  const ghError =
    providerConfig?.enabled === true ? await systemCommands.requiredCommandError("gh") : "missing";

  const policy: GithubPullRequestSyncPolicy = {
    providerId: GITHUB_PROVIDER_ID,
    available: providerConfig?.enabled === true && ghError === null,
  };
  if (providerConfig?.repository) {
    policy.repository = providerConfig.repository;
  }

  return policy;
};

export const fetchLinkedPullRequest = async (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  policy: GithubPullRequestSyncPolicy,
  pullRequest: PullRequest,
): Promise<ResolvedPullRequest | undefined> => {
  if (pullRequest.providerId !== policy.providerId || !policy.repository) {
    return undefined;
  }

  return fetchGithubPullRequestByNumber(
    dependencies,
    repoPath,
    { repository: policy.repository, remoteName: "" },
    pullRequest.number,
  );
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

export const upsertGithubPullRequest = async (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  context: GithubPullRequestContext,
  approval: TaskApprovalContext,
  title: string,
  body: string,
): Promise<PullRequest> => {
  const repoSlug = `${context.repository.owner}/${context.repository.name}`;
  const existingPullRequest = approval.pullRequest;
  const args =
    existingPullRequest !== undefined && isEditablePullRequest(existingPullRequest)
      ? [
          "api",
          "--method",
          "PATCH",
          `repos/${repoSlug}/pulls/${existingPullRequest.number}`,
          "-f",
          `title=${title.trim()}`,
          "-f",
          `body=${body}`,
        ]
      : [
          "api",
          "--method",
          "POST",
          `repos/${repoSlug}/pulls`,
          "-f",
          `title=${title.trim()}`,
          "-f",
          `head=${approval.sourceBranch}`,
          "-f",
          `base=${checkoutBranch(approval.targetBranch)}`,
          "-f",
          `body=${body}`,
        ];
  const payload = await runGithubCommand(
    dependencies.systemCommands,
    repoPath,
    context.repository.host,
    args,
  );

  return parseGithubPullResponse(payload).record;
};
