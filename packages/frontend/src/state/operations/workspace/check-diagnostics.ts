import type { GitCheck, PathCheck, TaskStoreCheck } from "@openducktor/contracts";
import { isRepoStoreReady } from "@/lib/repo-store-health";
import type { ObservedCheck } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";

export type DiagnosticsToastIssue = {
  id: string;
  title: string;
  description: string;
  severity: "error";
};

export const hasTaskStoreCheckFailure = (check: TaskStoreCheck | null): boolean =>
  check !== null && !isRepoStoreReady(check);

export const buildDiagnosticsToastIssues = ({
  activeWorkspace,
  pathCheck,
  gitCheck,
  taskStoreCheck,
}: {
  activeWorkspace: ActiveWorkspace | null;
  pathCheck: ObservedCheck<PathCheck>;
  gitCheck: ObservedCheck<GitCheck>;
  taskStoreCheck: ObservedCheck<TaskStoreCheck>;
}): DiagnosticsToastIssue[] => {
  if (activeWorkspace === null) return [];
  const issues = [
    toolToast("diagnostics:path", "PATH", pathCheck),
    toolToast("diagnostics:git", "Git", gitCheck),
  ].filter((issue): issue is DiagnosticsToastIssue => issue !== null);
  if (taskStoreCheck.failureKind === "timeout") return issues;
  const store = taskStoreCheck.data;
  let storeDetail = taskStoreCheck.error;
  if (storeDetail === null && store !== null && hasTaskStoreCheckFailure(store)) {
    storeDetail = store.repoStoreHealth.detail ?? store.taskStoreError;
  }
  if (storeDetail) {
    issues.push({
      id: "diagnostics:task-store",
      title:
        taskStoreCheck.error === null ? "Task store unavailable" : "Task store check unavailable",
      description: storeDetail,
      severity: "error",
    });
  }
  return issues;
};

const toolToast = (
  id: string,
  label: string,
  read: ObservedCheck<PathCheck | GitCheck>,
): DiagnosticsToastIssue | null => {
  if (read.failureKind === "timeout") return null;
  if (read.error !== null) {
    return { id, title: `${label} check unavailable`, description: read.error, severity: "error" };
  }
  if (read.data === null || read.data.ok) return null;
  return {
    id,
    title: `${label} unavailable`,
    description: read.data.error ?? `${label} is unavailable.`,
    severity: "error",
  };
};
