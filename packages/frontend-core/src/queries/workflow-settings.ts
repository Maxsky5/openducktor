import {
  promptOverrideKey,
  ROLE_INSTRUCTIONS_PROMPT_ID,
  type WorkflowDescriptor,
} from "@openducktor/contracts";
import {
  latestWorkflowRevisions,
  workflowPromptTemplates,
  type CompiledWorkflowCatalog,
} from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { workflowCatalogQueryOptions } from "./workflows";

/** A prompt in Settings, with the override key of its owner. */
export type SettingsPromptTemplate = WorkflowDescriptor["templates"][number] & {
  key: string;
  /** The role or workflow that owns the prompt, for example "Workflow: Spec, Plan, Build". */
  owner: string;
};

/**
 * Settings list each catalog role once, with its system prompt, and the prompts of the latest
 * revision of each workflow. An override applies to its owner role or workflow in every revision.
 */
export const workflowSettingsData = (catalog: CompiledWorkflowCatalog) => {
  const workflows = [...catalog.workflows.values()];
  const roles = catalog.roles.map((definition) => ({
    role: definition.id,
    label: definition.label,
    definition,
  }));
  const roleTemplates = catalog.roles.map(
    ({ id, label, systemPrompt }): SettingsPromptTemplate => ({
      ...systemPrompt,
      owner: `Role: ${label}`,
      id: ROLE_INSTRUCTIONS_PROMPT_ID,
      key: promptOverrideKey({
        ownerKind: "role",
        ownerId: id,
        promptId: ROLE_INSTRUCTIONS_PROMPT_ID,
      }),
      purpose: "system",
      roleIds: [id],
    }),
  );
  const latestWorkflows = latestWorkflowRevisions(workflows);
  const workflowTemplates = latestWorkflows.flatMap((workflow) =>
    workflowPromptTemplates(workflow).map((template): SettingsPromptTemplate => ({
      ...template,
      owner: `Workflow: ${workflow.definition.label}`,
      key: promptOverrideKey({
        ownerKind: "workflow",
        ownerId: workflow.reference.id,
        promptId: template.id,
      }),
    })),
  );
  const templates = [...roleTemplates, ...workflowTemplates];
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
  return { workflows, latestWorkflows, roles, templates, promptTabs };
};
export type WorkflowSettingsData = ReturnType<typeof workflowSettingsData>;
export const useWorkflowSettings = () =>
  useQuery({ ...workflowCatalogQueryOptions(), select: workflowSettingsData });
