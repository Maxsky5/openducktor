import type { ReactElement } from "react";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import { TaskDeleteConfirmDialog } from "@/components/features/task-details/task-delete-confirm-dialog";
import { TaskDetailsSheetBody } from "@/components/features/task-details/task-details-sheet-body";
import { TaskDetailsSheetFooter } from "@/components/features/task-details/task-details-sheet-footer";
import { TaskDetailsSheetHeader } from "@/components/features/task-details/task-details-sheet-header";
import type { TaskDetailsSheetProps } from "@/components/features/task-details/task-details-sheet-types";
import { useTaskDetailsSheetViewModel } from "@/components/features/task-details/use-task-details-sheet-view-model";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const DETAIL_ACTIONS: readonly TaskWorkflowAction[] = [
  "set_spec",
  "set_plan",
  "build_start",
  "open_builder",
  "human_approve",
  "human_request_changes",
  "defer_issue",
  "resume_deferred",
];

export function TaskDetailsSheet({
  task,
  allTasks,
  open,
  onOpenChange,
  onPlan,
  onBuild,
  onDelegate,
  onEdit,
  onDefer,
  onResumeDeferred,
  onHumanApprove,
  onHumanRequestChanges,
  onDelete,
}: TaskDetailsSheetProps): ReactElement {
  const viewModel = useTaskDetailsSheetViewModel({
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
  });

  if (!task) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="h-full max-h-screen gap-0 p-0 sm:max-w-[680px]">
          <SheetHeader>
            <SheetTitle>Task Details</SheetTitle>
            <SheetDescription>Select a task to inspect details.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="h-full max-h-screen gap-0 p-0 sm:max-w-[680px]">
        <SheetHeader className="border-b border-border bg-card px-5 py-4">
          <TaskDetailsSheetHeader
            task={task}
            subtasksCount={viewModel.subtasks.length}
            taskLabels={viewModel.taskLabels}
          />
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TaskDetailsSheetBody
            task={task}
            shouldRenderSubtasks={viewModel.shouldRenderSubtasks}
            subtasks={viewModel.subtasks}
            specDoc={viewModel.specDoc}
            planDoc={viewModel.planDoc}
            qaDoc={viewModel.qaDoc}
            hasSpecDocument={viewModel.hasSpecDocument}
            hasPlanDocument={viewModel.hasPlanDocument}
            hasQaDocument={viewModel.hasQaDocument}
            specSummaryUpdatedAt={viewModel.specSummaryUpdatedAt}
            planSummaryUpdatedAt={viewModel.planSummaryUpdatedAt}
            qaSummaryUpdatedAt={viewModel.qaSummaryUpdatedAt}
            loadSpecDocumentSection={viewModel.loadSpecDocumentSection}
            loadPlanDocumentSection={viewModel.loadPlanDocumentSection}
            loadQaDocumentSection={viewModel.loadQaDocumentSection}
          />
        </div>

        <TaskDetailsSheetFooter
          task={task}
          onOpenChange={onOpenChange}
          includeActions={DETAIL_ACTIONS}
          onWorkflowAction={viewModel.runWorkflowAction}
          {...(onEdit ? { onEdit } : {})}
          {...(onDelete ? { onDeleteSelect: viewModel.openDeleteDialog } : {})}
        />
      </SheetContent>

      {onDelete && viewModel.taskId ? (
        <TaskDeleteConfirmDialog
          open={viewModel.isDeleteDialogOpen}
          onOpenChange={viewModel.handleDeleteDialogOpenChange}
          onCancel={viewModel.closeDeleteDialog}
          onConfirm={viewModel.confirmDelete}
          taskId={viewModel.taskId}
          subtasksCount={viewModel.subtasks.length}
          hasSubtasks={viewModel.subtasks.length > 0}
          isDeletePending={viewModel.isDeletePending}
          deleteError={viewModel.deleteError}
        />
      ) : null}
    </Sheet>
  );
}
