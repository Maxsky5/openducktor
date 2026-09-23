import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  type AzureDevOpsRepository,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { checkoutBranch } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type {
  GitProviderRepositoryPort,
  ProviderPullRequest,
  PullRequestProviderPort,
} from "../../../ports/git-provider-port";
import {
  headRef,
  parseAzurePullRequest,
  parseAzureRepository,
  requireAzureLinkedRepository,
  type ResolvedAzureDevOpsRepository,
} from "./models";
import type { AzureDevOpsRestClient } from "./rest-client";

const PROVIDER_ID = AZURE_DEVOPS_PROVIDER_DESCRIPTOR.id;

export const createAzureDevOpsPullRequestPort = ({
  client,
  repositoryPort,
}: {
  client: AzureDevOpsRestClient;
  repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository>;
}): PullRequestProviderPort => {
  const resolve = (
    repoConfig: Parameters<PullRequestProviderPort["getByNumber"]>[0]["repoConfig"],
  ) =>
    Effect.gen(function* () {
      const configured = yield* repositoryPort.getRepository(repoConfig);
      if (configured.providerId !== PROVIDER_ID) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "git.provider.repository",
            message: "Azure DevOps repository settings are required.",
          }),
        );
      }
      const response = yield* client.request(repoConfig, configured, {
        operation: "resolve repository",
        path: `git/repositories/${encodeURIComponent(configured.name)}`,
      });
      return yield* Effect.try({
        try: () => parseAzureRepository(response.body, configured),
        catch: asValidationError,
      });
    });

  const getByNumber: PullRequestProviderPort["getByNumber"] = (input) =>
    Effect.gen(function* () {
      const repository = yield* resolve(input.repoConfig);
      return yield* getPullRequest(client, input.repoConfig, repository, input.number);
    });

  return {
    providerId: PROVIDER_ID,
    findOpenForSourceBranch(input) {
      return Effect.gen(function* () {
        const repository = yield* resolve(input.repoConfig);
        const pullRequests = yield* listPullRequests(
          client,
          input.repoConfig,
          repository,
          input.sourceBranch,
          "active",
        );
        if (pullRequests.length > 1) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "sourceBranch",
              message: `Several active Azure DevOps pull requests use source branch ${input.sourceBranch}. Link the intended pull request before retrying.`,
            }),
          );
        }
        return pullRequests[0];
      });
    },
    findLatestMergedForSourceBranch(input) {
      return Effect.gen(function* () {
        const repository = yield* resolve(input.repoConfig);
        const pullRequests = yield* listPullRequests(
          client,
          input.repoConfig,
          repository,
          input.sourceBranch,
          "completed",
        );
        return pullRequests
          .filter((pullRequest) => pullRequest.record.state === "merged")
          .sort((left, right) =>
            (left.record.mergedAt ?? "").localeCompare(right.record.mergedAt ?? ""),
          )
          .at(-1);
      });
    },
    getByNumber,
    refresh(input) {
      return Effect.gen(function* () {
        yield* Effect.try({
          try: () => requireAzureLinkedRepository(input.linkedPullRequest),
          catch: asValidationError,
        });
        const repository = yield* resolve(input.repoConfig);
        yield* Effect.try({
          try: () => requireAzureLinkedRepository(input.linkedPullRequest, repository),
          catch: asValidationError,
        });
        return yield* getPullRequest(
          client,
          input.repoConfig,
          repository,
          input.linkedPullRequest.number,
        );
      });
    },
    resolvePublishRemote: (input) =>
      repositoryPort.getMapping(input.repoConfig).pipe(Effect.map(({ remoteName }) => remoteName)),
    upsert(input) {
      return Effect.gen(function* () {
        const linkedPullRequest = input.approval.pullRequest;
        if (linkedPullRequest) {
          yield* Effect.try({
            try: () => requireAzureLinkedRepository(linkedPullRequest),
            catch: asValidationError,
          });
        }
        const repository = yield* resolve(input.repoConfig);
        const sourceBranch = input.approval.sourceBranch;
        const targetBranch = checkoutBranch(input.approval.targetBranch);
        let intended: ProviderPullRequest | undefined;
        if (linkedPullRequest) {
          yield* Effect.try({
            try: () => requireAzureLinkedRepository(linkedPullRequest, repository),
            catch: asValidationError,
          });
          intended = yield* getPullRequest(
            client,
            input.repoConfig,
            repository,
            linkedPullRequest.number,
          );
          if (intended.record.state !== "open" && intended.record.state !== "draft") {
            return yield* Effect.fail(
              new HostValidationError({
                field: "pullRequest.state",
                message: "The linked Azure DevOps pull request is no longer editable.",
              }),
            );
          }
        } else {
          const candidates = yield* listPullRequests(
            client,
            input.repoConfig,
            repository,
            sourceBranch,
            "active",
          );
          if (candidates.length > 1) {
            return yield* Effect.fail(
              new HostValidationError({
                field: "sourceBranch",
                message: `Several active Azure DevOps pull requests use source branch ${sourceBranch}. Link the intended pull request before retrying.`,
              }),
            );
          }
          intended = candidates[0];
        }
        if (intended?.sourceBranch !== undefined && intended.sourceBranch !== sourceBranch) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "sourceBranch",
              message: `Azure DevOps pull request ${intended.record.number} uses source branch ${intended.sourceBranch}, not ${sourceBranch}.`,
            }),
          );
        }
        if (intended?.targetBranch !== undefined && intended.targetBranch !== targetBranch) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "targetBranch",
              message: `Azure DevOps pull request ${intended.record.number} targets ${intended.targetBranch}, not ${targetBranch}.`,
            }),
          );
        }
        const response = yield* client.request(input.repoConfig, repository, {
          operation: intended ? "update pull request" : "create pull request",
          path: intended
            ? `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${intended.record.number}`
            : `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests`,
          method: intended ? "PATCH" : "POST",
          body: intended
            ? { title: input.title.trim(), description: input.body }
            : {
                sourceRefName: headRef(sourceBranch),
                targetRefName: headRef(targetBranch),
                title: input.title.trim(),
                description: input.body,
              },
        });
        return yield* Effect.try({
          try: () => parseAzurePullRequest(response.body, repository).record,
          catch: asValidationError,
        });
      });
    },
  };
};

const listPullRequests = (
  client: AzureDevOpsRestClient,
  repoConfig: Parameters<PullRequestProviderPort["getByNumber"]>[0]["repoConfig"],
  repository: ResolvedAzureDevOpsRepository,
  sourceBranch: string,
  status: "active" | "completed",
) =>
  client
    .readOffsetPages(repoConfig, repository, {
      operation: "list pull requests",
      path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests`,
      query: {
        "searchCriteria.status": status,
        "searchCriteria.sourceRefName": headRef(sourceBranch),
        $top: 100,
      },
    })
    .pipe(
      Effect.flatMap((values) =>
        Effect.try({
          try: () => values.map((value) => parseAzurePullRequest(value, repository)),
          catch: asValidationError,
        }),
      ),
    );

const getPullRequest = (
  client: AzureDevOpsRestClient,
  repoConfig: Parameters<PullRequestProviderPort["getByNumber"]>[0]["repoConfig"],
  repository: ResolvedAzureDevOpsRepository,
  number: number,
) =>
  client
    .request(repoConfig, repository, {
      operation: "read pull request",
      path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}`,
    })
    .pipe(
      Effect.flatMap((response) =>
        Effect.try({
          try: () => parseAzurePullRequest(response.body, repository),
          catch: asValidationError,
        }),
      ),
    );

const asValidationError = (cause: unknown) =>
  cause instanceof HostValidationError
    ? cause
    : new HostValidationError({ message: cause instanceof Error ? cause.message : String(cause) });
