import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  classifyDiagnosticsQueryError,
  taskStoreCheckQueryOptionsOrSkip,
} from "@openducktor/frontend-core/queries/checks";
import { repositoryGitProviderContextQueryOptions } from "@openducktor/frontend-core/queries/git-provider-context";
import { taskCreationBlockedReason } from "@openducktor/frontend-core/tasks/board/task-creation-availability";
import {
  type IssueImportState,
  toIssueImportState,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-provider";
import { useQuery } from "@tanstack/react-query";

/** Whether the workspace can create tasks now, and whether it can import issues. */
export type BoardAvailability = {
  /** Why New task cannot run, or null when it can. */
  creationBlockedReason: string | null;
  importState: IssueImportState;
};

export function useBoardAvailability(workspace: WorkspaceRecord): BoardAvailability {
  const taskStore = useQuery(taskStoreCheckQueryOptionsOrSkip(workspace.repoPath));
  const provider = useQuery(repositoryGitProviderContextQueryOptions(workspace.repoPath));
  return {
    creationBlockedReason: taskCreationBlockedReason({
      data: taskStore.data ?? null,
      error: taskStore.error ? classifyDiagnosticsQueryError(taskStore.error).message : null,
    }),
    importState: toIssueImportState(provider.data, provider.error),
  };
}
