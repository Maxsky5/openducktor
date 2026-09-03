import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderRepository,
  type PullRequest,
  type TaskApprovalContext,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { checkoutBranch } from "../../../domain/task";
import {
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import { runGithubApi, type GithubCli } from "./cli";
import type {
  GitProviderRepositoryPort,
  PullRequestProviderPort,
} from "../../../ports/git-provider-port";
import {
  isEditablePullRequest,
  parseGithubPullListResponse,
  parseGithubPullResponse,
  type ResolvedPullRequest,
} from "./pull-request-model";

const GITHUB_PROVIDER_ID = GITHUB_PROVIDER_DESCRIPTOR.id;

export const createGithubPullRequestProviderPort = ({
  githubCli,
  repositoryPort,
}: {
  githubCli: GithubCli;
  repositoryPort: GitProviderRepositoryPort;
}): PullRequestProviderPort => {
  const getByNumber: PullRequestProviderPort["getByNumber"] = (input) =>
    Effect.gen(function* () {
      const { repository } = yield* repositoryPort.getMapping(input.repoConfig);
      return yield* getPullRequest(githubCli, input.repoConfig.repoPath, repository, input.number);
    });

  return {
    providerId: GITHUB_PROVIDER_ID,
    findOpenForSourceBranch: (input) =>
      Effect.gen(function* () {
        const { repository } = yield* repositoryPort.getMapping(input.repoConfig);
        const pullRequests = yield* listPullRequests(
          githubCli,
          input.repoConfig.repoPath,
          repository,
          input.sourceBranch,
          "open",
        );
        return yield* Effect.try({
          try: () => selectOpenPullRequest(pullRequests, input.sourceBranch),
          catch: toPullRequestValidationError,
        });
      }),
    findLatestMergedForSourceBranch: (input) =>
      Effect.gen(function* () {
        const { repository } = yield* repositoryPort.getMapping(input.repoConfig);
        const pullRequests = yield* listPullRequests(
          githubCli,
          input.repoConfig.repoPath,
          repository,
          input.sourceBranch,
          "all",
        );
        return yield* Effect.try({
          try: () => selectLatestMergedPullRequest(pullRequests),
          catch: toPullRequestValidationError,
        });
      }),
    getByNumber,
    refresh: (input) =>
      Effect.gen(function* () {
        yield* checkPullRequestProvider(input.linkedPullRequest);
        const repository = yield* repositoryPort.getRepository(input.repoConfig);
        return yield* getPullRequest(
          githubCli,
          input.repoConfig.repoPath,
          repository,
          input.linkedPullRequest.number,
        );
      }),
    resolvePublishRemote: (input) =>
      repositoryPort.getMapping(input.repoConfig).pipe(Effect.map(({ remoteName }) => remoteName)),
    upsert: (input) =>
      Effect.gen(function* () {
        const { repository } = yield* repositoryPort.getMapping(input.repoConfig);
        return yield* upsertPullRequest(
          githubCli,
          input.repoConfig.repoPath,
          repository,
          input.approval,
          input.title,
          input.body,
        );
      }),
  };
};

const checkPullRequestProvider = (
  pullRequest: PullRequest | undefined,
): Effect.Effect<void, HostValidationErrorAggregate> => {
  if (pullRequest === undefined || pullRequest.providerId === GITHUB_PROVIDER_ID) {
    return Effect.void;
  }
  return Effect.fail(
    new HostValidationError({
      field: "pullRequest.providerId",
      message: `Pull request provider '${pullRequest.providerId}' does not match configured provider '${GITHUB_PROVIDER_ID}'.`,
      details: {
        linkedProviderId: pullRequest.providerId,
        configuredProviderId: GITHUB_PROVIDER_ID,
      },
    }),
  );
};

const toPullRequestValidationError = (cause: unknown): HostValidationErrorAggregate =>
  cause instanceof HostValidationError
    ? cause
    : new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });

const selectOpenPullRequest = (
  pullRequests: readonly ResolvedPullRequest[],
  sourceBranch: string,
): ResolvedPullRequest | undefined => {
  if (pullRequests.length > 1) {
    throw new HostValidationError({
      field: "sourceBranch",
      message: `Multiple pull requests were found for branch ${sourceBranch} while querying state=open.`,
      details: { sourceBranch },
    });
  }
  return pullRequests[0];
};

const selectLatestMergedPullRequest = (
  pullRequests: readonly ResolvedPullRequest[],
): ResolvedPullRequest | undefined =>
  pullRequests
    .filter((pullRequest) => pullRequest.record.state === "merged")
    .map((pullRequest) => {
      const mergedAt = pullRequest.record.mergedAt;
      if (mergedAt === undefined) {
        throw new HostValidationError({
          field: "mergedAt",
          message: `GitHub merged pull request ${pullRequest.record.number} has no merge timestamp.`,
          details: { pullRequestNumber: pullRequest.record.number },
        });
      }
      return { mergedAt, pullRequest };
    })
    .sort((left, right) => left.mergedAt.localeCompare(right.mergedAt))
    .at(-1)?.pullRequest;

const listPullRequests = (
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
      "--paginate",
      "--slurp",
      "--method",
      "GET",
      `repos/${repoSlug}/pulls`,
      "-f",
      `state=${state}`,
      "-f",
      `head=${repository.owner}:${sourceBranch}`,
    ]);
    return yield* Effect.try({
      try: () => parseGithubPullListResponse(payload),
      catch: toPullRequestValidationError,
    });
  });

const getPullRequest = (
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
      catch: toPullRequestValidationError,
    });
  });

const upsertPullRequest = (
  githubCli: GithubCli,
  repoPath: string,
  repository: GitProviderRepository,
  approval: TaskApprovalContext,
  title: string,
  body: string,
) =>
  Effect.gen(function* () {
    const repoSlug = `${repository.owner}/${repository.name}`;
    const existingPullRequest = approval.pullRequest;
    yield* checkPullRequestProvider(existingPullRequest);
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
    const payload = yield* runGithubApi(githubCli, repoPath, repository.host, args);
    const pullRequest = yield* Effect.try({
      try: () => parseGithubPullResponse(payload),
      catch: toPullRequestValidationError,
    });
    return pullRequest.record;
  });
