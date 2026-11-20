import {
  promptOverrideKey,
  ROLE_INSTRUCTIONS_PROMPT_ID,
  type PromptOwnerKind,
  type AgentPromptPlaceholder,
  type WorkflowDescriptor,
  type WorkflowIcon,
} from "@openducktor/contracts";
import {
  BASE_PROMPT_PLACEHOLDERS,
  NAMING_PROMPT_PLACEHOLDERS,
  NAMING_PROMPT_TEMPLATES,
  latestWorkflowRevisions,
  workflowPromptTemplates,
  type CompiledWorkflowCatalog,
} from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { workflowCatalogQueryOptions } from "./workflows";

/** When an agent of a workflow gets a workflow prompt. */
type WorkflowPromptPurpose = WorkflowDescriptor["templates"][number]["purpose"];

/** A prompt in Settings, with the override key of its owner. */
export type SettingsPromptTemplate = Omit<WorkflowDescriptor["templates"][number], "purpose"> & {
  key: string;
  /** The owner of the prompt, for example "Builder", "Spec, Plan, Build", or "Naming". */
  ownerTitle: string;
  /** When the agent gets the prompt, in plain words, for example "First message to the Builder". */
  usage: string;
  ownerKind: PromptOwnerKind;
  /** The placeholders that OpenDucktor supplies when it builds this prompt. */
  placeholders: readonly AgentPromptPlaceholder[];
};

/** The instructions of one agent role, which start each session of the role in every workflow. */
export type SettingsRolePrompt = SettingsPromptTemplate & { roleIcon: WorkflowIcon | undefined };

/** Prompts that the agent gets at the same moment, such as the rules of every session. */
export type SettingsPromptGroup = {
  id: string;
  title: string;
  description: string;
  templates: SettingsPromptTemplate[];
};

/** The prompts of one workflow, by when the agent gets them. */
export type SettingsWorkflowPrompts = {
  id: string;
  title: string;
  groups: SettingsPromptGroup[];
};

/** A role of the catalog, for the role chips of workflow prompts. */
export type SettingsPromptRole = { id: string; label: string; icon: WorkflowIcon | undefined };

/** Role labels in a sentence, such as "the Builder agent" or "the Spec or Planner agent". */
const roleNames = (labels: readonly string[]): string => `the ${labels.join(" or ")} agent`;

/** When the agent gets a workflow prompt, from its purpose and its roles. */
const workflowPromptUsage = (purpose: WorkflowPromptPurpose, roles: readonly string[]): string => {
  switch (purpose) {
    case "system":
      return "Part of every session in this workflow";
    case "kickoff":
      return roles.length ? `First message to ${roleNames(roles)}` : "First message of a step";
    case "message":
      return roles.length
        ? `Sent to ${roleNames(roles)} during a session`
        : "Sent during a session";
    case "permission":
      return "Reply when a read-only agent tries to change files";
    case "goal":
      return "Instructions to write the goal of a step in Goal mode";
  }
};

/** The naming prompts, which OpenDucktor owns. The naming model of a workspace gets them. */
const namingPromptTemplates = (): SettingsPromptTemplate[] =>
  NAMING_PROMPT_TEMPLATES.map(({ output: _output, requiredPlaceholders, ...template }) => ({
    ...template,
    requiredPlaceholders: [...requiredPlaceholders],
    roleIds: [],
    ownerTitle: "Naming",
    ownerKind: "naming",
    usage: "Instructions to the naming model of the workspace",
    placeholders: NAMING_PROMPT_PLACEHOLDERS,
  }));

/** The groups of a workflow section, in the order of a session. */
const WORKFLOW_GROUPS: readonly {
  id: string;
  title: string;
  description: string;
  purposes: readonly WorkflowPromptPurpose[];
}[] = [
  {
    id: "rules",
    title: "Rules for every session",
    description: "Added to the system prompt of each session, after the role instructions.",
    purposes: ["system"],
  },
  {
    id: "messages",
    title: "Messages to agents",
    description: "Sent to an agent to start a step or to continue its work.",
    purposes: ["kickoff", "message"],
  },
  {
    id: "goals",
    title: "Goal mode",
    description: "Tells a model how to write the goal when you start a step in Goal mode.",
    purposes: ["goal"],
  },
  {
    id: "replies",
    title: "Replies to agents",
    description: "Sent back to an agent when OpenDucktor refuses one of its actions.",
    purposes: ["permission"],
  },
];

/**
 * The prompts of Settings: the instructions of each catalog role, the prompts of the latest
 * revision of each workflow, and the naming prompts. An override applies to its owner role or
 * workflow in every revision.
 */
export const workflowPromptSettings = (catalog: CompiledWorkflowCatalog) => {
  const roles = catalog.roles.map(({ id, label, icon }): SettingsPromptRole => ({
    id,
    label,
    icon,
  }));
  const roleLabels = new Map(roles.map(({ id, label }) => [id, label]));
  const roleTemplates = catalog.roles.map(
    ({ id, label, icon, systemPrompt }): SettingsRolePrompt => ({
      ...systemPrompt,
      ownerTitle: label,
      ownerKind: "role",
      usage: `Start of every ${label} session, in every workflow`,
      roleIcon: icon,
      id: ROLE_INSTRUCTIONS_PROMPT_ID,
      key: promptOverrideKey({
        ownerKind: "role",
        ownerId: id,
        promptId: ROLE_INSTRUCTIONS_PROMPT_ID,
      }),
      roleIds: [id],
      placeholders: BASE_PROMPT_PLACEHOLDERS,
    }),
  );
  const workflowSections = latestWorkflowRevisions([...catalog.workflows.values()]).map(
    (workflow): SettingsWorkflowPrompts => {
      const templates = workflowPromptTemplates(workflow).map(({ purpose, ...template }) => {
        const key = promptOverrideKey({
          ownerKind: "workflow",
          ownerId: workflow.reference.id,
          promptId: template.id,
        });
        const setting: SettingsPromptTemplate = {
          ...template,
          ownerTitle: workflow.definition.label,
          ownerKind: "workflow",
          usage: workflowPromptUsage(
            purpose,
            template.roleIds.map((role) => roleLabels.get(role) ?? role),
          ),
          key,
          placeholders: workflow.prompts.placeholdersOf(key),
        };
        return { purpose, setting };
      });
      return {
        id: workflow.reference.id,
        title: workflow.definition.label,
        groups: WORKFLOW_GROUPS.map(({ purposes, ...group }) => ({
          ...group,
          templates: templates
            .filter(({ purpose }) => purposes.includes(purpose))
            .map(({ setting }) => setting),
        })).filter(({ templates: groupTemplates }) => groupTemplates.length > 0),
      };
    },
  );
  const namingTemplates = namingPromptTemplates();
  const templates: SettingsPromptTemplate[] = [
    ...roleTemplates,
    ...workflowSections.flatMap(({ groups }) => groups.flatMap((group) => group.templates)),
    ...namingTemplates,
  ];
  return { roles, roleTemplates, workflows: workflowSections, namingTemplates, templates };
};
export type WorkflowPromptSettings = ReturnType<typeof workflowPromptSettings>;
export const useWorkflowPromptSettings = () =>
  useQuery({ ...workflowCatalogQueryOptions(), select: workflowPromptSettings });
