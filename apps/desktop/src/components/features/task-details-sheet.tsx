import { IssueTypeBadge, PriorityBadge } from "@/components/features/kanban/kanban-task-badges";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import {
  TaskDetailsDocumentSection,
  TaskDetailsMetadata,
  TaskDetailsSection,
  TaskDetailsSubtasks,
} from "@/components/features/task-details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { statusBadgeVariant, statusLabel } from "@/lib/task-display";
import { useSpecState } from "@/state";
import type { TaskCard } from "@openblueprint/contracts";
import { CheckSquare, CircleHelp, FileCode, PencilLine, ShieldCheck, Sparkles } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";

type TaskDetailsSheetProps = {
  task: TaskCard | null;
  allTasks: TaskCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlan?: (taskId: string) => void;
  onBuild?: (taskId: string) => void;
  onDelegate?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
  onDefer?: (taskId: string) => void;
  onResumeDeferred?: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
};

type TaskDocumentState = {
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
};

type SheetSectionKey = "spec" | "plan" | "qa" | "metadata";
type SheetSectionsState = Record<SheetSectionKey, boolean>;

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

const initialDocumentState = (): TaskDocumentState => ({
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
});

const initialSectionsState = (): SheetSectionsState => ({
  spec: false,
  plan: false,
  qa: false,
  metadata: false,
});

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load document.";

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
}: TaskDetailsSheetProps): ReactElement {
  const { loadSpecDocument, loadPlanDocument, loadQaReportDocument } = useSpecState();
  const [specDoc, setSpecDoc] = useState<TaskDocumentState>(initialDocumentState);
  const [planDoc, setPlanDoc] = useState<TaskDocumentState>(initialDocumentState);
  const [qaDoc, setQaDoc] = useState<TaskDocumentState>(initialDocumentState);
  const [expandedSections, setExpandedSections] =
    useState<SheetSectionsState>(initialSectionsState);
  const taskId = task?.id ?? null;

  const subtasks = task
    ? task.subtaskIds
        .map((subtaskId) => allTasks.find((candidate) => candidate.id === subtaskId))
        .filter((entry): entry is TaskCard => Boolean(entry))
    : [];

  const isEpic = task?.issueType === "epic";
  const shouldRenderSubtasks = isEpic;
  const taskLabels = (task?.labels ?? []).filter((label) => !label.startsWith("phase:"));

  const runWorkflowAction = (action: TaskWorkflowAction): void => {
    if (!task) {
      return;
    }

    switch (action) {
      case "set_spec":
      case "set_plan":
        onPlan?.(task.id);
        return;
      case "open_builder":
        onBuild?.(task.id);
        return;
      case "build_start":
        onDelegate?.(task.id);
        return;
      case "defer_issue":
        onDefer?.(task.id);
        return;
      case "resume_deferred":
        onResumeDeferred?.(task.id);
        return;
      case "human_approve":
        onHumanApprove?.(task.id);
        return;
      case "human_request_changes":
        onHumanRequestChanges?.(task.id);
        return;
      default:
        return;
    }
  };

  useEffect(() => {
    if (!open || !taskId) {
      setSpecDoc(initialDocumentState());
      setPlanDoc(initialDocumentState());
      setQaDoc(initialDocumentState());
      setExpandedSections(initialSectionsState());
      return;
    }

    setExpandedSections(initialSectionsState());

    let alive = true;
    setSpecDoc((previous) => ({ ...previous, isLoading: true, error: null }));
    setPlanDoc((previous) => ({ ...previous, isLoading: true, error: null }));
    setQaDoc((previous) => ({ ...previous, isLoading: true, error: null }));

    const loadDocuments = async (): Promise<void> => {
      const [specResult, planResult, qaResult] = await Promise.allSettled([
        loadSpecDocument(taskId),
        loadPlanDocument(taskId),
        loadQaReportDocument(taskId),
      ]);

      if (!alive) {
        return;
      }

      if (specResult.status === "fulfilled") {
        setSpecDoc({
          markdown: specResult.value.markdown,
          updatedAt: specResult.value.updatedAt,
          isLoading: false,
          error: null,
        });
      } else {
        setSpecDoc({
          markdown: "",
          updatedAt: null,
          isLoading: false,
          error: toErrorMessage(specResult.reason),
        });
      }

      if (planResult.status === "fulfilled") {
        setPlanDoc({
          markdown: planResult.value.markdown,
          updatedAt: planResult.value.updatedAt,
          isLoading: false,
          error: null,
        });
      } else {
        setPlanDoc({
          markdown: "",
          updatedAt: null,
          isLoading: false,
          error: toErrorMessage(planResult.reason),
        });
      }

      if (qaResult.status === "fulfilled") {
        setQaDoc({
          markdown: qaResult.value.markdown,
          updatedAt: qaResult.value.updatedAt,
          isLoading: false,
          error: null,
        });
      } else {
        setQaDoc({
          markdown: "",
          updatedAt: null,
          isLoading: false,
          error: toErrorMessage(qaResult.reason),
        });
      }
    };

    void loadDocuments();
    return () => {
      alive = false;
    };
  }, [loadPlanDocument, loadQaReportDocument, loadSpecDocument, open, taskId]);

  const toggleSection = (section: SheetSectionKey): void => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const aiReviewBadge = useMemo(
    () =>
      task?.aiReviewEnabled ? (
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          AI QA required
        </Badge>
      ) : (
        <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">
          AI QA optional
        </Badge>
      ),
    [task?.aiReviewEnabled],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="h-full max-h-screen gap-0 p-0 sm:max-w-[680px]"
      >
        {task ? (
          <>
            <SheetHeader className="border-b border-slate-200 bg-gradient-to-r from-white via-white to-slate-50/90 px-5 py-4">
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
                  <Badge variant={statusBadgeVariant(task.status)}>
                    {statusLabel(task.status)}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <IssueTypeBadge issueType={task.issueType} />
                  <PriorityBadge priority={task.priority} />
                  {aiReviewBadge}
                  {isEpic ? (
                    <Badge
                      variant="outline"
                      className="border-violet-200 bg-violet-50 text-violet-700"
                    >
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
                <TaskDetailsSection
                  icon={<CircleHelp className="size-3.5" />}
                  title="Description"
                  value={task.description}
                  empty="No description yet."
                />
                <TaskDetailsSection
                  icon={<CheckSquare className="size-3.5" />}
                  title="Acceptance Criteria"
                  value={task.acceptanceCriteria}
                  empty="No acceptance criteria yet."
                />

                <TaskDetailsDocumentSection
                  key={`${task.id}:spec`}
                  icon={<FileCode className="size-3.5" />}
                  title="Specification"
                  description="Canonical spec document used by Planner and Build agents."
                  markdown={specDoc.markdown}
                  updatedAt={specDoc.updatedAt}
                  isLoading={specDoc.isLoading}
                  error={specDoc.error}
                  empty="No specification yet."
                  isExpanded={expandedSections.spec}
                  onToggle={() => toggleSection("spec")}
                />

                <TaskDetailsDocumentSection
                  key={`${task.id}:plan`}
                  icon={<FileCode className="size-3.5" />}
                  title="Implementation Plan"
                  description="Execution plan produced from the approved specification."
                  markdown={planDoc.markdown}
                  updatedAt={planDoc.updatedAt}
                  isLoading={planDoc.isLoading}
                  error={planDoc.error}
                  empty="No implementation plan yet."
                  isExpanded={expandedSections.plan}
                  onToggle={() => toggleSection("plan")}
                />

                <TaskDetailsDocumentSection
                  key={`${task.id}:qa`}
                  icon={<ShieldCheck className="size-3.5" />}
                  title="QA Reports"
                  description="Latest QA review report (history-ready format)."
                  markdown={qaDoc.markdown}
                  updatedAt={qaDoc.updatedAt}
                  isLoading={qaDoc.isLoading}
                  error={qaDoc.error}
                  empty="No QA report yet."
                  isExpanded={expandedSections.qa}
                  onToggle={() => toggleSection("qa")}
                />

                <TaskDetailsMetadata
                  task={task}
                  isExpanded={expandedSections.metadata}
                  onToggle={() => toggleSection("metadata")}
                />
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
              />
            </SheetFooter>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Task Details</SheetTitle>
              <SheetDescription>Select a task to inspect details.</SheetDescription>
            </SheetHeader>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
