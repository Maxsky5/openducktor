import type { TaskCard } from "@openducktor/contracts";
import { CircleHelp } from "lucide-react";
import type { ReactElement } from "react";
import { TaskArtifacts } from "@/components/features/task-artifacts/task-artifacts";
import { TaskDetailsDocumentSection } from "./task-details-document-section";
import { TaskDetailsMetadata } from "./task-details-metadata";
import { TaskDetailsSubtasks } from "./task-details-subtasks";

const DESCRIPTION_ICON = <CircleHelp className="size-3.5" />;
type TaskDetailsSheetBodyProps = {
  task: TaskCard;
  repoPath?: string;
  workspaceId?: string;
  shouldRenderSubtasks: boolean;
  subtasks: TaskCard[];
};

export function TaskDetailsSheetBody({
  task,
  repoPath,
  workspaceId,
  shouldRenderSubtasks,
  subtasks,
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
        taskId={task.id}
        stripTaskDescriptionFrontMatter
        {...(repoPath && task.sourceIssue
          ? {
              issueImageContext: {
                repoPath,
                sourceId: task.sourceIssue.sourceId,
                providerId: task.sourceIssue.providerId,
                taskId: task.id,
              },
            }
          : {})}
        {...(workspaceId
          ? {
              taskAssetContext: {
                workspaceId,
                taskId: task.id,
                scope: "description" as const,
              },
            }
          : {})}
      />
      {repoPath ? (
        <div className="h-[min(60dvh,36rem)] min-h-64 overflow-hidden rounded-lg border border-border">
          <TaskArtifacts
            repoPath={repoPath}
            taskId={task.id}
            {...(workspaceId ? { workspaceId } : {})}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Select a workspace to read artifacts.</p>
      )}
      <TaskDetailsMetadata key={`${task.id}:metadata`} task={task} />
      {shouldRenderSubtasks ? <TaskDetailsSubtasks subtasks={subtasks} /> : null}
    </div>
  );
}
