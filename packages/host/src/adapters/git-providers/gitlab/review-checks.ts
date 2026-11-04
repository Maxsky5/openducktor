import type {
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError } from "../../../effect/host-errors";
import {
  type GitlabCommitStatus,
  type GitlabJob,
  type GitlabMergeRequestDetail,
  gitlabCommitStatusSchema,
  gitlabJobSchema,
} from "./models";
import { urlOrNull } from "./review-comments";
import { type GitlabProjectContext, type GitlabRestClient, gitlabProjectPath } from "./rest-client";

type CheckState = Pick<PullRequestReviewCheck, "status" | "conclusion">;

/** Maps a GitLab job or commit status. A failure that GitLab allows does not block. */
const gitlabCheckState = (status: string, allowFailure: boolean): CheckState => {
  switch (status) {
    case "created":
    case "pending":
    case "waiting_for_resource":
    case "waiting_for_callback":
    case "preparing":
    case "scheduled":
      return { status: "queued", conclusion: null };
    case "running":
    case "canceling":
      return { status: "in_progress", conclusion: null };
    case "success":
      return { status: "completed", conclusion: "success" };
    case "failed":
      return { status: "completed", conclusion: allowFailure ? "warning" : "failure" };
    case "canceled":
      return { status: "completed", conclusion: "cancelled" };
    case "skipped":
      return { status: "completed", conclusion: "skipped" };
    case "manual":
      // A manual job blocks the pipeline only when it is not allowed to fail.
      return { status: "completed", conclusion: allowFailure ? "skipped" : "action_required" };
    default:
      return { status: "unknown", conclusion: "unknown" };
  }
};

const jobCheck = (job: GitlabJob, kind: "job" | "trigger job"): PullRequestReviewCheck => {
  const allowFailure = job.allow_failure === true;
  const state = gitlabCheckState(job.status, allowFailure);
  return {
    name: job.name,
    workflow: job.stage ?? null,
    ...state,
    url: urlOrNull(job.web_url),
    details: `GitLab ${kind} status: ${job.status}${allowFailure ? "; allowed to fail" : ""}`,
    startedAt: job.started_at ?? null,
    completedAt: state.status === "completed" ? (job.finished_at ?? null) : null,
  };
};

const statusCheck = (commitStatus: GitlabCommitStatus): PullRequestReviewCheck => {
  const state = gitlabCheckState(commitStatus.status, commitStatus.allow_failure === true);
  return {
    name: commitStatus.name,
    workflow: "External",
    ...state,
    url: urlOrNull(commitStatus.target_url),
    details: commitStatus.description || `GitLab status: ${commitStatus.status}`,
    startedAt: commitStatus.started_at ?? commitStatus.created_at ?? null,
    completedAt: state.status === "completed" ? (commitStatus.finished_at ?? null) : null,
  };
};

export const aggregateGitlabChecks = (
  checks: readonly PullRequestReviewCheck[],
): PullRequestReviewAggregateStatus => {
  if (checks.length === 0) return "unknown";
  if (
    checks.some((check) =>
      ["failure", "cancelled", "timed_out", "action_required"].includes(check.conclusion ?? ""),
    )
  )
    return "failure";
  if (checks.some((check) => check.status === "queued" || check.status === "in_progress"))
    return "pending";
  if (checks.some((check) => check.status === "unknown")) return "unknown";
  return "success";
};

/**
 * Reads the jobs and trigger jobs of the head pipeline and the external commit statuses of the
 * head commit. A status with a job ID of the head pipeline is the same check, so it is left out.
 */
export const readGitlabChecks = (
  client: GitlabRestClient,
  context: GitlabProjectContext,
  mergeRequest: GitlabMergeRequestDetail,
): Effect.Effect<PullRequestReviewCheck[], HostError> =>
  Effect.gen(function* () {
    const pipelineId = mergeRequest.head_pipeline?.id;
    const pipelinePath = (suffix: string) =>
      gitlabProjectPath(context.project.id, `/pipelines/${pipelineId}${suffix}`);
    const [jobs, bridges, statuses] = yield* Effect.all(
      [
        pipelineId === undefined
          ? Effect.succeed([])
          : client.pages(
              context,
              { operation: "read pipeline jobs", path: pipelinePath("/jobs") },
              gitlabJobSchema,
            ),
        pipelineId === undefined
          ? Effect.succeed([])
          : client.pages(
              context,
              { operation: "read pipeline trigger jobs", path: pipelinePath("/bridges") },
              gitlabJobSchema,
            ),
        mergeRequest.sha
          ? client.pages(
              context,
              {
                operation: "read commit statuses",
                path: gitlabProjectPath(
                  context.project.id,
                  `/repository/commits/${encodeURIComponent(mergeRequest.sha)}/statuses`,
                ),
                // GitLab puts statuses that external tools post in the `external` stage. Without
                // the filter, native jobs of other pipelines on this commit, such as the branch
                // pipeline beside a merged-results pipeline, would count as checks.
                query: { stage: "external" },
              },
              gitlabCommitStatusSchema,
            )
          : Effect.succeed([]),
      ],
      { concurrency: 3 },
    );
    const jobIds = new Set([...jobs, ...bridges].map((job) => job.id));
    return [
      ...jobs.map((job) => jobCheck(job, "job")),
      ...bridges.map((bridge) => jobCheck(bridge, "trigger job")),
      ...statuses.filter((status) => !jobIds.has(status.id)).map(statusCheck),
    ];
  });
