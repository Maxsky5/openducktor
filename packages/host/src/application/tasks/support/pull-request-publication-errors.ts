import { HostOperationError, errorMessage } from "../../../effect/host-errors";

export type PublishedBranch = {
  repoPath: string;
  taskId: string;
  remote: string;
  branch: string;
};

export const pullRequestWriteFailure =
  (push: PublishedBranch) =>
  (cause: unknown): HostOperationError<object> =>
    new HostOperationError({
      operation: "publish pull request",
      message: `The branch was pushed to ${push.remote}, but the pull request write did not finish: ${errorMessage(cause)} Check the Git provider before you retry.`,
      cause,
      details: { ...push, pullRequestWrite: "unknown" },
    });

export const pullRequestLinkFailure =
  (push: PublishedBranch, pullRequest: { number: number; url: string }) =>
  (cause: unknown): HostOperationError<object> =>
    new HostOperationError({
      operation: "record pull request",
      message: `The branch was pushed and pull request ${pullRequest.number} was written, but OpenDucktor could not link it to the task: ${errorMessage(cause)} Link the existing pull request before you retry publication.`,
      cause,
      details: {
        ...push,
        pullRequestWrite: "succeeded",
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.url,
      },
    });
