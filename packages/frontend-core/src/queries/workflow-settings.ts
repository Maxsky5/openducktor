import { latestWorkflowRevisions, type CompiledWorkflowCatalog } from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { workflowCatalogQueryOptions } from "./workflows";

/**
 * The state notifications of the latest workflow versions, once per kind. Workflows that share a
 * state share its notification kind and its setting.
 */
const workflowNotificationsOf = (latestWorkflows: ReturnType<typeof latestWorkflowRevisions>) => {
  const notifications = new Map<
    string,
    NonNullable<(typeof latestWorkflows)[number]["definition"]["states"][number]["notification"]>
  >();
  for (const workflow of latestWorkflows)
    for (const { notification } of workflow.definition.states)
      if (notification && !notifications.has(notification.kind))
        notifications.set(notification.kind, notification);
  return [...notifications.values()];
};

/** The latest version of each workflow and every role of the catalog, for Settings. */
export const workflowSettingsData = (catalog: CompiledWorkflowCatalog) => {
  const latestWorkflows = latestWorkflowRevisions([...catalog.workflows.values()]);
  const roles = catalog.roles.map((definition) => ({
    role: definition.id,
    label: definition.label,
    definition,
  }));
  return {
    latestWorkflows,
    workflowNotifications: workflowNotificationsOf(latestWorkflows),
    roles,
  };
};
export type WorkflowSettingsData = ReturnType<typeof workflowSettingsData>;
export const useWorkflowSettings = () =>
  useQuery({ ...workflowCatalogQueryOptions(), select: workflowSettingsData });
