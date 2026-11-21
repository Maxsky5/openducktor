import {
  TASK_CLOSED_STATE,
  TASK_OPEN_STATE,
  WORKFLOW_PROMPT_IDS,
  workflowDocumentSchema,
  type CompiledWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowDocument,
  type WorkflowPrompt,
  type WorkflowStateDefinition,
  type WorkflowVersionDocument,
  type WorkflowVersionPrompt,
} from "@openducktor/contracts";
import { SPEC_PLAN_BUILD_DEFINITION } from "../builtin/spec-plan-build/definition";
import { specPlanBuildWorkflow } from "../builtin/spec-plan-build/workflow";
import type { PromptTemplate } from "../task-workflow/task-prompts";
import { builtinSharedState } from "./builtin-shared-fields";

/** The built-in workflow ID. Tasks without a stored version follow the built-in workflow. */
export const BUILTIN_WORKFLOW_ID = SPEC_PLAN_BUILD_DEFINITION.id;

/** The base prompts of a new workflow, with the built-in text. */
const NEW_WORKFLOW_PROMPT_IDS: readonly string[] = [
  WORKFLOW_PROMPT_IDS.rules,
  WORKFLOW_PROMPT_IDS.toolRules,
  WORKFLOW_PROMPT_IDS.taskContext,
  WORKFLOW_PROMPT_IDS.readOnlyRejection,
  WORKFLOW_PROMPT_IDS.pullRequest,
];

/** A document prompt from a prompt template: its settings label and description are required. */
export const documentPrompt = (template: PromptTemplate): WorkflowPrompt => {
  const prompt: WorkflowPrompt = {
    id: template.id,
    purpose: template.purpose,
    label: template.label ?? template.id,
    description: template.description ?? "",
    template: template.template,
  };
  if (template.requiredPlaceholders)
    prompt.requiredPlaceholders = [...template.requiredPlaceholders];
  return prompt;
};

/**
 * Makes an element ID from a label: lowercase words joined by the separator. The ID stays out of
 * `taken`. A label without letters or digits gives `fallback`.
 */
export const idFromLabel = (
  label: string,
  taken: ReadonlySet<string> = new Set(),
  { separator = "_", fallback = "item" }: { separator?: string; fallback?: string } = {},
): string => {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, separator)
      .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "") || fallback;
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}${separator}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/** A workflow ID from a workflow name. */
export const workflowIdFromName = (name: string, taken: ReadonlySet<string>): string =>
  idFromLabel(name, taken, { separator: "-", fallback: "workflow" });

const coreState = (id: string): WorkflowStateDefinition => {
  const shared = builtinSharedState(id);
  if (!shared) throw new Error(`The built-in workflow has no core state "${id}".`);
  const state: WorkflowStateDefinition = { id, label: shared.label };
  if (shared.title !== undefined) state.title = shared.title;
  if (shared.tone !== undefined) state.tone = shared.tone;
  return state;
};

/**
 * A new draft: the core states, the three issue types with their built-in labels, and the base
 * prompts with the built-in text.
 */
export const newWorkflowDocument = (id: string, name: string): WorkflowDocument => {
  const builtinPrompts = new Map(
    specPlanBuildWorkflow.workflowTemplates.map((template) => [template.id, template]),
  );
  return workflowDocumentSchema.parse({
    definition: {
      id,
      label: name,
      // The built-in guidance names built-in roles, so a new workflow keeps only the display.
      issueTypes: SPEC_PLAN_BUILD_DEFINITION.issueTypes.map(
        ({ id: issueType, label, description, icon }) => ({
          id: issueType,
          label,
          description,
          icon,
        }),
      ),
      roles: [],
      pullRequestRoles: [],
      artifacts: [],
      states: [coreState(TASK_OPEN_STATE), coreState(TASK_CLOSED_STATE)],
      steps: [],
      actions: [],
      events: [],
      signals: [],
      automations: [],
      actionOrder: [],
      actionPriority: [],
      launchOrder: [],
    },
    prompts: NEW_WORKFLOW_PROMPT_IDS.map((promptId) => {
      const template = builtinPrompts.get(promptId);
      if (!template) throw new Error(`The built-in workflow has no prompt "${promptId}".`);
      return documentPrompt(template);
    }),
    layout: { states: {} },
  });
};

/** The document fields of a definition: without format, revision, and facts. */
const documentDefinition = ({
  schemaVersion: _schemaVersion,
  revision: _revision,
  facts: _facts,
  ...definition
}: WorkflowDefinition | CompiledWorkflowDefinition) => definition;

/** The built-in workflow as a document, for its read-only view and Duplicate. */
export const builtinWorkflowDocument = (): WorkflowDocument =>
  workflowDocumentSchema.parse({
    definition: documentDefinition(structuredClone(specPlanBuildWorkflow.definition)),
    prompts: specPlanBuildWorkflow.workflowTemplates.map(documentPrompt),
    layout: { states: {} },
  });

/** The editable document of a published version. */
export const versionToDocument = (version: WorkflowVersionDocument): WorkflowDocument =>
  workflowDocumentSchema.parse({
    definition: documentDefinition(structuredClone(version.definition)),
    prompts: version.prompts.map(({ builtinVersion: _builtinVersion, ...prompt }) => prompt),
    layout: structuredClone(version.layout),
  });

/** The definition of a document at a revision. */
export const definitionOfDocument = (
  document: WorkflowDocument,
  revision: number,
): WorkflowDefinition => ({
  schemaVersion: 1,
  revision,
  facts: [],
  ...structuredClone(document.definition),
});

/**
 * The prompt templates of a document. A version gives each prompt its built-in version; a draft
 * uses version 1.
 */
export const promptTemplatesOfDocument = (
  prompts: readonly (WorkflowPrompt | WorkflowVersionPrompt)[],
): PromptTemplate[] =>
  prompts.map((prompt) => ({
    ...structuredClone(prompt),
    builtinVersion: "builtinVersion" in prompt ? prompt.builtinVersion : 1,
  }));

/**
 * The prompts of the next version. A new prompt gets version 1, a changed text the previous
 * version plus 1, and an unchanged text keeps its version.
 */
export const nextVersionPrompts = (
  prompts: readonly WorkflowPrompt[],
  previous: readonly WorkflowVersionPrompt[],
): WorkflowVersionPrompt[] => {
  const previousById = new Map(previous.map((prompt) => [prompt.id, prompt]));
  return prompts.map((prompt) => {
    const before = previousById.get(prompt.id);
    const builtinVersion =
      before === undefined
        ? 1
        : before.template === prompt.template
          ? before.builtinVersion
          : before.builtinVersion + 1;
    return { ...structuredClone(prompt), builtinVersion };
  });
};
