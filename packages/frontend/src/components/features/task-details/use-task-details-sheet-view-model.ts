import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import {
  SESSION_VIEW_ACTIONS,
  type TaskWorkflowAction,
} from "@/components/features/kanban/kanban-task-workflow";
import type { SessionTargetOptions } from "@/components/features/kanban/session-target-resolution";
import {
  shouldLoadDocumentSection,
  toDocumentSummaryState,
  toSubtasks,
  toTaskLabels,
} from "@/components/features/task-details/task-details-sheet-model";
import type { TaskDetailsSheetProps } from "@/components/features/task-details/task-details-sheet-types";
import { useTaskCleanupImpact } from "@/components/features/task-details/use-task-cleanup-impact";
import {
  type TaskConfirmDialog,
  useTaskConfirmDialog,
} from "@/components/features/task-details/use-task-confirm-dialog";
import {
  type DocumentSectionKey,
  type TaskDocumentState,
  useTaskDocuments,
} from "@/components/features/task-details/use-task-documents";
import { runTaskWorkflowAction } from "@/features/task-workflow/run-task-workflow-action";
import type { TaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { useTaskStopImpact } from "@/state/queries/use-task-stop-impact";
import type { ActiveWorkspace } from "@/types/state-slices";

type TaskDetailsSheetViewModel = {
  taskId: string | null;
  deleteConfirm: TaskConfirmDialog;
  resetConfirm: TaskConfirmDialog;
  closeConfirm: TaskConfirmDialog;
  subtasks: TaskCard[];
  shouldRenderSubtasks: boolean;
  taskLabels: string[];
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
  hasSpecDocument: boolean;
  hasPlanDocument: boolean;
  hasQaDocument: boolean;
  specSummaryUpdatedAt: string | null;
  planSummaryUpdatedAt: string | null;
  qaSummaryUpdatedAt: string | null;
  runWorkflowAction: (action: TaskWorkflowAction) => void;
  loadSpecDocumentSection: () => void;
  loadPlanDocumentSection: () => void;
  loadQaDocumentSection: () => void;
};

type UseTaskDetailsSheetViewModelOptions = {
  activeWorkspace?: ActiveWorkspace | null;
  task: TaskDetailsSheetProps["task"];
  allTasks: TaskDetailsSheetProps["allTasks"];
  open: TaskDetailsSheetProps["open"];
  onOpenChange: TaskDetailsSheetProps["onOpenChange"];
  onPlan?: TaskWorkflowActions["onPlan"] | undefined;
  onQaStart?: TaskWorkflowActions["onQaStart"] | undefined;
  onQaOpen?: TaskWorkflowActions["onQaOpen"] | undefined;
  onBuild?: TaskWorkflowActions["onBuild"] | undefined;
  onOpenSession?: TaskWorkflowActions["onOpenSession"] | undefined;
  resolveSessionOptionsByRole?: ((role: AgentRole) => SessionTargetOptions | undefined) | undefined;
  onDelegate?: TaskWorkflowActions["onDelegate"] | undefined;
  onHumanApprove?: TaskWorkflowActions["onHumanApprove"] | undefined;
  onHumanRequestChanges?: TaskWorkflowActions["onHumanRequestChanges"] | undefined;
  onResetImplementation?: TaskWorkflowActions["onResetImplementation"] | undefined;
  onResetTask?: TaskWorkflowActions["onResetTask"] | undefined;
  onCloseTask?: TaskWorkflowActions["onCloseTask"] | undefined;
  onDelete?: TaskWorkflowActions["onDelete"] | undefined;
  taskDocumentsHook?: typeof useTaskDocuments;
  taskCleanupImpactHook?: typeof useTaskCleanupImpact;
  taskStopImpactHook?: typeof useTaskStopImpact;
};

export function useTaskDetailsSheetViewModel({
  activeWorkspace = null,
  task,
  allTasks,
  open,
  onOpenChange,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
  onOpenSession,
  resolveSessionOptionsByRole,
  onDelegate,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
  onResetTask,
  onCloseTask,
  onDelete,
  taskDocumentsHook = useTaskDocuments,
  taskCleanupImpactHook = useTaskCleanupImpact,
  taskStopImpactHook = useTaskStopImpact,
}: UseTaskDetailsSheetViewModelOptions): TaskDetailsSheetViewModel {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const taskId = task?.id ?? null;
  const taskById = useMemo(() => new Map(allTasks.map((entry) => [entry.id, entry])), [allTasks]);
  const subtasks = useMemo(() => toSubtasks(task, taskById), [task, taskById]);
  const shouldRenderSubtasks = task?.issueType === "epic";
  const taskLabels = useMemo(() => toTaskLabels(task?.labels), [task?.labels]);

  const confirmOptions = {
    task,
    allTasks,
    enabled: open,
    onSucceeded: () => onOpenChange(false),
    taskCleanupImpactHook,
    taskStopImpactHook,
  };
  const deleteConfirm = useTaskConfirmDialog({
    ...confirmOptions,
    action: "delete",
    run: onDelete && ((id) => onDelete(id, { deleteSubtasks: true })),
  });
  const resetConfirm = useTaskConfirmDialog({
    ...confirmOptions,
    action: "reset_task",
    run: onResetTask,
  });
  const closeConfirm = useTaskConfirmDialog({
    ...confirmOptions,
    action: "close",
    run: onCloseTask,
  });
  const { openDialog: openResetDialog } = resetConfirm;
  const { openDialog: openCloseDialog } = closeConfirm;
  const { specDoc, planDoc, qaDoc, ensureDocumentLoaded } = taskDocumentsHook(
    taskId,
    open && !deleteConfirm.dialog.operation.isPending,
    workspaceRepoPath ?? "",
  );
  const runWorkflowAction = useCallback(
    (action: TaskWorkflowAction): void => {
      runTaskWorkflowAction(
        action,
        taskId,
        {
          onPlan,
          onQaStart,
          onQaOpen,
          onBuild,
          onOpenSession,
          onDelegate,
          onHumanApprove,
          onHumanRequestChanges,
          onResetImplementation,
          onResetTask: openResetDialog,
          onCloseTask: openCloseDialog,
        },
        {
          resolveSessionOptions: resolveSessionOptionsByRole,
        },
      );
      // The session opens in place of the current view, so the sheet must not stay over it.
      if (SESSION_VIEW_ACTIONS.has(action)) onOpenChange(false);
    },
    [
      onOpenChange,
      onBuild,
      onDelegate,
      onOpenSession,
      resolveSessionOptionsByRole,
      onHumanApprove,
      onHumanRequestChanges,
      onPlan,
      onQaOpen,
      onQaStart,
      onResetImplementation,
      openResetDialog,
      openCloseDialog,
      taskId,
    ],
  );

  const loadDocumentSection = useCallback(
    (section: DocumentSectionKey, hasDocument: boolean | undefined): void => {
      if (!shouldLoadDocumentSection(hasDocument)) {
        return;
      }
      ensureDocumentLoaded(section);
    },
    [ensureDocumentLoaded],
  );

  const documentSummary = toDocumentSummaryState(task);
  const { specHasDocument, planHasDocument, qaHasDocument } = documentSummary;

  const loadSpecDocumentSection = useCallback((): void => {
    loadDocumentSection("spec", specHasDocument);
  }, [loadDocumentSection, specHasDocument]);

  const loadPlanDocumentSection = useCallback((): void => {
    loadDocumentSection("plan", planHasDocument);
  }, [loadDocumentSection, planHasDocument]);

  const loadQaDocumentSection = useCallback((): void => {
    loadDocumentSection("qa", qaHasDocument);
  }, [loadDocumentSection, qaHasDocument]);

  return {
    taskId,
    deleteConfirm,
    resetConfirm,
    closeConfirm,
    subtasks,
    shouldRenderSubtasks,
    taskLabels,
    specDoc,
    planDoc,
    qaDoc,
    hasSpecDocument: Boolean(specHasDocument),
    hasPlanDocument: Boolean(planHasDocument),
    hasQaDocument: Boolean(qaHasDocument),
    specSummaryUpdatedAt: documentSummary.specUpdatedAt,
    planSummaryUpdatedAt: documentSummary.planUpdatedAt,
    qaSummaryUpdatedAt: documentSummary.qaUpdatedAt,
    runWorkflowAction,
    loadSpecDocumentSection,
    loadPlanDocumentSection,
    loadQaDocumentSection,
  };
}
