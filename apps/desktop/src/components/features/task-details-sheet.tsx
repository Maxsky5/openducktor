import { IssueTypeBadge, PriorityBadge } from "@/components/features/kanban/kanban-task-badges";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import {
  TaskDetailsAsyncDocumentSection,
  TaskDetailsDocumentSection,
  TaskDetailsMetadata,
  TaskDetailsSubtasks,
} from "@/components/features/task-details";
import {
  runTaskWorkflowAction,
  shouldLoadDocumentSection,
  toSubtasks,
  toTaskLabels,
} from "@/components/features/task-details/task-details-sheet-model";
import { useTaskDeleteDialog } from "@/components/features/task-details/use-task-delete-dialog";
import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { statusBadgeVariant, statusLabel } from "@/lib/task-display";
import type { TaskCard } from "@openducktor/contracts";
import {
  CheckSquare,
  CircleHelp,
  FileCode,
  Loader2,
  PencilLine,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { type ReactElement, useCallback, useMemo } from "react";

type TaskDetailsSheetProps = {
  task: TaskCard | null;
  allTasks: TaskCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlan?: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild?: (taskId: string) => void;
  onDelegate?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
  onDefer?: (taskId: string) => void;
  onResumeDeferred?: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
  onDelete?: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};

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

const DESCRIPTION_ICON = <CircleHelp className="size-3.5" />;
const ACCEPTANCE_CRITERIA_ICON = <CheckSquare className="size-3.5" />;
const SPEC_ICON = <FileCode className="size-3.5" />;
const QA_ICON = <ShieldCheck className="size-3.5" />;

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
  const taskId = task?.id ?? null;
  const { specDoc, planDoc, qaDoc, ensureDocumentLoaded } = useTaskDocuments(taskId, open);

  const taskById = useMemo(() => new Map(allTasks.map((entry) => [entry.id, entry])), [allTasks]);
  const subtasks = useMemo(() => toSubtasks(task, taskById), [task, taskById]);
  const hasSubtasks = subtasks.length > 0;

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

  const isEpic = task?.issueType === "epic";
  const shouldRenderSubtasks = isEpic;
  const taskLabels = useMemo(() => toTaskLabels(task?.labels), [task?.labels]);
  const specSummary = task?.documentSummary.spec;
  const planSummary = task?.documentSummary.plan;
  const qaSummary = task?.documentSummary.qaReport;

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

  const loadSpecDocumentSection = useCallback((): void => {
    if (!shouldLoadDocumentSection(task?.documentSummary.spec.has)) {
      return;
    }
    ensureDocumentLoaded("spec");
  }, [ensureDocumentLoaded, task]);

  const loadPlanDocumentSection = useCallback((): void => {
    if (!shouldLoadDocumentSection(task?.documentSummary.plan.has)) {
      return;
    }
    ensureDocumentLoaded("plan");
  }, [ensureDocumentLoaded, task]);

  const loadQaDocumentSection = useCallback((): void => {
    if (!shouldLoadDocumentSection(task?.documentSummary.qaReport.has)) {
      return;
    }
    ensureDocumentLoaded("qa");
  }, [ensureDocumentLoaded, task]);

  if (!task) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="h-full max-h-screen gap-0 p-0 sm:max-w-[680px]"
        >
          <SheetHeader>
            <SheetTitle>Task Details</SheetTitle>
            <SheetDescription>Select a task to inspect details.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  const aiReviewBadge = task.aiReviewEnabled ? (
    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
      AI QA required
    </Badge>
  ) : (
    <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">
      AI QA optional
    </Badge>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="h-full max-h-screen gap-0 p-0 sm:max-w-[680px]"
      >
        <SheetHeader className="border-b border-slate-200 bg-white px-5 py-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <SheetTitle className="flex items-center gap-2 text-xl">
                  <Sparkles className="size-5 shrink-0 text-sky-600" />
                  <span className="truncate">{task.title}</span>
                </SheetTitle>
                <SheetDescription className="truncate font-mono text-xs text-slate-500">
                  {task.id}
                </SheetDescription>
              </div>
              <Badge variant={statusBadgeVariant(task.status)}>{statusLabel(task.status)}</Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <IssueTypeBadge issueType={task.issueType} />
              <PriorityBadge priority={task.priority} />
              {aiReviewBadge}
              {isEpic ? (
                <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                  {subtasks.length} subtask{subtasks.length === 1 ? "" : "s"}
                </Badge>
              ) : null}
            </div>

            {taskLabels.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {taskLabels.map((label) => (
                  <Badge
                    key={label}
                    variant="outline"
                    className="h-6 rounded-full border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-700"
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-3 px-5 py-4">
            <TaskDetailsDocumentSection
              key={`${task.id}:description`}
              icon={DESCRIPTION_ICON}
              title="Description"
              markdown={task.description}
              updatedAt={null}
              empty="No description yet."
              defaultExpanded
            />
            <TaskDetailsDocumentSection
              key={`${task.id}:acceptance-criteria`}
              icon={ACCEPTANCE_CRITERIA_ICON}
              title="Acceptance Criteria"
              markdown={task.acceptanceCriteria}
              updatedAt={null}
              empty="No acceptance criteria yet."
            />

            <TaskDetailsAsyncDocumentSection
              key={`${task.id}:spec`}
              icon={SPEC_ICON}
              title="Specification"
              empty="No specification yet."
              document={specDoc}
              hasDocument={Boolean(specSummary?.has)}
              summaryUpdatedAt={specSummary?.updatedAt ?? null}
              onLoad={loadSpecDocumentSection}
            />

            <TaskDetailsAsyncDocumentSection
              key={`${task.id}:plan`}
              icon={SPEC_ICON}
              title="Implementation Plan"
              empty="No implementation plan yet."
              document={planDoc}
              hasDocument={Boolean(planSummary?.has)}
              summaryUpdatedAt={planSummary?.updatedAt ?? null}
              onLoad={loadPlanDocumentSection}
            />

            <TaskDetailsAsyncDocumentSection
              key={`${task.id}:qa`}
              icon={QA_ICON}
              title="QA Reports"
              empty="No QA report yet."
              document={qaDoc}
              hasDocument={Boolean(qaSummary?.has)}
              summaryUpdatedAt={qaSummary?.updatedAt ?? null}
              onLoad={loadQaDocumentSection}
            />

            <TaskDetailsMetadata key={`${task.id}:metadata`} task={task} />
            {shouldRenderSubtasks ? <TaskDetailsSubtasks subtasks={subtasks} /> : null}
          </div>
        </div>

        <SheetFooter className="mt-0 flex-none flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {onEdit ? (
              <Button type="button" variant="outline" onClick={() => onEdit(task.id)}>
                <PencilLine className="size-4" />
                Edit
              </Button>
            ) : null}
          </div>

          <TaskWorkflowActionGroup
            task={task}
            includeActions={DETAIL_ACTIONS}
            onAction={runWorkflowAction}
            menuAlign="end"
            className="min-w-[240px] justify-end"
            primaryClassName="font-semibold"
            emptyLabel="No available workflow action"
            {...(onDelete
              ? {
                  extraMenuActions: [
                    {
                      id: "delete-task",
                      label: "Delete task",
                      icon: <Trash2 className="size-3.5" />,
                      destructive: true,
                      onSelect: openDeleteDialog,
                    },
                  ],
                }
              : {})}
          />
        </SheetFooter>
      </SheetContent>

      <Dialog open={isDeleteDialogOpen} onOpenChange={handleDeleteDialogOpenChange}>
        <DialogContent className="max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Task</DialogTitle>
            <DialogDescription>
              {hasSubtasks
                ? `Delete ${task.id} and its ${subtasks.length} direct subtask${
                    subtasks.length === 1 ? "" : "s"
                  }? This cannot be undone.`
                : `Delete ${task.id}? This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <p className="font-medium">This action permanently removes the task from Beads.</p>
            {hasSubtasks ? (
              <p>
                Direct subtasks will also be deleted to avoid orphaned children in the workflow.
              </p>
            ) : null}
            {deleteError ? <p className="text-rose-700">{deleteError}</p> : null}
          </div>

          <DialogFooter className="mt-6 flex flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-[132px] justify-center disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-100"
              disabled={isDeletePending}
              onClick={closeDeleteDialog}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-[132px] justify-center disabled:bg-rose-400 disabled:text-rose-50 disabled:opacity-100"
              disabled={isDeletePending}
              aria-busy={isDeletePending}
              onClick={confirmDelete}
            >
              {isDeletePending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {isDeletePending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
