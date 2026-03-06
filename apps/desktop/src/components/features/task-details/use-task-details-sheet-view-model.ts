import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo } from "react";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import {
  collectDeleteImpactTaskIds,
  runTaskWorkflowAction,
  shouldLoadDocumentSection,
  toSubtasks,
  toTaskLabels,
} from "@/components/features/task-details/task-details-sheet-model";
import type { TaskDetailsSheetProps } from "@/components/features/task-details/task-details-sheet-types";
import { useTaskDeleteDialog } from "@/components/features/task-details/use-task-delete-dialog";
import { useTaskDeleteImpact } from "@/components/features/task-details/use-task-delete-impact";
import {
  type DocumentSectionKey,
  type TaskDocumentState,
  useTaskDocuments,
} from "@/components/features/task-details/use-task-documents";

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
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  impactError: string | null;
  openDeleteDialog: () => void;
  closeDeleteDialog: () => void;
  handleDeleteDialogOpenChange: (nextOpen: boolean) => void;
  confirmDelete: () => void;
};

type UseTaskDetailsSheetViewModelOptions = {
  task: TaskDetailsSheetProps["task"];
  allTasks: TaskDetailsSheetProps["allTasks"];
  open: TaskDetailsSheetProps["open"];
  onOpenChange: TaskDetailsSheetProps["onOpenChange"];
  onPlan: TaskDetailsSheetProps["onPlan"] | undefined;
  onBuild: TaskDetailsSheetProps["onBuild"] | undefined;
  onDelegate: TaskDetailsSheetProps["onDelegate"] | undefined;
  onDefer: TaskDetailsSheetProps["onDefer"] | undefined;
  onResumeDeferred: TaskDetailsSheetProps["onResumeDeferred"] | undefined;
  onHumanApprove: TaskDetailsSheetProps["onHumanApprove"] | undefined;
  onHumanRequestChanges: TaskDetailsSheetProps["onHumanRequestChanges"] | undefined;
  onDelete: TaskDetailsSheetProps["onDelete"] | undefined;
};

export function useTaskDetailsSheetViewModel({
  task,
  allTasks,
  open,
  onOpenChange,
  onPlan,
  onBuild,
  onDelegate,
  onDefer,
  onResumeDeferred,
  onHumanApprove,
  onHumanRequestChanges,
  onDelete,
}: UseTaskDetailsSheetViewModelOptions): TaskDetailsSheetViewModel {
  const taskId = task?.id ?? null;
  const { specDoc, planDoc, qaDoc, ensureDocumentLoaded } = useTaskDocuments(taskId, open);

  const taskById = useMemo(() => new Map(allTasks.map((entry) => [entry.id, entry])), [allTasks]);
  const deleteImpactTaskIds = useMemo(
    () => collectDeleteImpactTaskIds(task, taskById),
    [task, taskById],
  );
  const { hasManagedSessionCleanup, managedWorktreeCount, impactError } = useTaskDeleteImpact(
    deleteImpactTaskIds,
    open,
  );
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

  const runWorkflowAction = useCallback(
    (action: TaskWorkflowAction): void => {
      runTaskWorkflowAction(action, taskId, {
        onPlan,
        onBuild,
        onDelegate,
        onDefer,
        onResumeDeferred,
        onHumanApprove,
        onHumanRequestChanges,
      });
    },
    [
      onBuild,
      onDefer,
      onDelegate,
      onHumanApprove,
      onHumanRequestChanges,
      onPlan,
      onResumeDeferred,
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
    hasManagedSessionCleanup,
    managedWorktreeCount,
    impactError,
    openDeleteDialog,
    closeDeleteDialog,
    handleDeleteDialogOpenChange,
    confirmDelete,
  };
}
