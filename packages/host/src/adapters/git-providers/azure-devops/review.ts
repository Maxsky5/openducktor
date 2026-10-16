import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  pullRequestReviewContextSchema,
  type AzureDevOpsRepository,
  type PullRequestReviewActivity,
  type PullRequestReviewContext,
  type PullRequestReviewOutcome,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostValidationError,
  errorMessage,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import type { PullRequestReviewProviderPort } from "../../../ports/pull-request-review-provider-port";
import {
  optionalString,
  optionalRecord,
  parseAzurePullRequest,
  parseAzureRepository,
  requireAzureLinkedRepository,
  requirePositiveInteger,
  requireRecord,
  requireString,
} from "./models";
import type { AzureDevOpsRestClient } from "./rest-client";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import {
  parseAzureReviewCommentContent,
  readAzureSuggestionFiles,
  type AzureSuggestionFile,
} from "./review-suggestions";
import {
  aggregateChecks,
  ciChecks,
  currentBuildIds,
  latestStatusChecks,
  parseBuildCheck,
  parseCiPolicy,
  timestampOrNull,
} from "./review-checks";
import {
  azureDevOpsNumberSchema,
  azureDevOpsPositiveIntegerSchema,
  type AzureDevOpsJson,
  type AzureDevOpsJsonRecord,
} from "./json";

const PROVIDER_ID = AZURE_DEVOPS_PROVIDER_DESCRIPTOR.id;

export const createAzureDevOpsReviewPort = ({
  client,
  repositoryPort,
}: {
  client: AzureDevOpsRestClient;
  repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository>;
}): PullRequestReviewProviderPort => ({
  providerId: PROVIDER_ID,
  readContext(input) {
    return Effect.gen(function* () {
      const configured = yield* repositoryPort.getRepository(input.repoConfig);
      if (configured.providerId !== PROVIDER_ID) {
        return unavailable("Azure DevOps repository settings are missing.");
      }
      yield* Effect.try({
        try: () => requireAzureLinkedRepository(input.linkedPullRequest),
        catch: asValidationError,
      });
      const repositoryResponse = yield* client.request(input.repoConfig, configured, {
        operation: "resolve repository for review",
        path: `git/repositories/${encodeURIComponent(configured.name)}`,
      });
      const repository = yield* Effect.try({
        try: () => parseAzureRepository(repositoryResponse.body, configured),
        catch: asValidationError,
      });
      yield* Effect.try({
        try: () => requireAzureLinkedRepository(input.linkedPullRequest, repository),
        catch: asValidationError,
      });
      const number = input.linkedPullRequest.number;
      const pullRequestResponse = yield* client.request(input.repoConfig, repository, {
        operation: "read pull request review",
        path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}`,
      });
      const pullRequest = yield* Effect.try({
        try: () => parseAzurePullRequest(pullRequestResponse.body, repository),
        catch: asValidationError,
      });

      const artifactId = `vstfs:///CodeReview/CodeReviewId/${repository.projectId}/${number}`;
      const [statuses, threads, policies, iterations] = yield* Effect.all(
        [
          client.readContinuationPages(input.repoConfig, repository, {
            operation: "read pull request statuses",
            path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}/statuses`,
          }),
          client.readContinuationPages(input.repoConfig, repository, {
            operation: "read pull request threads",
            path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}/threads`,
          }),
          client.readOffsetPages(input.repoConfig, repository, {
            operation: "read policy evaluations",
            path: "policy/evaluations",
            apiVersion: "7.0-preview.1",
            query: { artifactId },
          }),
          client.readContinuationPages(input.repoConfig, repository, {
            operation: "read pull request iterations",
            path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}/iterations`,
          }),
        ],
        { concurrency: 4 },
      );

      const { iterationId, sourceCommit, ciPolicies } = yield* Effect.try({
        try: () => {
          const iterationId = latestIterationId(iterations);
          const iteration = iterations
            .map((value) => requireRecord(value, "iteration"))
            .find((value) => value.id === iterationId);
          return {
            iterationId,
            sourceCommit: optionalString(optionalRecord(iteration?.sourceRefCommit)?.commitId),
            ciPolicies: policies.flatMap(parseCiPolicy),
          };
        },
        catch: asValidationError,
      });
      const iterationStatuses =
        iterationId === null
          ? []
          : yield* client.readContinuationPages(input.repoConfig, repository, {
              operation: "read pull request iteration statuses",
              path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}/iterations/${iterationId}/statuses`,
            });
      const buildEntries = yield* Effect.all(
        [...currentBuildIds(ciPolicies)].map((buildId) =>
          client
            .request(input.repoConfig, repository, {
              operation: `read build ${buildId}`,
              path: `build/builds/${buildId}`,
            })
            .pipe(
              Effect.flatMap((response) =>
                Effect.try({
                  try: () => [buildId, parseBuildCheck(response.body)] as const,
                  catch: asValidationError,
                }),
              ),
            ),
        ),
        { concurrency: 4 },
      );
      const builds = new Map(buildEntries);
      const suggestionFiles = yield* readAzureSuggestionFiles({
        client,
        repoConfig: input.repoConfig,
        repository,
        sourceCommit,
        iterationId,
        threads,
      });
      return yield* Effect.try({
        try: () => {
          const checks = ciChecks(
            ciPolicies,
            builds,
            latestStatusChecks([...statuses, ...iterationStatuses]),
          );
          const activities = threads.flatMap((thread) =>
            parseThreadActivities(thread, pullRequest.record.url, suggestionFiles),
          );
          const context: PullRequestReviewContext = {
            status: "loaded",
            providerId: PROVIDER_ID,
            pullRequest: {
              providerId: PROVIDER_ID,
              number,
              title: requireString(
                requireRecord(pullRequestResponse.body, "pullRequest").title,
                "pullRequest.title",
              ),
              url: pullRequest.record.url,
              state:
                pullRequest.record.state === "closed_unmerged"
                  ? "closed"
                  : pullRequest.record.state,
            },
            aggregateStatus: aggregateChecks(checks),
            checks,
            comments: activities,
            reviewThreads: {
              openCount: new Set(
                activities
                  .filter((activity) => activity.isResolved === false && activity.threadId)
                  .map((activity) => activity.threadId),
              ).size,
            },
            refreshedAt: new Date().toISOString(),
          };
          return pullRequestReviewContextSchema.parse(context);
        },
        catch: asValidationError,
      });
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostValidationError({
              message: `Failed to load Azure DevOps review context: ${errorMessage(cause)}`,
              cause,
            }),
      ),
    );
  },
});

const unavailable = (reason: string): PullRequestReviewContext => ({
  status: "unavailable",
  providerId: PROVIDER_ID,
  reason,
});

const latestIterationId = (iterations: AzureDevOpsJson[]): number | null => {
  const ids = iterations.flatMap((value) => {
    const id = requireRecord(value, "iteration").id;
    const parsed = azureDevOpsPositiveIntegerSchema.safeParse(id);
    return parsed.success ? [parsed.data] : [];
  });
  return ids.length === 0 ? null : Math.max(...ids);
};

const parseThreadActivities = (
  value: AzureDevOpsJson,
  pullRequestUrl: string,
  suggestionFiles: ReadonlyMap<string, AzureSuggestionFile>,
): PullRequestReviewActivity[] => {
  const thread = requireRecord(value, "thread");
  const threadId = String(requirePositiveInteger(thread.id, "thread.id"));
  const comments = Array.isArray(thread.comments) ? thread.comments : [];
  if (threadProperty(thread, "CodeReviewThreadType") === "VoteUpdate") {
    return voteActivities(thread, threadId, comments, pullRequestUrl);
  }
  const isResolved = resolvedThreadStatus(optionalString(thread.status));
  const context = optionalRecord(thread.threadContext) ?? {};
  const rightStart = optionalRecord(context.rightFileStart) ?? {};
  const rightEnd = optionalRecord(context.rightFileEnd) ?? {};
  const leftStart = optionalRecord(context.leftFileStart) ?? {};
  const rightLine = azureDevOpsNumberSchema.safeParse(rightStart.line).data ?? null;
  const leftLine = azureDevOpsNumberSchema.safeParse(leftStart.line).data ?? null;
  const line = rightLine ?? leftLine;
  return comments.flatMap((commentValue) => {
    const comment = requireRecord(commentValue, "thread.comment");
    if (comment.isDeleted === true || comment.commentType === "system") {
      return [];
    }
    const author = optionalRecord(comment.author) ?? {};
    const body = optionalString(comment.content) ?? "";
    const path = optionalString(context.filePath);
    const suggestionFile = suggestionFiles.get(threadId);
    const content = parseAzureReviewCommentContent({
      body,
      fileContent: suggestionFile?.content ?? null,
      fileWarning: suggestionFile?.warning ?? null,
      rightStart,
      rightEnd,
    });
    return [
      {
        id: `${threadId}:${String(comment.id ?? "unknown")}`,
        source: "review_thread" as const,
        author: optionalString(author.displayName),
        authorAvatarUrl: optionalString(author.imageUrl),
        body: content.body,
        patch: null,
        suggestionPatches: content.suggestionPatches,
        suggestionWarning: content.suggestionWarning,
        url: pullRequestUrl,
        createdAt: timestampOrNull(comment.publishedDate),
        updatedAt: timestampOrNull(comment.lastUpdatedDate),
        path,
        line,
        threadId,
        isResolved,
      },
    ];
  });
};

const threadProperty = (thread: AzureDevOpsJsonRecord, name: string): string | null =>
  optionalString(optionalRecord(optionalRecord(thread.properties)?.[name])?.$value);

const VOTE_PRESENTATION = new Map<string, { outcome: PullRequestReviewOutcome; body: string }>([
  ["10", { outcome: "approved", body: "" }],
  ["5", { outcome: "approved", body: "Approved with suggestions." }],
  ["0", { outcome: "dismissed", body: "" }],
  ["-5", { outcome: "changes_requested", body: "Waiting for author." }],
  ["-10", { outcome: "changes_requested", body: "Rejected." }],
]);

const voteActivities = (
  thread: AzureDevOpsJsonRecord,
  threadId: string,
  comments: AzureDevOpsJson[],
  pullRequestUrl: string,
): PullRequestReviewActivity[] => {
  const vote = threadProperty(thread, "CodeReviewVoteResult");
  const presentation = vote === null ? undefined : VOTE_PRESENTATION.get(vote);
  if (!presentation) {
    throw new HostValidationError({
      field: "thread.properties.CodeReviewVoteResult",
      message: `Azure DevOps vote thread ${threadId} has unsupported vote value '${vote ?? "missing"}'.`,
    });
  }
  return comments.flatMap((commentValue) => {
    const comment = requireRecord(commentValue, "thread.comment");
    if (comment.isDeleted === true) {
      return [];
    }
    const author = optionalRecord(comment.author) ?? {};
    return [
      {
        id: `${threadId}:${String(comment.id ?? "unknown")}`,
        source: "review" as const,
        reviewOutcome: presentation.outcome,
        author: optionalString(author.displayName),
        authorAvatarUrl: optionalString(author.imageUrl),
        body: presentation.body,
        patch: null,
        suggestionPatches: [],
        suggestionWarning: null,
        url: pullRequestUrl,
        createdAt: timestampOrNull(comment.publishedDate),
        updatedAt: timestampOrNull(comment.lastUpdatedDate),
        path: null,
        line: null,
        threadId: null,
        isResolved: null,
      },
    ];
  });
};

const resolvedThreadStatus = (value: string | null): boolean | null => {
  const normalized = value?.toLowerCase().replaceAll("-", "_") ?? "unknown";
  if (["fixed", "closed", "wontfix", "wont_fix", "bydesign", "by_design"].includes(normalized)) {
    return true;
  }
  return ["active", "pending"].includes(normalized) ? false : null;
};

const asValidationError = (cause: unknown): HostValidationErrorAggregate =>
  cause instanceof HostValidationError
    ? cause
    : new HostValidationError({ message: errorMessage(cause), cause });
