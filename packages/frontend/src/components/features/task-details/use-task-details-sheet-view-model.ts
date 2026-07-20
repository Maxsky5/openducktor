import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import type { SessionTargetOptions } from "@/components/features/kanban/session-target-resolution";
import {
  collectDeleteImpactTaskIds,
  collectSingleTaskCleanupImpactTaskIds,
  runTaskWorkflowAction,
  shouldLoadDocumentSection,
  toSubtasks,
  toTaskLabels,
} from "@/components/features/task-details/task-details-sheet-model";
import type { TaskDetailsSheetProps } from "@/components/features/task-details/task-details-sheet-types";
import { useTaskCleanupImpact } from "@/components/features/task-details/use-task-cleanup-impact";
import { useTaskCloseDialog } from "@/components/features/task-details/use-task-close-dialog";
import { useTaskDeleteDialog } from "@/components/features/task-details/use-task-delete-dialog";
import {
  type DocumentSectionKey,
  type TaskDocumentState,
  useTaskDocuments,
} from "@/components/features/task-details/use-task-documents";
import { useTaskResetDialog } from "@/components/features/task-details/use-task-reset-dialog";
import type { ActiveWorkspace } from "@/types/state-slices";

type TaskDetailsSheetViewModel = {
  taskId: string | null;
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
  isDeleteDialogOpen: boolean;
  isDeletePending: boolean;
  deleteError: string | null;
  isLoadingDeleteImpact: boolean;
  hasManagedDeleteSessionCleanup: boolean;
  deleteManagedWorktreeCount: number;
  deleteImpactError: string | null;
  deleteTerminalCount: number;
  isLoadingResetImpact: boolean;
  hasManagedResetSessionCleanup: boolean;
  resetManagedWorktreeCount: number;
  resetImpactError: string | null;
  resetTerminalCount: number;
  isResetDialogOpen: boolean;
  isResetPending: boolean;
  resetError: string | null;
  isCloseDialogOpen: boolean;
  isClosePending: boolean;
  closeError: string | null;
  isLoadingCloseImpact: boolean;
  hasManagedCloseSessionCleanup: boolean;
  closeManagedWorktreeCount: number;
  closeImpactError: string | null;
  closeTerminalCount: number;
  openDeleteDialog: () => void;
  closeDeleteDialog: () => void;
  handleDeleteDialogOpenChange: (nextOpen: boolean) => void;
  confirmDelete: () => void;
  openResetDialog: () => void;
  closeResetDialog: () => void;
  handleResetDialogOpenChange: (nextOpen: boolean) => void;
  confirmReset: () => void;
  openCloseDialog: () => void;
  closeCloseDialog: () => void;
  handleCloseDialogOpenChange: (nextOpen: boolean) => void;
  confirmClose: () => void;
};

type UseTaskDetailsSheetViewModelOptions = {
  activeWorkspace?: ActiveWorkspace | null;
  task: TaskDetailsSheetProps["task"];
  allTasks: TaskDetailsSheetProps["allTasks"];
  open: TaskDetailsSheetProps["open"];
  onOpenChange: TaskDetailsSheetProps["onOpenChange"];
  onPlan: TaskDetailsSheetProps["onPlan"] | undefined;
  onQaStart: TaskDetailsSheetProps["onQaStart"] | undefined;
  onQaOpen: TaskDetailsSheetProps["onQaOpen"] | undefined;
  onBuild: TaskDetailsSheetProps["onBuild"] | undefined;
  onOpenSession: TaskDetailsSheetProps["onOpenSession"] | undefined;
  resolveSessionOptionsByRole?: ((role: AgentRole) => SessionTargetOptions | undefined) | undefined;
  onDelegate: TaskDetailsSheetProps["onDelegate"] | undefined;
  onHumanApprove: TaskDetailsSheetProps["onHumanApprove"] | undefined;
  onHumanRequestChanges: TaskDetailsSheetProps["onHumanRequestChanges"] | undefined;
  onResetImplementation: TaskDetailsSheetProps["onResetImplementation"] | undefined;
  onResetTask: TaskDetailsSheetProps["onResetTask"] | undefined;
  onCloseTask: TaskDetailsSheetProps["onCloseTask"] | undefined;
  onDelete: TaskDetailsSheetProps["onDelete"] | undefined;
  taskDocumentsHook?: typeof useTaskDocuments;
  taskCleanupImpactHook?: typeof useTaskCleanupImpact;
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
}: UseTaskDetailsSheetViewModelOptions): TaskDetailsSheetViewModel {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const taskId = task?.id ?? null;
  const { specDoc, planDoc, qaDoc, ensureDocumentLoaded } = taskDocumentsHook(
    taskId,
    open,
    workspaceRepoPath ?? "",
  );

  const taskById = useMemo(() => new Map(allTasks.map((entry) => [entry.id, entry])), [allTasks]);
  const deleteImpactTaskIds = useMemo(
    () => collectDeleteImpactTaskIds(task, taskById),
    [task, taskById],
  );
  const singleTaskCleanupImpactTaskIds = useMemo(
    () => collectSingleTaskCleanupImpactTaskIds(task),
    [task],
  );
  const {
    hasManagedSessionCleanup: hasManagedDeleteSessionCleanup,
    managedWorktreeCount: deleteManagedWorktreeCount,
    impactError: deleteImpactError,
    isLoadingImpact: isLoadingDeleteImpact,
    terminalCount: deleteTerminalCount,
  } = taskCleanupImpactHook(deleteImpactTaskIds, open);
  const {
    hasManagedSessionCleanup: hasManagedSingleTaskCleanup,
    managedWorktreeCount: singleTaskCleanupWorktreeCount,
    impactError: singleTaskCleanupImpactError,
    isLoadingImpact: isLoadingSingleTaskCleanupImpact,
    terminalCount: singleTaskTerminalCount,
  } = taskCleanupImpactHook(singleTaskCleanupImpactTaskIds, open);
  const subtasks = useMemo(() => toSubtasks(task, taskById), [task, taskById]);
  const hasSubtasks = subtasks.length > 0;
  const shouldRenderSubtasks = task?.issueType === "epic";
  const taskLabels = useMemo(() => toTaskLabels(task?.labels), [task?.labels]);

  const {
    isDeleteDialogOpen,
    isDeletePending,
    deleteError,
    openDeleteDialog,
    closeDeleteDialog,
    handleDeleteDialogOpenChange,
    confirmDelete,
  } = useTaskDeleteDialog({
    sheetOpen: open,
    task,
    hasSubtasks,
    onOpenChange,
    onDelete,
  });
  const {
    isResetDialogOpen,
    isResetPending,
    resetError,
    openResetDialog,
    closeResetDialog,
    handleResetDialogOpenChange,
    confirmReset,
  } = useTaskResetDialog({
    sheetOpen: open,
    task,
    onOpenChange,
    onResetTask,
  });
  const {
    isCloseDialogOpen,
    isClosePending,
    closeError,
    openCloseDialog,
    closeCloseDialog,
    handleCloseDialogOpenChange,
    confirmClose,
  } = useTaskCloseDialog({
    sheetOpen: open,
    task,
    onOpenChange,
    onCloseTask,
  });

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
    },
    [
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

  const specHasDocument = task?.documentSummary.spec.has;
  const planHasDocument = task?.documentSummary.plan.has;
  const qaHasDocument = task?.documentSummary.qaReport.has;

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
    subtasks,
    shouldRenderSubtasks,
    taskLabels,
    specDoc,
    planDoc,
    qaDoc,
    hasSpecDocument: Boolean(specHasDocument),
    hasPlanDocument: Boolean(planHasDocument),
    hasQaDocument: Boolean(qaHasDocument),
    specSummaryUpdatedAt: task?.documentSummary.spec.updatedAt ?? null,
    planSummaryUpdatedAt: task?.documentSummary.plan.updatedAt ?? null,
    qaSummaryUpdatedAt: task?.documentSummary.qaReport.updatedAt ?? null,
    runWorkflowAction,
    loadSpecDocumentSection,
    loadPlanDocumentSection,
    loadQaDocumentSection,
    isDeleteDialogOpen,
    isDeletePending,
    deleteError,
    isLoadingDeleteImpact,
    hasManagedDeleteSessionCleanup,
    deleteManagedWorktreeCount,
    deleteImpactError,
    deleteTerminalCount,
    // Reset and close both use the selected task's own build/QA session cleanup impact.
    isLoadingResetImpact: isLoadingSingleTaskCleanupImpact,
    hasManagedResetSessionCleanup: hasManagedSingleTaskCleanup,
    resetManagedWorktreeCount: singleTaskCleanupWorktreeCount,
    resetImpactError: singleTaskCleanupImpactError,
    resetTerminalCount: singleTaskTerminalCount,
    isResetDialogOpen,
    isResetPending,
    resetError,
    isCloseDialogOpen,
    isClosePending,
    closeError,
    isLoadingCloseImpact: isLoadingSingleTaskCleanupImpact,
    hasManagedCloseSessionCleanup: hasManagedSingleTaskCleanup,
    closeManagedWorktreeCount: singleTaskCleanupWorktreeCount,
    closeImpactError: singleTaskCleanupImpactError,
    closeTerminalCount: singleTaskTerminalCount,
    openDeleteDialog,
    closeDeleteDialog,
    handleDeleteDialogOpenChange,
    confirmDelete,
    openResetDialog,
    closeResetDialog,
    handleResetDialogOpenChange,
    confirmReset,
    openCloseDialog,
    closeCloseDialog,
    handleCloseDialogOpenChange,
    confirmClose,
  };
}
