import {
  CreateTaskInputSchema,
  SearchTasksInputSchema,
  createTaskResultSchema,
  searchTasksResultSchema,
  type PublicTaskSummaryTask,
} from "@openducktor/contracts";
import { ImageIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useState, type ComponentProps, type ReactElement } from "react";
import type { Components, ExtraProps } from "react-markdown";
import type { ZodType } from "zod";
import { IssueTypeBadge } from "@/components/features/kanban/issue-type-badge";
import { PriorityBadge } from "@/components/features/kanban/priority-badge";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { OpenTaskDetailsButton } from "@/components/features/tasks/open-task-details-button";
import { TaskDetailsSheetPlaceholder } from "@/components/features/task-details/task-details-sheet-placeholder";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { TaskLabelChip } from "@/components/ui/task-label-chip";
import { statusBadgeClassName, statusLabel } from "@/lib/task-status-presentation";
import { cn } from "@/lib/utils";
import { buildTaskDescriptionPreviewMarkdown } from "./agent-chat-task-description-preview";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { RegularToolMessage } from "./agent-chat-regular-tool-message";
import { getToolLifecyclePhase } from "./tool-lifecycle";

type TaskTool = "create_task" | "search_tasks";

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

const TASK_DESCRIPTION_PREVIEW_COMPONENTS: Components = {
  img: TaskDescriptionPreviewImage,
};

const TaskDetailsSheetViewer = lazy(
  () => import("@/components/features/tasks/task-details-sheet-viewer"),
);

const readTaskToolResult = <Result,>(
  schema: ZodType<Result>,
  output: string | undefined,
): Result | null => {
  if (!output) return null;
  try {
    const result = schema.safeParse(JSON.parse(output));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

const taskSearchSummary = (meta: ToolMeta): string => {
  const input = SearchTasksInputSchema.safeParse(meta.input);
  const filters: string[] = [];
  if (input.success) {
    const { title, status, issueType, priority, tags, limit } = input.data;
    if (title) filters.push(`title: ${title}`);
    if (status) filters.push(`status: ${status}`);
    if (issueType) filters.push(`type: ${issueType}`);
    if (priority !== undefined) filters.push(`priority: P${priority}`);
    if (tags) filters.push(`tags: ${tags.join(", ")}`);
    filters.push(`limit: ${limit}`);
  } else {
    filters.push(meta.input ? "Invalid search filters" : "Waiting for filters");
  }
  const phase = getToolLifecyclePhase(meta);
  if (phase === "completed") {
    const result = readTaskToolResult(searchTasksResultSchema, meta.output);
    if (result) {
      const { totalCount, results } = result;
      const count = `${totalCount} ${totalCount === 1 ? "result" : "results"}`;
      filters.unshift(results.length < totalCount ? `${count}, ${results.length} returned` : count);
    } else {
      filters.push("Invalid search result");
    }
  }
  if (phase === "failed") filters.push(meta.error || "Tool failed");
  if (phase === "cancelled") filters.push("Tool cancelled");
  return filters.join(" · ");
};

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
            <IssueTypeBadge issueType={task.issueType} />
            <PriorityBadge priority={task.priority} />
            <Badge variant="outline" className={statusBadgeClassName(task.status)}>
              {statusLabel(task.status)}
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
      {detailsOpen && (
        <Suspense fallback={<TaskDetailsSheetPlaceholder onOpenChange={setDetailsOpen} />}>
          <TaskDetailsSheetViewer taskId={task.id} onOpenChange={setDetailsOpen} />
        </Suspense>
      )}
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
  tool: TaskTool;
  timeLabel: string;
  messageContent: string;
  messageTimestamp: string;
  sessionWorkingDirectory?: string | null | undefined;
}) => {
  const phase = getToolLifecyclePhase(meta);
  const completed = phase === "completed";
  const created =
    tool === "create_task" && completed
      ? readTaskToolResult(createTaskResultSchema, meta.output)
      : null;
  const title = CreateTaskInputSchema.shape.title.safeParse(meta.input?.title);
  let summary = completed ? "Invalid task result" : "Creating task";
  if (tool === "search_tasks") summary = taskSearchSummary(meta);
  else if (phase === "failed") summary = meta.error || "Tool failed";
  else if (phase === "cancelled") summary = "Tool cancelled";
  else if (created) summary = created.task.title;
  else if (title.success) summary = title.data;

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
      {created && <TaskResultCard task={created.task} />}
      {tool === "create_task" && completed && !created && (
        <p role="alert" className="text-sm text-destructive">
          OpenDucktor returned an invalid task result. Expand the tool output to inspect the
          response.
        </p>
      )}
    </section>
  );
};
