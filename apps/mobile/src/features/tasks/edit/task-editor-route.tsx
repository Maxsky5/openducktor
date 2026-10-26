import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import {
  OtherWorkspaceState,
  SelectedWorkspaceGate,
} from "@/features/workspaces/no-open-workspace";
import { EmptyState, LoadingState } from "@/ui/states";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import { TaskEditorSheet } from "./task-editor-sheet";
import { useEditedTask } from "./use-edited-task";
import { routeParam } from "@/navigation/route-params";

/** The New Task sheet of the workspace that its route names. */
export function NewTaskRoute(): ReactElement {
  const params = useLocalSearchParams<{ workspaceId: string }>();
  const workspaceId = routeParam(params.workspaceId);
  const { selectedWorkspace } = useMobileWorkspaces();
  if (
    selectedWorkspace &&
    (workspaceId === null || selectedWorkspace.workspaceId === workspaceId)
  ) {
    return <TaskEditorSheet workspace={selectedWorkspace} task={null} />;
  }
  return (
    <GroupedSheet title="Create Task">
      <SelectedWorkspaceGate>{() => <OtherWorkspaceState />}</SelectedWorkspaceGate>
    </GroupedSheet>
  );
}

/** The Edit Task sheet. The task must belong to the workspace that Tasks shows. */
export function EditTaskRoute(): ReactElement {
  const params = useLocalSearchParams<{ workspaceId: string; taskId: string }>();
  const workspaceId = routeParam(params.workspaceId);
  const taskId = routeParam(params.taskId);
  const { selectedWorkspace } = useMobileWorkspaces();
  if (selectedWorkspace && selectedWorkspace.workspaceId === workspaceId && taskId) {
    return <EditTaskContent taskId={taskId} />;
  }
  return (
    <GroupedSheet title="Edit Task">
      <SelectedWorkspaceGate>{() => <OtherWorkspaceState />}</SelectedWorkspaceGate>
    </GroupedSheet>
  );
}

function EditTaskContent({ taskId }: { taskId: string }): ReactElement {
  const { selectedWorkspace } = useMobileWorkspaces();
  const { tasks, isLoadingTasks } = useRequiredContext(TasksStateContext, "EditTaskContent");
  const task = useEditedTask(tasks.find((entry) => entry.id === taskId) ?? null);
  if (!selectedWorkspace) {
    return (
      <GroupedSheet title="Edit Task">
        <OtherWorkspaceState />
      </GroupedSheet>
    );
  }
  if (!task) {
    return (
      <GroupedSheet title="Edit Task">
        {isLoadingTasks ? (
          <LoadingState label="Loading the task" />
        ) : (
          <EmptyState
            icon="search-x"
            title="Task Not Found"
            message={`${taskId} is no longer in this workspace. Close this sheet.`}
          />
        )}
      </GroupedSheet>
    );
  }
  return <TaskEditorSheet key={task.id} workspace={selectedWorkspace} task={task} />;
}
