import type {
  GitProviderRepository,
  PullRequest,
  RepoConfig,
  TaskApprovalContext,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { checkoutBranch } from "../../../domain/task";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SystemCommandPort, SystemCommandRunResult } from "../../../ports/system-command-port";
import { parseGithubRemoteUrl } from "../../git/github-repository-detection-service";
import {
  combinedCommandOutput,
  GH_NON_INTERACTIVE_ENV,
  GITHUB_PROVIDER_ID,
  type GithubPullRequestContext,
  type GithubPullRequestSyncPolicy,
  isEditablePullRequest,
  parseGithubPullListResponse,
  parseGithubPullResponse,
  type ResolvedPullRequest,
  repositoryKey,
} from "./github-pull-request-model";

export {
  combinedCommandOutput,
  GH_NON_INTERACTIVE_ENV,
  GITHUB_PROVIDER_ID,
  type GithubPullBranchRef,
  type GithubPullRequestContext,
  type GithubPullRequestSyncPolicy,
  type GithubPullResponse,
  isEditablePullRequest,
  normalizeGithubPullRequest,
  parseGithubPullListResponse,
  parseGithubPullResponse,
  pullRequestRecordsMatch,
  type ResolvedPullRequest,
  repositoryKey,
  requireGithubNumber,
  requireGithubString,
} from "./github-pull-request-model";
export const githubProviderStatus = (
  dependencies: {
    gitPort: GitPort;
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
    if (!providerConfig?.enabled) {
      return {
        providerId: GITHUB_PROVIDER_ID,
        enabled: false,
        available: false,
        reason: "GitHub provider is not enabled for this repository.",
      };
    }
    const ghError = yield* dependencies.systemCommands.requiredCommandError("gh");
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
    const authStatusResult = yield* Effect.either(
      dependencies.systemCommands.runCommandAllowFailure(
        "gh",
        ["auth", "status", "--hostname", repository.host],
        { env: GH_NON_INTERACTIVE_ENV },
      ),
    );
    if (authStatusResult._tag === "Left") {
      return {
        providerId: GITHUB_PROVIDER_ID,
        enabled: true,
        available: false,
        reason: `Failed to check GitHub authentication: ${errorMessage(authStatusResult.left)}`,
      };
    }
    const authStatus: SystemCommandRunResult = authStatusResult.right;
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
    const hasMatchingRemote = (yield* dependencies.gitPort.listRemotes(repoPath)).some((remote) => {
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
  });
export const runGithubCommand = (
  systemCommands: SystemCommandPort,
  repoPath: string,
  host: string,
  args: string[],
) =>
  Effect.gen(function* () {
    const hostArgs = host.trim() ? ["--hostname", host.trim(), ...args] : args;
    const result = yield* systemCommands.runCommandAllowFailure("gh", hostArgs, {
      cwd: repoPath,
      env: GH_NON_INTERACTIVE_ENV,
    });
    if (result.ok) {
      return result.stdout;
    }
    return yield* Effect.fail(
      new HostValidationError({
        field: "gh",
        message: combinedCommandOutput(result.stdout, result.stderr) || "gh command failed.",
        details: { repoPath },
      }),
    );
  });
export const matchingGithubRemoteNames = (
  gitPort: GitPort,
  repoPath: string,
  repository: GitProviderRepository,
) =>
  Effect.gen(function* () {
    const expectedKey = repositoryKey(repository);
    return (yield* gitPort.listRemotes(repoPath)).flatMap((remote) => {
      const parsed = parseGithubRemoteUrl(remote.url);
      return parsed !== null && repositoryKey(parsed) === expectedKey ? [remote.name] : [];
    });
  });
export const requireSingleGithubRemoteName = (
  gitPort: GitPort,
  repoPath: string,
  repository: GitProviderRepository,
) =>
  Effect.gen(function* () {
    const matches = yield* matchingGithubRemoteNames(gitPort, repoPath, repository);
    if (matches.length === 1) {
      return matches[0] ?? "";
    }
    if (matches.length === 0) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.providers.github.repository",
          message: `No git remote matches the configured GitHub repository ${repository.host}:${repository.owner}/${repository.name}.`,
          details: { repoPath },
        }),
      );
    }
    return yield* Effect.fail(
      new HostValidationError({
        field: "git.providers.github.repository",
        message: `Multiple git remotes match the configured GitHub repository ${repository.host}:${repository.owner}/${repository.name}: ${matches.join(", ")}. Configure a single matching remote before opening or updating a pull request.`,
        details: { repoPath, matches },
      }),
    );
  });
export const probeGithubAuthOrThrow = (systemCommands: SystemCommandPort, host: string) =>
  Effect.gen(function* () {
    const result = yield* systemCommands.runCommandAllowFailure(
      "gh",
      ["auth", "status", "--hostname", host],
      {
        env: GH_NON_INTERACTIVE_ENV,
      },
    );
    if (result.ok) {
      return;
    }
    return yield* Effect.fail(
      new HostValidationError({
        field: "github.auth",
        message:
          combinedCommandOutput(result.stdout, result.stderr) ||
          "GitHub authentication is not configured. Run `gh auth login`.",
        details: { host },
      }),
    );
  });
export const requireGithubPullRequestContext = (
  dependencies: {
    gitPort: GitPort;
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
    if (!providerConfig?.enabled) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.providers.github.enabled",
          message: "GitHub pull request support is not enabled for this repository.",
          details: { repoPath },
        }),
      );
    }
    const ghError = yield* dependencies.systemCommands.requiredCommandError("gh");
    if (ghError !== null) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "gh",
          message: "GitHub pull request support requires the gh CLI to be installed.",
          details: { repoPath },
        }),
      );
    }
    const repository = providerConfig.repository;
    if (!repository) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.providers.github.repository",
          message: "GitHub pull request support requires repository coordinates.",
          details: { repoPath },
        }),
      );
    }
    yield* probeGithubAuthOrThrow(dependencies.systemCommands, repository.host);
    const remoteName = yield* requireSingleGithubRemoteName(
      dependencies.gitPort,
      repoPath,
      repository,
    );
    return { repository, remoteName };
  });
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
    throw new HostValidationError({
      field: "sourceBranch",
      message: `Multiple pull requests were found for branch ${sourceBranch} while querying state=open.`,
      details: { sourceBranch },
    });
  }
  return pullRequests[0];
};
export const findGithubPullRequestForBranch = (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  context: GithubPullRequestContext,
  sourceBranch: string,
  state: "open" | "all",
) =>
  Effect.gen(function* () {
    const repoSlug = `${context.repository.owner}/${context.repository.name}`;
    const payload = yield* runGithubCommand(
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
    const parsed = yield* Effect.try({
      try: () => parseGithubPullListResponse(payload),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    return yield* Effect.try({
      try: () => selectGithubPullRequestForBranch(parsed, sourceBranch, state),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  });
export const fetchGithubPullRequestByNumber = (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  context: GithubPullRequestContext,
  number: number,
) =>
  Effect.gen(function* () {
    const repoSlug = `${context.repository.owner}/${context.repository.name}`;
    const payload = yield* runGithubCommand(
      dependencies.systemCommands,
      repoPath,
      context.repository.host,
      ["api", `repos/${repoSlug}/pulls/${number}`],
    );
    return yield* Effect.try({
      try: () => parseGithubPullResponse(payload),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  });
export const githubPullRequestSyncPolicy = (
  systemCommands: SystemCommandPort,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
    const ghError =
      providerConfig?.enabled === true
        ? yield* systemCommands.requiredCommandError("gh")
        : "missing";
    const policy: GithubPullRequestSyncPolicy = {
      providerId: GITHUB_PROVIDER_ID,
      available: providerConfig?.enabled === true && ghError === null,
    };
    if (providerConfig?.repository) {
      policy.repository = providerConfig.repository;
    }
    return policy;
  });
export const fetchLinkedPullRequest = (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  policy: GithubPullRequestSyncPolicy,
  pullRequest: PullRequest,
) => {
  if (pullRequest.providerId !== policy.providerId || !policy.repository) {
    return Effect.succeed(undefined);
  }
  return fetchGithubPullRequestByNumber(
    dependencies,
    repoPath,
    { repository: policy.repository, remoteName: "" },
    pullRequest.number,
  );
};
export const upsertGithubPullRequest = (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  context: GithubPullRequestContext,
  approval: TaskApprovalContext,
  title: string,
  body: string,
) =>
  Effect.gen(function* () {
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
    const payload = yield* runGithubCommand(
      dependencies.systemCommands,
      repoPath,
      context.repository.host,
      args,
    );
    const pullRequest = yield* Effect.try({
      try: () => parseGithubPullResponse(payload),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    return pullRequest.record;
  });
