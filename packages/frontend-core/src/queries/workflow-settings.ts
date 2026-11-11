import { latestWorkflowRevisions, type CompiledWorkflowCatalog } from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { workflowCatalogQueryOptions } from "./workflows";

/** The workflows and the roles of the catalog, for Settings. */
export const workflowSettingsData = (catalog: CompiledWorkflowCatalog) => {
  const workflows = [...catalog.workflows.values()];
  const roles = catalog.roles.map((definition) => ({
    role: definition.id,
    label: definition.label,
    definition,
  }));
  return { workflows, latestWorkflows: latestWorkflowRevisions(workflows), roles };
};
export type WorkflowSettingsData = ReturnType<typeof workflowSettingsData>;
export const useWorkflowSettings = () =>
  useQuery({ ...workflowCatalogQueryOptions(), select: workflowSettingsData });
