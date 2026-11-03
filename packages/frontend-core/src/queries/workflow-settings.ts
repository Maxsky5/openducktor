import type { WorkflowDescriptor } from "@openducktor/contracts";
import {
  latestWorkflowRevisions,
  workflowPromptTemplates,
  type CompiledWorkflowCatalog,
} from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { workflowCatalogQueryOptions } from "./workflows";

/**
 * Settings list each catalog role once, with its system prompt, and each workflow prompt template
 * once. The host rejects latest workflow revisions that give one template ID different content, so
 * the latest revision gives each settings entry.
 */
export const workflowSettingsData = (catalog: CompiledWorkflowCatalog) => {
  const workflows = [...catalog.workflows.values()];
  const roles = catalog.roles.map((definition) => ({
    role: definition.id,
    label: definition.label,
    definition,
  }));
  const byId = new Map<string, WorkflowDescriptor["templates"][number]>();
  const roleTemplates = catalog.roles.map(({ id, systemPrompt }) => ({
    ...systemPrompt,
    purpose: "system" as const,
    roleIds: [id],
  }));
  const latest = latestWorkflowRevisions(workflows).flatMap(workflowPromptTemplates);
  for (const template of [...roleTemplates, ...latest])
    if (!byId.has(template.id)) byId.set(template.id, template);
  const templates = [...byId.values()];
  const promptTabs = [
    {
      id: "shared",
      roleId: null,
      label: "Shared",
      templates: templates.filter(({ roleIds }) => !roleIds.length),
    },
    ...roles.map((role) => ({
      id: `role:${role.role}`,
      roleId: role.role,
      label: role.label,
      templates: templates.filter((template) => template.roleIds.includes(role.role)),
    })),
  ];
  return { workflows, roles, templates, promptTabs };
};
export type WorkflowSettingsData = ReturnType<typeof workflowSettingsData>;
export const useWorkflowSettings = () =>
  useQuery({ ...workflowCatalogQueryOptions(), select: workflowSettingsData });
