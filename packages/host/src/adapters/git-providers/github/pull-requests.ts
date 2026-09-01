import { type GitProviderRepository, type TaskApprovalContext } from "@openducktor/contracts";
import { Effect } from "effect";
import { checkoutBranch } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { runGithubApi, type GithubCli } from "./cli";
import {
  type GithubPullRequestContext,
  isEditablePullRequest,
  parseGithubPullListResponse,
  parseGithubPullResponse,
  type ResolvedPullRequest,
} from "./pull-request-model";

export {
  GITHUB_PROVIDER_ID,
  type GithubPullBranchRef,
  type GithubPullRequestContext,
  type GithubPullResponse,
  type ResolvedPullRequest,
} from "./pull-request-model";

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
  githubCli: GithubCli,
  repoPath: string,
  repository: GitProviderRepository,
  sourceBranch: string,
  state: "open" | "all",
) =>
  Effect.gen(function* () {
    const repoSlug = `${repository.owner}/${repository.name}`;
    const payload = yield* runGithubApi(githubCli, repoPath, repository.host, [
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
  githubCli: GithubCli,
  repoPath: string,
  repository: GitProviderRepository,
  number: number,
) =>
  Effect.gen(function* () {
    const repoSlug = `${repository.owner}/${repository.name}`;
    const payload = yield* runGithubApi(githubCli, repoPath, repository.host, [
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
export const upsertGithubPullRequest = (
  githubCli: GithubCli,
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
    const payload = yield* runGithubApi(githubCli, repoPath, context.repository.host, args);
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
