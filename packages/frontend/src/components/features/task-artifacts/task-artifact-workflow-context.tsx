import type { ResolvedTaskCard, TaskWorkflow } from "@openducktor/workflows";
import type { PropsWithChildren, ReactElement } from "react";
import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { taskWorkflowContextQueryOptions } from "@openducktor/frontend-core/queries/task-workflow-context";
import { Button } from "@/components/ui/button";

const ArtifactWorkflowContext = createContext<TaskWorkflow | null>(null);
export function TaskArtifactWorkflowScope({
  repoPath,
  workspaceId,
  taskId,
  task,
  children,
}: PropsWithChildren<{
  repoPath: string;
  workspaceId: string;
  taskId: string;
  task?: ResolvedTaskCard | undefined;
}>): ReactElement {
  const query = useQuery({
    ...taskWorkflowContextQueryOptions({ workspaceId, repoPath }, taskId),
    enabled: !task,
  });
  if (task && task.id !== taskId)
    throw new Error("Artifact workflow does not match this task. Reload the task.");
  const taskWorkflow = task?.taskWorkflow ?? query.data?.taskWorkflow;
  if (!task && query.isError)
    return (
      <div role="alert" className="p-4 text-sm">
        <p>{query.error.message}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Reload task workflow
        </Button>
      </div>
    );
  if (!taskWorkflow)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading task workflow...
      </p>
    );
  return (
    <ArtifactWorkflowContext.Provider value={taskWorkflow}>
      {children}
    </ArtifactWorkflowContext.Provider>
  );
}
export const useArtifactWorkflow = (): TaskWorkflow => {
  const taskWorkflow = useContext(ArtifactWorkflowContext);
  if (!taskWorkflow) throw new Error("Artifact controls require the task workflow.");
  return taskWorkflow;
};
