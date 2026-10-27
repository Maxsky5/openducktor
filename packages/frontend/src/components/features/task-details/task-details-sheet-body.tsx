import { TASK_DOCUMENT_SECTION_COPY } from "@openducktor/frontend-core/tasks/details/task-details-sheet-model";
import { CircleHelp } from "lucide-react";
import type { ReactElement } from "react";
import { TaskArtifactsSection } from "@/components/features/task-artifacts/task-artifacts";
import { TaskDetailsDocumentSection } from "./task-details-document-section";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const DESCRIPTION_ICON = <CircleHelp className="size-3.5" />;
type TaskDetailsSheetBodyProps = {
  task: TaskCard;
  repoPath?: string;
  workspaceId?: string;
};

export function TaskDetailsSheetBody({
  task,
  repoPath,
  workspaceId,
}: TaskDetailsSheetBodyProps): ReactElement {
  return (
    <div className="space-y-2 px-5 py-4">
      <TaskDetailsDocumentSection
        key={`${task.id}:description`}
        icon={DESCRIPTION_ICON}
        title={TASK_DOCUMENT_SECTION_COPY.description.title}
        markdown={task.description}
        empty={TASK_DOCUMENT_SECTION_COPY.description.empty}
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
        <TaskArtifactsSection
          repoPath={repoPath}
          taskId={task.id}
          artifactSummary={task.artifactSummary}
          {...(workspaceId ? { workspaceId } : {})}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Select a workspace to read artifacts.</p>
      )}
    </div>
  );
}
