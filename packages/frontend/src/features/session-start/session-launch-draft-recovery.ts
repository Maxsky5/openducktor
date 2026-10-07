import type {
  WorkflowLaunchSnapshot,
  WorkspaceSessionLaunchSnapshot,
} from "@openducktor/contracts";

type Launch = WorkflowLaunchSnapshot | WorkspaceSessionLaunchSnapshot;
const drafts = new Map<string, () => void>();

/** Keep draft cleanup with the attempt when a view or a toast is replaced. */
export const trackSessionLaunchDraft = (launch: Launch, clear: () => void): void => {
  drafts.set(launchKey(launch), clear);
};

export const updateSessionLaunchDraft = (launch: Launch): void => {
  const key = launchKey(launch);
  const clear = drafts.get(key);
  if (launch.acceptance === "accepted") {
    drafts.delete(key);
    clear?.();
  } else if (
    ["completed", "canceled", "skipped"].includes(launch.phase) ||
    (launch.phase === "failed" && !launch.recoveryAllowed)
  ) {
    drafts.delete(key);
  }
};

const launchKey = (launch: Launch): string =>
  JSON.stringify([
    "taskId" in launch ? "task" : "workspace",
    launch.workspaceId,
    launch.repoPath,
    "taskId" in launch ? launch.taskId : launch.sessionId,
    launch.launchAttemptId,
  ]);
