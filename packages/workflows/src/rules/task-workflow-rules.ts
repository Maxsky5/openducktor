import {
  ISSUE_TYPE_VALUES,
  WORKFLOW_MESSAGE_PROMPT_PREFIX,
  WORKFLOW_PROMPT_IDS,
  type AgentPromptPlaceholder,
  type CompiledAgentRoleDefinition,
  type CompiledWorkflowDefinition,
} from "@openducktor/contracts";
import { unsupportedGoalObjectivePlaceholder } from "../task-workflow/launch-goal";
import { fillablePlaceholdersHint, placeholderProblem } from "../task-workflow/prompt-layers";
import { isPullRequestLaunch, PULL_REQUEST_LAUNCH } from "../task-workflow/pull-request-launch";
import {
  BASE_PROMPT_IDS,
  BASE_PROMPT_PLACEHOLDERS,
  REQUIRED_BASE_PROMPTS,
  workflowLaunchActions,
  workflowPromptPlaceholders,
  type PromptPurpose,
} from "../task-workflow/task-prompts";
import type { ProblemSink } from "./problems";

/** A workflow prompt as the rules read it. */
export type RulePrompt = {
  readonly id: string;
  /** The name of the prompt in the editor. Without it, messages name the prompt by its ID. */
  readonly label?: string | undefined;
  readonly purpose: PromptPurpose;
  readonly template: string;
  readonly requiredPlaceholders?: readonly AgentPromptPlaceholder[] | undefined;
};

/** A catalog role as the rules read it. */
export type RuleRole = Pick<CompiledAgentRoleDefinition, "id" | "tools" | "systemPrompt">;

type Definition = Pick<
  CompiledWorkflowDefinition,
  "id" | "facts" | "issueTypes" | "roles" | "steps" | "events"
>;

const definitionPath = (...path: (string | number)[]) => ["definition", ...path];

/** A placeholder problem of a text, with the placeholders that the text can fill. */
export const textPlaceholderProblem = (
  text: string,
  requiredPlaceholders: readonly string[],
  fillablePlaceholders: readonly AgentPromptPlaceholder[],
): string | undefined => {
  const problem = placeholderProblem(text, requiredPlaceholders, fillablePlaceholders);
  return problem === undefined
    ? undefined
    : `${problem} ${fillablePlaceholdersHint(fillablePlaceholders)}`;
};

/**
 * Collects the problems that make a definition unusable as a task workflow: issue types, role
 * bindings against the role catalog, agent steps, goal texts, and prompts. Paths start at the
 * document: `definition` or `prompts`.
 */
export const collectTaskWorkflowProblems = (
  definition: Definition,
  prompts: readonly RulePrompt[],
  roleCatalog: readonly RuleRole[],
  sink: ProblemSink,
): void => {
  const { error } = sink;
  if (definition.issueTypes.length === 0)
    error(
      definition.facts.length > 0 ? definitionPath("facts") : definitionPath("issueTypes"),
      `The workflow has no issue types. Add at least one of: ${ISSUE_TYPE_VALUES.join(", ")}.`,
    );
  if (definition.facts.length > 0)
    error(
      definitionPath("facts"),
      "A task workflow cannot have facts. Check the issue type in conditions instead.",
    );

  const catalog = new Map(roleCatalog.map((role) => [role.id, role]));
  definition.roles.forEach((binding, index) => {
    const role = catalog.get(binding.id);
    if (!role) {
      error(
        definitionPath("roles", index, "id"),
        `Role "${binding.id}" does not exist. Create it, or swap it for another role.`,
      );
      return;
    }
    const events = definition.events.filter(({ agent }) => agent?.roles.includes(binding.id));
    if (events.length > 0 && !role.tools.includes("odt_apply_workflow_event"))
      error(
        definitionPath("roles", index, "id"),
        `Role "${binding.id}" can trigger ${events.map((event) => `"${event.label || event.id}"`).join(", ")}, but it lacks the "Move the task" tool. Give it that tool, or remove the role from the agents of these transitions.`,
      );
    const instructions = role.systemPrompt;
    const problem = textPlaceholderProblem(
      instructions.template,
      instructions.requiredPlaceholders ?? [],
      BASE_PROMPT_PLACEHOLDERS,
    );
    if (problem !== undefined)
      error(
        definitionPath("roles", index, "id"),
        `The instructions of role "${binding.id}" have a placeholder problem. ${problem}`,
      );
  });

  // The name of the first agent step of each role.
  const stepRoles = new Map<string, string>();
  definition.steps.forEach((step, index) => {
    if (step.kind !== "agent") return;
    const firstStep = stepRoles.get(step.roleId);
    if (firstStep !== undefined)
      error(
        definitionPath("steps", index, "roleId"),
        `Role "${step.roleId}" already does step "${firstStep}". Give step "${step.label || step.id}" another role.`,
      );
    else stepRoles.set(step.roleId, step.label || step.id);
    step.launchActions.forEach((launch, launchIndex) => {
      const placeholder =
        launch.goal &&
        unsupportedGoalObjectivePlaceholder(launch.goal.defaultObjective, launch.context);
      if (placeholder)
        error(
          definitionPath("steps", index, "launchActions", launchIndex, "goal", "defaultObjective"),
          `The default goal of way to start "${launch.label || launch.id}" cannot use the placeholder "${placeholder}". Use {{task.id}} and {{task.title}}, and {{humanFeedback}} when it asks the user for feedback.`,
        );
    });
  });

  collectPromptProblems(definition, prompts, sink);
};

const collectPromptProblems = (
  definition: Definition,
  prompts: readonly RulePrompt[],
  { error }: ProblemSink,
): void => {
  const indexes = new Map<string, number>();
  prompts.forEach((prompt, index) => {
    if (indexes.has(prompt.id)) {
      error(["prompts", index, "id"], `Two prompts have the ID "${prompt.id}". Keep one of them.`);
      return;
    }
    indexes.set(prompt.id, index);
    if (!BASE_PROMPT_IDS.has(prompt.id) && !prompt.id.startsWith(WORKFLOW_MESSAGE_PROMPT_PREFIX))
      error(
        ["prompts", index, "id"],
        `Prompt "${prompt.label || prompt.id}" is not a built-in prompt, so its ID must start with "${WORKFLOW_MESSAGE_PROMPT_PREFIX}". Change its ID.`,
      );
    const problem = textPlaceholderProblem(
      prompt.template,
      prompt.requiredPlaceholders ?? [],
      workflowPromptPlaceholders(definition, prompt.id),
    );
    if (problem !== undefined)
      error(
        ["prompts", index, "template"],
        `Prompt "${prompt.label || prompt.id}" has a placeholder problem. ${problem}`,
      );
  });
  const requirePrompt = (
    id: string,
    purpose: PromptPurpose,
    user: string,
    missingPath: (string | number)[],
  ) => {
    const index = indexes.get(id);
    if (index === undefined) {
      error(missingPath, `${user} needs the ${purpose} prompt "${id}". Add it.`);
      return;
    }
    const prompt = prompts[index]!;
    if (prompt.purpose !== purpose)
      error(
        ["prompts", index, "purpose"],
        `${user} needs prompt "${prompt.label || id}" to be a ${purpose} prompt, but it is a ${prompt.purpose} prompt. Change its purpose to ${purpose}.`,
      );
  };
  for (const [id, purpose] of REQUIRED_BASE_PROMPTS)
    requirePrompt(id, purpose, "Every workflow", ["prompts"]);
  definition.steps.forEach((step, index) => {
    if (step.kind !== "agent") return;
    step.launchActions.forEach((launch, launchIndex) =>
      requirePrompt(
        launch.template.id,
        launch.template.kind,
        `Way to start "${launch.label || launch.id}"`,
        ["definition", "steps", index, "launchActions", launchIndex, "template", "id"],
      ),
    );
  });
  for (const launch of workflowLaunchActions(definition))
    if (isPullRequestLaunch(launch.id))
      requirePrompt(
        launch.template.id,
        launch.template.kind,
        `Way to start "${PULL_REQUEST_LAUNCH.label}"`,
        ["prompts"],
      );
  if (indexes.has(WORKFLOW_PROMPT_IDS.goal))
    requirePrompt(WORKFLOW_PROMPT_IDS.goal, "goal", "Goal mode", ["prompts"]);
};
