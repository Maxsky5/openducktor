import type { PullRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { HostValidationError } from "../../../effect/host-errors";
import type { ProviderPullRequest } from "../../../ports/git-provider-port";

const shaSchema = z.string().min(1);
const nullableText = z.string().nullish();

export const gitlabMergeRequestSchema = z.object({
  iid: z.number().int().positive(),
  title: z.string().min(1),
  description: nullableText,
  state: z.enum(["opened", "closed", "locked", "merged"]),
  draft: z.boolean().optional(),
  source_branch: z.string().min(1),
  target_branch: z.string().min(1),
  source_project_id: z.number().int().positive(),
  target_project_id: z.number().int().positive(),
  web_url: z.url(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  merged_at: nullableText,
  closed_at: nullableText,
  sha: shaSchema.nullish(),
});
export type GitlabMergeRequest = z.output<typeof gitlabMergeRequestSchema>;

/** `GET /merge_requests/:iid` adds the head pipeline and the diff refs. */
export const gitlabMergeRequestDetailSchema = gitlabMergeRequestSchema.extend({
  head_pipeline: z.object({ id: z.number().int().positive() }).nullish(),
});
export type GitlabMergeRequestDetail = z.output<typeof gitlabMergeRequestDetailSchema>;

export const gitlabJobSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  stage: z.string().nullish(),
  status: z.string().min(1),
  allow_failure: z.boolean().optional(),
  started_at: nullableText,
  finished_at: nullableText,
  web_url: nullableText,
});
export type GitlabJob = z.output<typeof gitlabJobSchema>;

export const gitlabCommitStatusSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  status: z.string().min(1),
  target_url: nullableText,
  description: nullableText,
  created_at: nullableText,
  started_at: nullableText,
  finished_at: nullableText,
  allow_failure: z.boolean().optional(),
});
export type GitlabCommitStatus = z.output<typeof gitlabCommitStatusSchema>;

const userSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1),
  avatar_url: nullableText,
});
export type GitlabUserBasic = z.output<typeof userSchema>;

export const gitlabPositionSchema = z.object({
  base_sha: shaSchema.nullish(),
  start_sha: shaSchema.nullish(),
  head_sha: shaSchema.nullish(),
  old_path: nullableText,
  new_path: nullableText,
  old_line: z.number().int().positive().nullish(),
  new_line: z.number().int().positive().nullish(),
});
export type GitlabPosition = z.output<typeof gitlabPositionSchema>;

export const gitlabNoteSchema = z.object({
  id: z.number().int().positive(),
  type: nullableText,
  body: z.string(),
  author: userSchema,
  created_at: nullableText,
  updated_at: nullableText,
  system: z.boolean(),
  resolvable: z.boolean().optional(),
  resolved: z.boolean().optional(),
  position: gitlabPositionSchema.nullish(),
});
export type GitlabNote = z.output<typeof gitlabNoteSchema>;

export const gitlabDiscussionSchema = z.object({
  id: z.string().min(1),
  individual_note: z.boolean(),
  notes: z.array(gitlabNoteSchema),
});
export type GitlabDiscussion = z.output<typeof gitlabDiscussionSchema>;

export const gitlabVersionSchema = z.object({
  id: z.number().int().positive(),
  head_commit_sha: shaSchema,
  base_commit_sha: shaSchema,
  start_commit_sha: shaSchema,
});

export const gitlabVersionDiffsSchema = z.object({
  diffs: z.array(
    z.object({
      old_path: z.string(),
      new_path: z.string(),
      diff: z.string(),
    }),
  ),
});

export const gitlabApprovalsSchema = z.object({
  approved_by: z.array(z.object({ user: userSchema, approved_at: nullableText })),
});

export const gitlabReviewerSchema = z.object({
  user: userSchema,
  state: z.string().min(1),
});

export const gitlabIssueSchema = z.object({
  iid: z.number().int().positive(),
  title: z.string().min(1),
  description: nullableText,
  state: z.string().min(1),
  author: z.object({ username: z.string().min(1) }).nullish(),
  labels: z.array(z.string()),
  web_url: z.url(),
  updated_at: z.string().min(1),
  issue_type: z.string().min(1),
});
export type GitlabIssue = z.output<typeof gitlabIssueSchema>;

const pullRequestState = (mergeRequest: GitlabMergeRequest): PullRequest["state"] => {
  switch (mergeRequest.state) {
    case "opened":
    case "locked":
      return mergeRequest.draft === true ? "draft" : "open";
    case "merged":
      return "merged";
    case "closed":
      return "closed_unmerged";
  }
};

/** Maps a GitLab merge request. Its `iid` is the pull request number. */
export const gitlabPullRequest = (
  mergeRequest: GitlabMergeRequest,
  repositoryIdentity: string,
  observedAt = new Date().toISOString(),
): ProviderPullRequest => {
  const state = pullRequestState(mergeRequest);
  const record: PullRequest = {
    providerId: "gitlab",
    repositoryIdentity,
    number: mergeRequest.iid,
    url: mergeRequest.web_url,
    state,
    createdAt: mergeRequest.created_at,
    updatedAt: mergeRequest.updated_at,
    lastSyncedAt: observedAt,
  };
  if (state === "merged" && mergeRequest.merged_at) record.mergedAt = mergeRequest.merged_at;
  if (state === "closed_unmerged" && mergeRequest.closed_at)
    record.closedAt = mergeRequest.closed_at;
  return {
    record,
    sourceBranch: mergeRequest.source_branch,
    targetBranch: mergeRequest.target_branch,
  };
};

/** OpenDucktor pushes the task branch to the configured project, so a fork merge request never gets it. */
export const requireSameProjectMergeRequest = (
  mergeRequest: GitlabMergeRequest,
  projectId: number,
): Effect.Effect<GitlabMergeRequest, HostValidationError> =>
  mergeRequest.source_project_id === projectId && mergeRequest.target_project_id === projectId
    ? Effect.succeed(mergeRequest)
    : Effect.fail(
        new HostValidationError({
          field: "pullRequest.number",
          message: `GitLab pull request #${mergeRequest.iid} merges a branch from another project, such as a fork. OpenDucktor supports pull requests within the configured project only. Link a pull request whose source branch is in this project.`,
        }),
      );

/**
 * Checks that a linked pull request is a GitLab merge request. With an identity, it also checks
 * that the merge request belongs to that project.
 */
export const requireGitlabLinkedPullRequest = (
  pullRequest: PullRequest,
  repositoryIdentity?: string,
): Effect.Effect<void, HostValidationError> => {
  if (pullRequest.providerId !== "gitlab")
    return Effect.fail(
      new HostValidationError({
        field: "pullRequest.providerId",
        message: `Pull request provider '${pullRequest.providerId}' does not match configured provider 'gitlab'.`,
      }),
    );
  if (!pullRequest.repositoryIdentity)
    return Effect.fail(
      new HostValidationError({
        field: "pullRequest.repositoryIdentity",
        message:
          "The linked GitLab pull request has no project identity. Unlink it and link it again before retrying.",
      }),
    );
  if (repositoryIdentity !== undefined && pullRequest.repositoryIdentity !== repositoryIdentity)
    return Effect.fail(
      new HostValidationError({
        field: "pullRequest.repositoryIdentity",
        message:
          "The linked GitLab pull request belongs to another project. Restore the original repository settings, or unlink it and link the correct pull request.",
      }),
    );
  return Effect.void;
};
