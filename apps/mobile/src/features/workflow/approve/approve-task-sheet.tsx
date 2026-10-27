import { getGitConflictTitle } from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import type { PullRequest, WorkspaceRecord } from "@openducktor/contracts";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useTaskApprovalFlow } from "@openducktor/frontend-core/tasks/approval/use-task-approval-flow";
import { buildTaskResetImplementationConfirmCopy } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { pullRequestLabel } from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import { useTaskGitConflictResolver } from "@openducktor/frontend-core/tasks/workflow/use-task-git-conflict-resolver";
import { getTaskApprovalModalHeader } from "@openducktor/frontend-core/tasks/approval/task-approval-modal-header";
import { useTaskApprovalReads } from "@openducktor/frontend-core/tasks/approval/use-task-approval-reads";
import { useTaskResetFlow } from "@openducktor/frontend-core/tasks/workflow/use-task-reset-flow";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { EmptyState, LoadingState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { ResetImplementationConfirmation } from "../confirm/task-confirmations";
import { RepoSettingsFailure } from "../start-session/repo-settings-failure";
import { SessionStartSheet } from "../start-session/session-start-sheet";
import { useTaskStartFlow } from "../use-task-start-flow";
import { useWorkflowSheetLifecycle } from "../use-workflow-sheet-lifecycle";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import { useWorkflowSheetParams, WorkflowSheetFrame } from "../workflow-sheet-frame";
import { ApprovalStep, CompletionStep, ConflictStep, MissingWorktreeStep } from "./approval-views";

const TITLE = "Approve Task";

/** Approve Task: Direct Merge, Pull Request, or Close Task, with the conflict and publish steps. */
export function ApproveTaskRoute(): ReactElement {
  const { workspaceId, taskId } = useWorkflowSheetParams();
  return (
    <WorkflowSheetFrame title={TITLE} workspaceId={workspaceId} taskId={taskId}>
      {(workspace, id) => <ApproveTaskContent workspace={workspace} taskId={id} />}
    </WorkflowSheetFrame>
  );
}

function ApproveTaskContent({
  workspace,
  taskId,
}: {
  workspace: WorkspaceRecord;
  taskId: string;
}): ReactElement {
  const { feedback } = useClientConnection();
  const { flow, navigation, tasks, sessions, settings, branchesFailure, gitProvider } =
    useTaskStartFlow(workspace);
  const { refreshTasks, closeTask, resetTaskImplementation } = useRequiredContext(
    TasksStateContext,
    "ApproveTaskContent",
  );
  const { workspaceId, workspaceName, repoPath } = workspace;
  const activeWorkspace = useMemo(
    () => ({ workspaceId, workspaceName, repoPath }),
    [repoPath, workspaceId, workspaceName],
  );
  const workspaceIdentity = useMemo(() => ({ workspaceId, repoPath }), [repoPath, workspaceId]);
  const task = tasks.find((entry) => entry.id === taskId) ?? null;
  const { close, openSession } = navigation;
  const { resetImplementationModal, openResetImplementation } = useTaskResetFlow({
    tasks,
    workspaceIdentity,
    resetTaskImplementation,
    // The sheet closes when no step stays open.
    closeTaskDetails: () => {},
  });
  const resolveConflict = useTaskGitConflictResolver({
    activeWorkspaceId: workspaceId,
    workspaceRepoPath: repoPath,
    tasks,
    sessions,
    startSessionIntent: flow.startSessionIntent,
    openBuilderSession: (_taskId, session) => openSession(session),
  });
  const [providerFailure, setProviderFailure] = useState<{
    description: string;
    retry: () => void;
  } | null>(null);
  const showPullRequestCreated = useCallback(
    (pullRequest: PullRequest) =>
      feedback.show("success", "Pull request created", {
        description: pullRequestLabel(pullRequest),
      }),
    [feedback],
  );
  const showGitProviderContextLoadFailure = useCallback(
    (description: string, retry: () => void) => setProviderFailure({ description, retry }),
    [],
  );
  const approval = useTaskApprovalFlow({
    activeWorkspace,
    gitProviderContext: gitProvider.context,
    gitProviderContextError: gitProvider.error,
    loadGitProviderContext: gitProvider.load,
    tasks,
    requestPullRequestGeneration: flow.onPullRequestGenerate,
    refreshTasks,
    closeTask,
    openResetImplementation: (id) => openResetImplementation(id, { closeDetailsAfterReset: true }),
    onResolveGitConflict: resolveConflict,
    showPullRequestCreated,
    showGitProviderContextLoadFailure,
  });

  const start = flow.sessionStartModal;
  const conflict = approval.taskGitConflictDialog;
  const modal = approval.taskApprovalModal;
  // The approval can start the pull request or conflict Builder, so it waits for the current
  // repository settings. The sheet closes when no step stays open.
  const triggered = useWorkflowSheetLifecycle({
    ready: task !== null && settings.ready && settings.error === null,
    run: () => {
      if (task) approval.openTaskApproval(task.id);
    },
    anyOpen:
      start?.open === true ||
      resetImplementationModal !== null ||
      conflict?.open === true ||
      modal !== null,
    close,
  });

  if (!task) {
    return (
      <GroupedSheet title={TITLE}>
        <EmptyState
          icon="search-x"
          title="Task Not Found"
          message={`${taskId} is no longer in this workspace.`}
        />
      </GroupedSheet>
    );
  }
  if (settings.error && !triggered) {
    return (
      <GroupedSheet title={TITLE}>
        <RepoSettingsFailure message={settings.error} onRetry={settings.retry} />
      </GroupedSheet>
    );
  }
  if (start?.open) {
    return <SessionStartSheet model={start} branchesFailure={branchesFailure} />;
  }
  if (resetImplementationModal) {
    // The confirmation opens above the sheet; the sheet keeps its frame below it.
    return (
      <GroupedSheet
        title={buildTaskResetImplementationConfirmCopy(resetImplementationModal).title}
        onClose={resetImplementationModal.onCancel}
        closable={!resetImplementationModal.isSubmitting}
      >
        <ResetImplementationConfirmation model={resetImplementationModal} />
      </GroupedSheet>
    );
  }
  return (
    <ApprovalFlowSheet
      conflict={conflict}
      modal={modal}
      providerNotice={
        providerFailure ? (
          <ProviderFailureNotice
            description={providerFailure.description}
            onRetry={() => {
              setProviderFailure(null);
              providerFailure.retry();
            }}
          />
        ) : null
      }
    />
  );
}

type ApprovalFlow = ReturnType<typeof useTaskApprovalFlow>;

/** The conflict step while Git reports a conflict, else the approval steps once they load. */
function ApprovalFlowSheet({
  conflict,
  modal,
  providerNotice,
}: {
  conflict: ApprovalFlow["taskGitConflictDialog"];
  modal: ApprovalFlow["taskApprovalModal"];
  providerNotice: ReactElement | null;
}): ReactElement {
  if (conflict?.open && conflict.conflict) {
    return (
      <GroupedSheet
        title={getGitConflictTitle(conflict.conflict)}
        onClose={() => conflict.onOpenChange(false)}
        closable={!conflict.isHandlingConflict}
      >
        <ConflictStep dialog={conflict} conflict={conflict.conflict} />
      </GroupedSheet>
    );
  }
  if (!modal) {
    return (
      <GroupedSheet title={TITLE}>
        <LoadingState label="Preparing the approval" />
      </GroupedSheet>
    );
  }
  return (
    <GroupedSheet
      title={getTaskApprovalModalHeader(modal).title}
      onClose={() => modal.onOpenChange(false)}
      closable={!modal.isSubmitting}
    >
      <ApprovalStage modal={modal} providerNotice={providerNotice} />
    </GroupedSheet>
  );
}

/** The open step of the approval: the approval, a missing worktree, or the completion. */
function ApprovalStage({
  modal,
  providerNotice,
}: {
  modal: NonNullable<ApprovalFlow["taskApprovalModal"]>;
  providerNotice: ReactElement | null;
}): ReactElement {
  const { impact, isPreparing, mergeCheck } = useTaskApprovalReads(modal);
  switch (modal.stage) {
    case "approval":
      return (
        <ApprovalStep
          model={modal}
          notice={providerNotice}
          impact={impact}
          isPreparing={isPreparing}
          mergeCheck={mergeCheck}
        />
      );
    case "missing_builder_worktree":
      return (
        <MissingWorktreeStep
          model={modal}
          impact={impact.close}
          isPreparing={isPreparing}
          mergeCheck={mergeCheck}
        />
      );
    case "complete_direct_merge":
      return <CompletionStep model={modal} impact={impact.worktree} isPreparing={isPreparing} />;
  }
}

/**
 * The flow offers only Direct Merge after a failed provider read, so the notice says why, with
 * Try Again.
 */
function ProviderFailureNotice({
  description,
  onRetry,
}: {
  description: string;
  onRetry: () => void;
}): ReactElement {
  return (
    <Callout
      tone="warning"
      title="The Git provider did not load"
      message={`${description} Pull Request is not available until the provider loads.`}
      action={<Button label="Try Again" size="sm" variant="gray" onPress={onRetry} />}
    />
  );
}
