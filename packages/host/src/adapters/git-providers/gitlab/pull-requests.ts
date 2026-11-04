import type { GitlabRepository } from "@openducktor/contracts";
import { Effect } from "effect";
import { checkoutBranch } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type {
  GitProviderRepositoryPort,
  ProviderPullRequest,
  PullRequestProviderPort,
} from "../../../ports/git-provider-port";
import {
  gitlabMergeRequestDetailSchema,
  gitlabMergeRequestSchema,
  gitlabPullRequest,
  requireGitlabLinkedPullRequest,
  requireSameProjectMergeRequest,
} from "./models";
import { type GitlabProjectContext, type GitlabRestClient, gitlabProjectPath } from "./rest-client";
import type { GitProviderWorkspace } from "../../../ports/git-provider-workspace";

// GitLab reads the draft state of a merge request from these title prefixes only.
const DRAFT_TITLE_PREFIX = /^(\[draft\]|\(draft\)|draft:)/i;

const mergeRequestsPath = (context: GitlabProjectContext, suffix = "") =>
  gitlabProjectPath(context.project.id, `/merge_requests${suffix}`);

const listForSourceBranch = (
  client: GitlabRestClient,
  context: GitlabProjectContext,
  sourceBranch: string,
  state: "opened" | "merged",
) =>
  client
    .pages(
      context,
      {
        operation: "list pull requests",
        path: mergeRequestsPath(context),
        query: { source_branch: sourceBranch, state },
      },
      gitlabMergeRequestSchema,
    )
    .pipe(
      Effect.map((mergeRequests) =>
        mergeRequests
          // A merge request from a fork pushes another project, so it never matches the task branch.
          .filter(
            (mergeRequest) =>
              mergeRequest.source_project_id === context.project.id &&
              mergeRequest.target_project_id === context.project.id,
          )
          .map((mergeRequest) => gitlabPullRequest(mergeRequest, context.identity)),
      ),
    );

const readMergeRequest = (client: GitlabRestClient, context: GitlabProjectContext, iid: number) =>
  client
    .json(
      context,
      { operation: "read pull request", path: mergeRequestsPath(context, `/${iid}`) },
      gitlabMergeRequestDetailSchema,
    )
    .pipe(
      Effect.flatMap((mergeRequest) =>
        requireSameProjectMergeRequest(mergeRequest, context.project.id),
      ),
      Effect.map((mergeRequest) => gitlabPullRequest(mergeRequest, context.identity)),
    );

const findSingleOpen = (
  client: GitlabRestClient,
  context: GitlabProjectContext,
  sourceBranch: string,
) =>
  Effect.gen(function* () {
    const open = yield* listForSourceBranch(client, context, sourceBranch, "opened");
    if (open.length > 1)
      return yield* Effect.fail(
        new HostValidationError({
          field: "sourceBranch",
          message: `Several open GitLab pull requests use source branch ${sourceBranch}: ${open.map((mergeRequest) => `#${mergeRequest.record.number}`).join(", ")}. Close the extra ones so that only one open pull request uses the branch, then retry.`,
        }),
      );
    return open[0];
  });

export const createGitlabPullRequestPort = ({
  client,
  repositoryPort,
}: {
  client: GitlabRestClient;
  repositoryPort: GitProviderRepositoryPort<GitlabRepository>;
}): PullRequestProviderPort => {
  const resolve = (repoConfig: GitProviderWorkspace) => client.resolveProject(repoConfig);

  return {
    providerId: "gitlab",
    findOpenForSourceBranch: (input) =>
      resolve(input.repoConfig).pipe(
        Effect.flatMap((context) => findSingleOpen(client, context, input.sourceBranch)),
      ),
    findLatestMergedForSourceBranch: (input) =>
      resolve(input.repoConfig).pipe(
        Effect.flatMap((context) =>
          listForSourceBranch(client, context, input.sourceBranch, "merged"),
        ),
        Effect.map((merged) =>
          merged
            .toSorted((left, right) =>
              (left.record.mergedAt ?? "").localeCompare(right.record.mergedAt ?? ""),
            )
            .at(-1),
        ),
      ),
    getByNumber: (input) =>
      resolve(input.repoConfig).pipe(
        Effect.flatMap((context) => readMergeRequest(client, context, input.number)),
      ),
    refresh: (input) =>
      Effect.gen(function* () {
        yield* requireGitlabLinkedPullRequest(input.linkedPullRequest);
        const context = yield* resolve(input.repoConfig);
        yield* requireGitlabLinkedPullRequest(input.linkedPullRequest, context.identity);
        return yield* readMergeRequest(client, context, input.linkedPullRequest.number);
      }),
    resolvePublishRemote: (input) =>
      repositoryPort.getMapping(input.repoConfig).pipe(Effect.map(({ remoteName }) => remoteName)),
    upsert: (input) =>
      Effect.gen(function* () {
        const linked = input.approval.pullRequest;
        if (linked) yield* requireGitlabLinkedPullRequest(linked);
        const context = yield* resolve(input.repoConfig);
        const sourceBranch = input.approval.sourceBranch;
        const targetBranch = checkoutBranch(input.approval.targetBranch);
        let intended: ProviderPullRequest | undefined;
        if (linked) {
          yield* requireGitlabLinkedPullRequest(linked, context.identity);
          intended = yield* readMergeRequest(client, context, linked.number);
          if (intended.record.state !== "open" && intended.record.state !== "draft")
            return yield* Effect.fail(
              new HostValidationError({
                field: "pullRequest.state",
                message: `The linked GitLab pull request #${linked.number} is ${intended.record.state === "merged" ? "merged" : "closed"}. Unlink it to create a new pull request.`,
              }),
            );
        }
        // The source branch may have only one open pull request, whether or not one is linked.
        const open = yield* findSingleOpen(client, context, sourceBranch);
        intended ??= open;
        if (intended && intended.sourceBranch !== sourceBranch)
          return yield* Effect.fail(
            new HostValidationError({
              field: "sourceBranch",
              message: `GitLab pull request #${intended.record.number} uses source branch ${intended.sourceBranch}, not ${sourceBranch}. Link the pull request of ${sourceBranch}.`,
            }),
          );
        if (intended && intended.targetBranch !== targetBranch)
          return yield* Effect.fail(
            new HostValidationError({
              field: "targetBranch",
              message: `GitLab pull request #${intended.record.number} targets ${intended.targetBranch}, not ${targetBranch}. Change its target branch in GitLab, or change the task target branch.`,
            }),
          );
        const title = input.title.trim();
        // An update without the prefix would mark a draft ready for review and notify reviewers.
        const keepsDraft = intended?.record.state === "draft" && !DRAFT_TITLE_PREFIX.test(title);
        const saved = yield* client.json(
          context,
          intended
            ? {
                operation: "update pull request",
                path: mergeRequestsPath(context, `/${intended.record.number}`),
                method: "PUT",
                json: { title: keepsDraft ? `Draft: ${title}` : title, description: input.body },
              }
            : {
                operation: "create pull request",
                path: mergeRequestsPath(context),
                method: "POST",
                json: {
                  source_branch: sourceBranch,
                  target_branch: targetBranch,
                  title,
                  description: input.body,
                },
              },
          gitlabMergeRequestSchema,
        );
        return gitlabPullRequest(saved, context.identity).record;
      }),
  };
};
