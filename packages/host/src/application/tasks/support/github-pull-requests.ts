import {
  type GitProviderRepository,
  type PullRequest,
  type RepoConfig,
  type TaskApprovalContext,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { checkoutBranch } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type { GithubCommandResolverPort } from "../../../ports/github-cli-port";
import {
  combinedCommandOutput,
  GITHUB_PROVIDER_ID,
  type GithubPullRequestContext,
  type GithubPullRequestSyncPolicy,
  isEditablePullRequest,
  parseGithubPullListResponse,
  parseGithubPullResponse,
  type ResolvedPullRequest,
} from "./github-pull-request-model";

export {
  GITHUB_PROVIDER_ID,
  type GithubPullBranchRef,
  type GithubPullRequestContext,
  type GithubPullRequestSyncPolicy,
  type GithubPullResponse,
  pullRequestRecordsMatch,
  type ResolvedPullRequest,
} from "./github-pull-request-model";

export const runGithubCommand = (
  githubCommands: GithubCommandResolverPort,
  repoPath: string,
  host: string,
  args: string[],
) =>
  Effect.gen(function* () {
    const hostArgs = host.trim() ? ["--hostname", host.trim(), ...args] : args;
    const githubCommand = yield* githubCommands.resolve();
    const result = yield* githubCommand.githubCli.run(githubCommand.ghCommand, hostArgs, {
      cwd: repoPath,
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
const selectGithubPullRequestForBranch = (
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
  githubCommands: GithubCommandResolverPort,
  repoPath: string,
  repository: GitProviderRepository,
  sourceBranch: string,
  state: "open" | "all",
) =>
  Effect.gen(function* () {
    const repoSlug = `${repository.owner}/${repository.name}`;
    const payload = yield* runGithubCommand(githubCommands, repoPath, repository.host, [
      "api",
      "--method",
      "GET",
      `repos/${repoSlug}/pulls`,
      "-f",
      `state=${state}`,
      "-f",
      `head=${repository.owner}:${sourceBranch}`,
    ]);
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
  githubCommands: GithubCommandResolverPort,
  repoPath: string,
  repository: GitProviderRepository,
  number: number,
) =>
  Effect.gen(function* () {
    const repoSlug = `${repository.owner}/${repository.name}`;
    const payload = yield* runGithubCommand(githubCommands, repoPath, repository.host, [
      "api",
      `repos/${repoSlug}/pulls/${number}`,
    ]);
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
  githubCommands: GithubCommandResolverPort,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    const githubConfig = repoConfig.git.provider;
    const githubCommandResult =
      githubConfig?.id === GITHUB_PROVIDER_ID && githubConfig.enabled === true
        ? yield* Effect.either(githubCommands.resolve())
        : null;
    const policy: GithubPullRequestSyncPolicy = {
      providerId: GITHUB_PROVIDER_ID,
      available: githubCommandResult?._tag === "Right",
    };
    if (githubConfig?.id === GITHUB_PROVIDER_ID && githubConfig.repository) {
      policy.repository = githubConfig.repository;
    }
    return policy;
  });
export const fetchLinkedPullRequest = (
  githubCommands: GithubCommandResolverPort,
  repoPath: string,
  policy: GithubPullRequestSyncPolicy,
  pullRequest: PullRequest,
) => {
  if (pullRequest.providerId !== policy.providerId || !policy.repository) {
    return Effect.succeed(undefined);
  }
  return fetchGithubPullRequestByNumber(
    githubCommands,
    repoPath,
    policy.repository,
    pullRequest.number,
  );
};
export const upsertGithubPullRequest = (
  githubCommands: GithubCommandResolverPort,
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
      githubCommands,
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
