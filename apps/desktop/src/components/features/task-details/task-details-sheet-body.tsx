import type { TaskCard } from "@openducktor/contracts";
import { CheckSquare, CircleHelp, FileCode, ShieldCheck } from "lucide-react";
import type { ReactElement } from "react";
import {
  TaskDetailsAsyncDocumentSection,
  TaskDetailsDocumentSection,
  TaskDetailsMetadata,
  TaskDetailsSubtasks,
} from "@/components/features/task-details";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";

const DESCRIPTION_ICON = <CircleHelp className="size-3.5" />;
const ACCEPTANCE_CRITERIA_ICON = <CheckSquare className="size-3.5" />;
const SPEC_ICON = <FileCode className="size-3.5" />;
const QA_ICON = <ShieldCheck className="size-3.5" />;

type TaskDetailsSheetBodyProps = {
  task: TaskCard;
  shouldRenderSubtasks: boolean;
  subtasks: TaskCard[];
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
  specSummaryUpdatedAt: string | null;
  planSummaryUpdatedAt: string | null;
  qaSummaryUpdatedAt: string | null;
  hasSpecDocument: boolean;
  hasPlanDocument: boolean;
  hasQaDocument: boolean;
  loadSpecDocumentSection: () => void;
  loadPlanDocumentSection: () => void;
  loadQaDocumentSection: () => void;
};

export function TaskDetailsSheetBody({
  task,
  shouldRenderSubtasks,
  subtasks,
  specDoc,
  planDoc,
  qaDoc,
  specSummaryUpdatedAt,
  planSummaryUpdatedAt,
  qaSummaryUpdatedAt,
  hasSpecDocument,
  hasPlanDocument,
  hasQaDocument,
  loadSpecDocumentSection,
  loadPlanDocumentSection,
  loadQaDocumentSection,
}: TaskDetailsSheetBodyProps): ReactElement {
  return (
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
        hasDocument={hasSpecDocument}
        summaryUpdatedAt={specSummaryUpdatedAt}
        onLoad={loadSpecDocumentSection}
      />

      <TaskDetailsAsyncDocumentSection
        key={`${task.id}:plan`}
        icon={SPEC_ICON}
        title="Implementation Plan"
        empty="No implementation plan yet."
        document={planDoc}
        hasDocument={hasPlanDocument}
        summaryUpdatedAt={planSummaryUpdatedAt}
        onLoad={loadPlanDocumentSection}
      />

      <TaskDetailsAsyncDocumentSection
        key={`${task.id}:qa`}
        icon={QA_ICON}
        title="QA Reports"
        empty="No QA report yet."
        document={qaDoc}
        hasDocument={hasQaDocument}
        summaryUpdatedAt={qaSummaryUpdatedAt}
        onLoad={loadQaDocumentSection}
      />

      <TaskDetailsMetadata key={`${task.id}:metadata`} task={task} />
      {shouldRenderSubtasks ? <TaskDetailsSubtasks subtasks={subtasks} /> : null}
    </div>
  );
}
