import type { QueryClient } from "@tanstack/react-query";
import { connectionOf } from "../connection/client-connection";
import { errorMessage } from "../lib/errors";
import { CONNECTION_RECONNECTED_EVENT_KIND } from "../recovery/connection-control-events";
import { autopilotQueryKeys } from "./autopilot";
import { workflowLibraryQueryKeys } from "./workflow-library";
import { taskQueryKeys } from "./tasks";
import { workflowQueryKeys } from "./workflows";
import { workspaceQueryKeys } from "./workspace";

/**
 * The reads that a library commit can change, apart from the workflow catalog and the workspace
 * reads: the library reads and the settings that are keyed by a workflow or a role.
 */
const refreshLibraryAndSettingsReads = async (queryClient: QueryClient): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: workflowLibraryQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.settingsSnapshot(), exact: true }),
    queryClient.invalidateQueries({ queryKey: [...workspaceQueryKeys.all, "repo-config"] }),
    queryClient.invalidateQueries({ queryKey: autopilotQueryKeys.settings(), exact: true }),
  ]);
};

/**
 * Applies a library commit: a publication, a task move, an availability, or a role change. It marks
 * the catalog, every workspace read, the task lists, the library reads, and the settings reads
 * stale. Task cards hold their compiled workflow, so a role change reaches them only when the
 * lists resolve again against the new catalog. Only the reads that a view observes read again.
 */
export const applyWorkflowLibraryChange = async (queryClient: QueryClient): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
    refreshLibraryAndSettingsReads(queryClient),
  ]);
};

/**
 * Keeps the workflow reads of a query client current from the host event stream. After a
 * reconnect with missed events, the task recovery reloads the catalog and the boards, and this
 * observer reads the library and settings again. Returns the unsubscribe.
 */
export const observeWorkflowLibraryChanges = (queryClient: QueryClient): (() => void) => {
  const connection = connectionOf(queryClient);
  let closed = false;
  let stop: (() => void) | null = null;
  void connection.host
    .subscribeWorkflowLibraryChanges(async (event) => {
      if (closed) return;
      if ("__openducktorConnectionControl" in event) {
        if (event.kind === CONNECTION_RECONNECTED_EVENT_KIND && event.missedEvents)
          await refreshLibraryAndSettingsReads(queryClient);
        return;
      }
      await applyWorkflowLibraryChange(queryClient);
    })
    .then((unsubscribe) => {
      if (closed) unsubscribe();
      else stop = unsubscribe;
    })
    .catch((cause: unknown) => {
      if (closed) return;
      connection.feedback.show("warning", "Workflow changes do not update live", {
        id: WORKFLOW_LIBRARY_FEEDBACK_ID,
        description: `${errorMessage(cause)} Reload OpenDucktor to try again.`,
        duration: Number.POSITIVE_INFINITY,
      });
    });
  return () => {
    closed = true;
    stop?.();
  };
};

const WORKFLOW_LIBRARY_FEEDBACK_ID = "workflow-library-changes";
