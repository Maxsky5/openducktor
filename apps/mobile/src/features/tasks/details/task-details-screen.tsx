import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { Screen } from "@/ui/screen";
import { EmptyState } from "@/ui/states";
import { TaskDetailsView } from "./task-details-view";
import { routeParam } from "@/navigation/route-params";

/** The task details route. It opens in the app stack above the tabs. */
export function TaskDetailsScreen(): ReactElement {
  const params = useLocalSearchParams<{ workspaceId: string; taskId: string }>();
  const workspaceId = routeParam(params.workspaceId);
  const taskId = routeParam(params.taskId);
  return (
    <Screen background="grouped">
      {workspaceId && taskId ? (
        <TaskDetailsView
          key={`${workspaceId}:${taskId}`}
          workspaceId={workspaceId}
          taskId={taskId}
        />
      ) : (
        <EmptyState
          icon="link-off"
          title="Incomplete Link"
          message="It does not name a task. Open the task again from the board."
        />
      )}
    </Screen>
  );
}
