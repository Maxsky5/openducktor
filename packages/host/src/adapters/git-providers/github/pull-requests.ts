import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderRepository,
  type PullRequest,
  type RepoConfig,
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

const toPullRequestValidationError = (cause: unknown): HostValidationErrorAggregate =>
  cause instanceof HostValidationError
    ? cause
    : new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });

const selectOpenPullRequestForBranch = (
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

const selectLatestMergedPullRequestForBranch = (
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

const findGithubPullRequestsForBranch = (
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
      catch: toPullRequestValidationError,
    });
    return parsed;
  });

const fetchGithubPullRequestByNumber = (
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
const upsertGithubPullRequest = (
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
    if (
      existingPullRequest !== undefined &&
      existingPullRequest.providerId !== GITHUB_PROVIDER_ID
    ) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "pullRequest.providerId",
          message: `Pull request provider '${existingPullRequest.providerId}' does not match configured provider '${GITHUB_PROVIDER_ID}'.`,
          details: {
            providerId: existingPullRequest.providerId,
            configuredProviderId: GITHUB_PROVIDER_ID,
          },
        }),
      );
    }
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

export const createGithubPullRequestProviderPort = ({
  githubCli,
  repositoryPort,
}: {
  githubCli: GithubCli;
  repositoryPort: GitProviderRepositoryPort;
}): PullRequestProviderPort => {
  const getRepository = (repoConfig: RepoConfig) => repositoryPort.getRepository(repoConfig);

  const getByNumber: PullRequestProviderPort["getByNumber"] = (input) =>
    Effect.gen(function* () {
      const repository = yield* getRepository(input.repoConfig);
      return yield* fetchGithubPullRequestByNumber(
        githubCli,
        input.repoConfig.repoPath,
        repository,
        input.number,
      );
    });

  const validateLinkedPullRequest = (linkedPullRequest: PullRequest) => {
    if (linkedPullRequest.providerId === GITHUB_PROVIDER_ID) {
      return Effect.void;
    }
    return Effect.fail(
      new HostValidationError({
        field: "pullRequest.providerId",
        message: `Pull request provider '${linkedPullRequest.providerId}' does not match configured provider '${GITHUB_PROVIDER_ID}'.`,
        details: {
          providerId: linkedPullRequest.providerId,
          configuredProviderId: GITHUB_PROVIDER_ID,
        },
      }),
    );
  };

  return {
    providerId: GITHUB_PROVIDER_ID,
    findOpenForSourceBranch: (input) =>
      Effect.gen(function* () {
        const repository = yield* getRepository(input.repoConfig);
        const pullRequests = yield* findGithubPullRequestsForBranch(
          githubCli,
          input.repoConfig.repoPath,
          repository,
          input.sourceBranch,
          "open",
        );
        return yield* Effect.try({
          try: () => selectOpenPullRequestForBranch(pullRequests, input.sourceBranch),
          catch: toPullRequestValidationError,
        });
      }),
    findLatestMergedForSourceBranch: (input) =>
      Effect.gen(function* () {
        const repository = yield* getRepository(input.repoConfig);
        const pullRequests = yield* findGithubPullRequestsForBranch(
          githubCli,
          input.repoConfig.repoPath,
          repository,
          input.sourceBranch,
          "all",
        );
        return yield* Effect.try({
          try: () => selectLatestMergedPullRequestForBranch(pullRequests),
          catch: toPullRequestValidationError,
        });
      }),
    getByNumber,
    refresh: (input) =>
      Effect.gen(function* () {
        yield* validateLinkedPullRequest(input.linkedPullRequest);
        return yield* getByNumber({
          repoConfig: input.repoConfig,
          number: input.linkedPullRequest.number,
        });
      }),
    resolvePublishRemote: (input) =>
      repositoryPort.getMapping(input.repoConfig).pipe(Effect.map(({ remoteName }) => remoteName)),
    upsert: (input) =>
      Effect.gen(function* () {
        const repository = yield* getRepository(input.repoConfig);
        return yield* upsertGithubPullRequest(
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
