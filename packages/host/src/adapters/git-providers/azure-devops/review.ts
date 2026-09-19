import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  pullRequestReviewContextSchema,
  type AzureDevOpsRepository,
  type PullRequestReviewAggregateStatus,
  type PullRequestReviewCheck,
  type PullRequestReviewContext,
  type PullRequestReviewer,
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
  azureDevOpsNumberSchema,
  azureDevOpsPositiveIntegerSchema,
  azureDevOpsTimestampSchema,
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
      const [statuses, reviewers, threads, policies, iterations] = yield* Effect.all(
        [
          client.readContinuationPages(input.repoConfig, repository, {
            operation: "read pull request statuses",
            path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}/statuses`,
          }),
          client.readContinuationPages(input.repoConfig, repository, {
            operation: "read pull request reviewers",
            path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}/reviewers`,
          }),
          client.readContinuationPages(input.repoConfig, repository, {
            operation: "read pull request threads",
            path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}/threads`,
          }),
          client.readOffsetPages(input.repoConfig, repository, {
            operation: "read policy evaluations",
            path: "policy/evaluations",
            apiVersion: "7.0-preview.1",
            query: { artifactId, includeNotApplicable: true },
          }),
          client.readContinuationPages(input.repoConfig, repository, {
            operation: "read pull request iterations",
            path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}/iterations`,
          }),
        ],
        { concurrency: 5 },
      );

      const { buildIds, iterationId, policyChecks } = yield* Effect.try({
        try: () => ({
          iterationId: latestIterationId(iterations),
          policyChecks: policies.map(parsePolicyCheck),
          buildIds: new Set(policies.flatMap(readPolicyBuildId)),
        }),
        catch: asValidationError,
      });
      const iterationStatuses =
        iterationId === null
          ? []
          : yield* client.readContinuationPages(input.repoConfig, repository, {
              operation: "read pull request iteration statuses",
              path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/pullrequests/${number}/iterations/${iterationId}/statuses`,
            });
      const builds = yield* Effect.all(
        [...buildIds].map((buildId) =>
          client
            .request(input.repoConfig, repository, {
              operation: `read build ${buildId}`,
              path: `build/builds/${buildId}`,
            })
            .pipe(
              Effect.flatMap((response) =>
                Effect.try({ try: () => parseBuildCheck(response.body), catch: asValidationError }),
              ),
            ),
        ),
        { concurrency: 4 },
      );
      return yield* Effect.try({
        try: () => {
          const checks = [
            ...latestStatusChecks([...statuses, ...iterationStatuses]),
            ...policyChecks,
            ...builds,
          ];
          const activities = threads.flatMap((thread) =>
            parseThreadActivities(thread, pullRequest.record.url),
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
            reviewers: reviewers.map(parseReviewer),
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

const latestStatusChecks = (values: AzureDevOpsJson[]): PullRequestReviewCheck[] => {
  const latest = new Map<string, { check: PullRequestReviewCheck; updatedAt: string }>();
  for (const value of values) {
    const record = requireRecord(value, "status");
    const context = requireRecord(record.context, "status.context");
    const genre = optionalString(context.genre) ?? "status";
    const name = optionalString(context.name) ?? optionalString(record.description) ?? "Unnamed";
    const updatedAt =
      optionalString(record.updatedDate) ?? optionalString(record.creationDate) ?? "";
    const key = `${genre}\n${name}`;
    const prior = latest.get(key);
    if (!prior || prior.updatedAt <= updatedAt) {
      latest.set(key, {
        updatedAt,
        check: statusCheck(record, genre, name),
      });
    }
  }
  return [...latest.values()].map((entry) => entry.check);
};

const statusCheck = (
  record: AzureDevOpsJsonRecord,
  genre: string,
  name: string,
): PullRequestReviewCheck => {
  const state = optionalString(record.state)?.toLowerCase() ?? "unknown";
  const status = ["pending", "notset", "not_set"].includes(state)
    ? "in_progress"
    : ["succeeded", "failed", "error", "notapplicable", "not_applicable"].includes(state)
      ? "completed"
      : "unknown";
  const conclusion =
    state === "succeeded"
      ? "success"
      : ["failed", "error"].includes(state)
        ? "failure"
        : ["notapplicable", "not_applicable"].includes(state)
          ? "skipped"
          : state === "unknown"
            ? "unknown"
            : null;
  return {
    name: `${genre}: ${name}`,
    workflow: "Azure DevOps status",
    status,
    conclusion,
    url: optionalString(record.targetUrl),
    details: optionalString(record.description) ?? `Azure state: ${state}`,
    startedAt: timestampOrNull(record.creationDate),
    completedAt: status === "completed" ? timestampOrNull(record.updatedDate) : null,
  };
};

const parsePolicyCheck = (value: AzureDevOpsJson): PullRequestReviewCheck => {
  const record = requireRecord(value, "policy");
  const configuration = requireRecord(record.configuration, "policy.configuration");
  const type = requireRecord(configuration.type, "policy.configuration.type");
  const name =
    optionalString(type.displayName) ?? `Policy ${String(configuration.id ?? "unknown")}`;
  const state = optionalString(record.status)?.toLowerCase() ?? "unknown";
  const status =
    state === "queued"
      ? "queued"
      : state === "running"
        ? "in_progress"
        : ["approved", "rejected", "notapplicable", "broken"].includes(state)
          ? "completed"
          : "unknown";
  const conclusion =
    state === "approved"
      ? "success"
      : state === "rejected"
        ? "failure"
        : state === "notapplicable"
          ? "skipped"
          : state === "broken"
            ? "action_required"
            : state === "unknown"
              ? "unknown"
              : null;
  return {
    name,
    workflow: "Azure DevOps policy",
    status,
    conclusion,
    url: null,
    details: `Azure policy state: ${state}`,
    startedAt: timestampOrNull(record.startedDate),
    completedAt: status === "completed" ? timestampOrNull(record.completedDate) : null,
  };
};

const readPolicyBuildId = (value: AzureDevOpsJson): number[] => {
  const record = requireRecord(value, "policy");
  const context = optionalRecord(record.context);
  if (!context) {
    return [];
  }
  const buildId = context.buildId;
  const numeric = optionalString(buildId) ? Number(buildId) : buildId;
  const parsed = azureDevOpsPositiveIntegerSchema.safeParse(numeric);
  return parsed.success ? [parsed.data] : [];
};

const parseBuildCheck = (value: AzureDevOpsJson): PullRequestReviewCheck => {
  const record = requireRecord(value, "build");
  const definition = requireRecord(record.definition, "build.definition");
  const statusValue = optionalString(record.status)?.toLowerCase() ?? "unknown";
  const result = optionalString(record.result)?.toLowerCase() ?? null;
  const status = ["notstarted", "postponed"].includes(statusValue)
    ? "queued"
    : ["inprogress", "cancelling"].includes(statusValue)
      ? "in_progress"
      : statusValue === "completed"
        ? "completed"
        : "unknown";
  const conclusion =
    result === "succeeded"
      ? "success"
      : result === "failed"
        ? "failure"
        : result === "canceled"
          ? "cancelled"
          : result === "partiallysucceeded"
            ? "neutral"
            : status === "unknown"
              ? "unknown"
              : null;
  return {
    name: optionalString(definition.name) ?? `Build ${String(record.id ?? "unknown")}`,
    workflow: "Azure Pipelines",
    status,
    conclusion,
    url: buildWebUrl(record),
    details: `Azure build status: ${statusValue}${result ? `; result: ${result}` : ""}`,
    startedAt: timestampOrNull(record.startTime),
    completedAt: timestampOrNull(record.finishTime),
  };
};

const parseReviewer = (value: AzureDevOpsJson): PullRequestReviewer => {
  const record = requireRecord(value, "reviewer");
  const vote = azureDevOpsNumberSchema.safeParse(record.vote).data ?? Number.NaN;
  const decision =
    vote === 10
      ? "approved"
      : vote === 5
        ? "approved_with_suggestions"
        : vote === 0
          ? "no_vote"
          : vote === -5
            ? "waiting_for_author"
            : vote === -10
              ? "rejected"
              : "unknown";
  return {
    id: requireString(record.id, "reviewer.id"),
    displayName: requireString(record.displayName, "reviewer.displayName"),
    avatarUrl: optionalString(record.imageUrl),
    decision,
    isRequired: record.isRequired === true,
  };
};

const parseThreadActivities = (value: AzureDevOpsJson, pullRequestUrl: string) => {
  const thread = requireRecord(value, "thread");
  const threadId = String(requirePositiveInteger(thread.id, "thread.id"));
  const isResolved = resolvedThreadStatus(optionalString(thread.status));
  const context = optionalRecord(thread.threadContext) ?? {};
  const rightStart = optionalRecord(context.rightFileStart) ?? {};
  const leftStart = optionalRecord(context.leftFileStart) ?? {};
  const rightLine = azureDevOpsNumberSchema.safeParse(rightStart.line).data ?? null;
  const leftLine = azureDevOpsNumberSchema.safeParse(leftStart.line).data ?? null;
  const line = rightLine ?? leftLine;
  const comments = Array.isArray(thread.comments) ? thread.comments : [];
  return comments.flatMap((commentValue) => {
    const comment = requireRecord(commentValue, "thread.comment");
    if (comment.isDeleted === true) {
      return [];
    }
    const author = optionalRecord(comment.author) ?? {};
    return [
      {
        id: `${threadId}:${String(comment.id ?? "unknown")}`,
        source: "review_thread" as const,
        author: optionalString(author.displayName),
        authorAvatarUrl: optionalString(author.imageUrl),
        body: optionalString(comment.content) ?? "",
        patch: null,
        suggestionPatches: [],
        suggestionWarning: null,
        url: pullRequestUrl,
        createdAt: timestampOrNull(comment.publishedDate),
        updatedAt: timestampOrNull(comment.lastUpdatedDate),
        path: optionalString(context.filePath),
        line,
        threadId,
        isResolved,
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

const aggregateChecks = (checks: PullRequestReviewCheck[]): PullRequestReviewAggregateStatus => {
  if (checks.length === 0) {
    return "unknown";
  }
  if (
    checks.some((check) =>
      ["failure", "cancelled", "timed_out", "action_required"].includes(check.conclusion ?? ""),
    )
  ) {
    return "failure";
  }
  if (checks.some((check) => ["queued", "in_progress"].includes(check.status))) {
    return "pending";
  }
  if (checks.some((check) => check.status === "unknown" || check.conclusion === "unknown")) {
    return "unknown";
  }
  const applicable = checks.filter((check) => check.conclusion !== "skipped");
  if (applicable.every((check) => check.conclusion === "neutral")) {
    return "neutral";
  }
  return applicable.every((check) => check.conclusion === "success") ? "success" : "unknown";
};

const buildWebUrl = (record: AzureDevOpsJsonRecord): string | null => {
  const web = optionalRecord(optionalRecord(record._links)?.web);
  const href = optionalString(web?.href);
  if (href) {
    return href;
  }
  return optionalString(record.url);
};

const timestampOrNull = (value: AzureDevOpsJson | undefined): string | null =>
  azureDevOpsTimestampSchema.safeParse(value).data ?? null;

const asValidationError = (cause: unknown): HostValidationErrorAggregate =>
  cause instanceof HostValidationError
    ? cause
    : new HostValidationError({ message: errorMessage(cause), cause });
