import {
  roleSettingsLabel,
  workflowPromptTemplates,
  workflowReferenceKey,
  type CompiledWorkflowCatalog,
} from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { workflowCatalogQueryOptions } from "./workflows";

/** Entries retain workflow context while editing the existing shared override keys. */
export const workflowSettingsData = (catalog: CompiledWorkflowCatalog) => {
  const workflows = [...catalog.workflows.values()];
  const roles = workflows.flatMap((workflow) =>
    workflow.definition.roles.map((definition) => ({
      key: `${workflowReferenceKey(workflow.reference)}:${definition.id}`,
      role: definition.id,
      label: definition.label,
      settingsLabel: roleSettingsLabel(definition.id, workflow),
      definition,
      workflow,
    })),
  );
  const templates = workflows.flatMap((workflow) =>
    workflowPromptTemplates(workflow).map((template) => ({
      ...template,
      workflow,
      key: `${workflowReferenceKey(workflow.reference)}:${template.id}`,
    })),
  );
  const promptTabs = [
    {
      id: "shared",
      roleId: null,
      label: "Shared",
      templates: templates.filter(({ roleIds }) => !roleIds.length),
    },
    ...roles.map((role) => ({
      id: `role:${role.key}`,
      roleId: role.role,
      label: role.label,
      templates: templates.filter(
        (template) => template.workflow === role.workflow && template.roleIds.includes(role.role),
      ),
    })),
  ];
  return { workflows, roles, templates, promptTabs };
};
export type WorkflowSettingsData = ReturnType<typeof workflowSettingsData>;
export const useWorkflowSettings = () =>
  useQuery({ ...workflowCatalogQueryOptions(), select: workflowSettingsData });
