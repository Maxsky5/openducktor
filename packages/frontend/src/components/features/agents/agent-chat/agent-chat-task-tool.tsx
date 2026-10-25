import type { PublicTaskSummaryTask } from "@openducktor/contracts";
import { ImageIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useState, type ComponentProps, type ReactElement } from "react";
import type { Components, ExtraProps } from "react-markdown";
import { builtinIssueTypeId, builtinStateId } from "@openducktor/workflows";
import { IssueTypeBadge } from "@/components/features/kanban/issue-type-badge";
import { PriorityBadge } from "@/components/features/kanban/priority-badge";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { OpenTaskDetailsButton } from "@/components/features/tasks/open-task-details-button";
import { TaskDetailsSheetFrame } from "@/components/features/task-details/task-details-sheet-frame";
import { TaskDetailsSheetPlaceholder } from "@/components/features/task-details/task-details-sheet-placeholder";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { TaskLabelChip } from "@/components/ui/task-label-chip";
import { statusBadgeClassName } from "@/lib/task-status-presentation";
import { statusLabel } from "@openducktor/frontend-core/tasks/presentation/task-status-presentation";
import { cn } from "@/lib/utils";
import { buildTaskDescriptionPreviewMarkdown } from "./agent-chat-task-description-preview";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { AgentChatTaskToolName } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { RegularToolMessage } from "./agent-chat-regular-tool-message";
import {
  buildTaskToolSummary,
  INVALID_TASK_TOOL_RESULT_MESSAGE,
  resolveTaskToolTask,
  showsInvalidTaskToolAlert,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-task-tool-model";

const TASK_DESCRIPTION_PREVIEW_CLASS_NAME = cn(
  "line-clamp-5 break-words text-muted-foreground",
  "prose-headings:text-muted-foreground prose-strong:text-muted-foreground",
  "prose-em:text-muted-foreground prose-li:text-muted-foreground",
  "prose-blockquote:text-muted-foreground",
);

const TaskDescriptionPreviewImage = ({
  alt,
  title,
}: ComponentProps<"img"> & ExtraProps): ReactElement => (
  <span
    className={cn(
      "mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5",
      "text-[11px] font-medium text-muted-foreground",
    )}
  >
    <ImageIcon aria-hidden="true" className="size-3 shrink-0" />
    <span className="min-w-0 truncate">{alt?.trim() || title?.trim() || "Image"}</span>
  </span>
);

const TaskDescriptionPreviewLink = ({
  children,
}: ComponentProps<"a"> & ExtraProps): ReactElement => <span>{children}</span>;

const TASK_DESCRIPTION_PREVIEW_COMPONENTS: Components = {
  a: TaskDescriptionPreviewLink,
  img: TaskDescriptionPreviewImage,
};

const TaskDetailsSheetViewer = lazy(
  () => import("@/components/features/tasks/task-details-sheet-viewer"),
);

const TaskResultCard = ({ task }: { task: PublicTaskSummaryTask }) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const descriptionPreview = useMemo(
    () => buildTaskDescriptionPreviewMarkdown(task.description ?? ""),
    [task.description],
  );
  return (
    <>
      <Card className="mb-3 min-w-0 max-w-2xl overflow-hidden" data-task-id={task.id}>
        <CardHeader className="gap-1.5 px-4 pt-4">
          <CardTitle className="break-words">{task.title}</CardTitle>
          <div className="flex items-center gap-1.5">
            <TaskIdBadge taskId={task.id} />
            <OpenTaskDetailsButton onClick={() => setDetailsOpen(true)} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <IssueTypeBadge issueType={builtinIssueTypeId(task.issueType)} />
            <PriorityBadge priority={task.priority} />
            <Badge variant="outline" className={statusBadgeClassName(builtinStateId(task.status))}>
              {statusLabel(builtinStateId(task.status))}
            </Badge>
          </div>
          {task.description && (
            <MarkdownRenderer
              markdown={descriptionPreview}
              variant="compact"
              components={TASK_DESCRIPTION_PREVIEW_COMPONENTS}
              className={TASK_DESCRIPTION_PREVIEW_CLASS_NAME}
              lightweight
            />
          )}
          {task.labels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {task.labels.map((label) => (
                <TaskLabelChip key={label} label={label} truncateLabel />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <TaskDetailsSheetFrame open={detailsOpen} onOpenChange={setDetailsOpen}>
        <Suspense fallback={<TaskDetailsSheetPlaceholder onOpenChange={setDetailsOpen} />}>
          <TaskDetailsSheetViewer taskId={task.id} onOpenChange={setDetailsOpen} />
        </Suspense>
      </TaskDetailsSheetFrame>
    </>
  );
};
export const AgentChatTaskTool = ({
  meta,
  tool,
  timeLabel,
  messageContent,
  messageTimestamp,
  sessionWorkingDirectory,
}: {
  meta: ToolMeta;
  tool: AgentChatTaskToolName;
  timeLabel: string;
  messageContent: string;
  messageTimestamp: string;
  sessionWorkingDirectory?: string | null | undefined;
}) => {
  const task = resolveTaskToolTask(tool, meta);
  const summary = buildTaskToolSummary(tool, meta, task);

  return (
    <section aria-label={tool} className="flex min-w-0 flex-col gap-2">
      <RegularToolMessage
        meta={{ ...meta, preview: summary }}
        messageContent={messageContent}
        messageTimestamp={messageTimestamp}
        timeLabel={timeLabel}
        sessionWorkingDirectory={sessionWorkingDirectory}
        displayName={tool}
      />
      {task && <TaskResultCard task={task} />}
      {showsInvalidTaskToolAlert(tool, meta, task) && (
        <p role="alert" className="text-sm text-destructive">
          {INVALID_TASK_TOOL_RESULT_MESSAGE}
        </p>
      )}
    </section>
  );
};
