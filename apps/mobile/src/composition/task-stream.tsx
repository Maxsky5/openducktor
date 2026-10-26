import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  useHostTaskStream,
  useHostTaskStreamControllerFactory,
} from "@openducktor/frontend-core/tasks/use-host-task-stream";
import { useMobileWorkspaces } from "./workspace-selection";

/** Runs the task stream of the host connection for the open workspaces, as desktop does. */
export function TaskStreamOwner(): null {
  const { feedback } = useClientConnection();
  const { workspaces, selectedWorkspace } = useMobileWorkspaces();
  const createController = useHostTaskStreamControllerFactory();
  useHostTaskStream({
    openWorkspaces: workspaces,
    activeRepoPath: selectedWorkspace?.repoPath ?? null,
    createController,
    events: {
      onDegraded: (description) =>
        feedback.show("error", "Task updates are delayed", { description }),
      onWorkspaceFailures: (description) =>
        feedback.show("error", "Workspaces did not refresh", { description }),
      onUnavailable: (cause) =>
        feedback.show("error", "Task updates are unavailable", {
          description: `${errorMessage(cause)} Pull to refresh to see the latest tasks.`,
        }),
    },
  });
  return null;
}
