import {
  isOdtBrowserToolName,
  promptOverrideKey,
  ROLE_INSTRUCTIONS_PROMPT_ID,
  WORKFLOW_MESSAGE_PROMPT_PREFIX,
  WORKFLOW_PROMPT_IDS,
  type AgentPromptPlaceholder,
  type AgentToolName,
  type CompiledAgentRoleDefinition,
  type CompiledWorkflowDefinition,
  extractPromptTemplatePlaceholders,
  type WorkflowLaunchActionDefinition,
  type GitTargetBranch,
} from "@openducktor/contracts";
import {
  composePromptLayers,
  fillablePlaceholdersHint,
  isPromptOverrideOutdated,
  joinPromptLayers,
  placeholderProblem,
  promptBase,
  promptScopeLayerProblems,
  type PromptPlaceholderRules,
  type PromptSettings,
  type PromptSettingsLayers,
} from "./prompt-layers";
import { formatOdtToolArgs } from "./prompt-tool-args";
import { isPullRequestLaunch, PULL_REQUEST_LAUNCH } from "./pull-request-launch";

export type PromptPurpose = "system" | "kickoff" | "message" | "permission" | "goal";

/** A prompt that a workflow declares. Its ID is unique within the workflow. */
export type PromptTemplate = {
  id: string;
  label?: string;
  description?: string;
  roleIds?: string[];
  purpose: PromptPurpose;
  builtinVersion: number;
  template: string;
  /** An override must keep each of these placeholders. */
  requiredPlaceholders?: AgentPromptPlaceholder[] | undefined;
};

/** A prompt with the settings key of its owner: a role or the workflow. */
export type OwnedPromptTemplate = PromptTemplate & {
  readonly key: string;
  readonly ownerKind: "role" | "workflow";
};

/** An event that agents of a role may send with `odt_apply_workflow_event`. */
export type TaskWorkflowAgentEvent = {
  readonly id: string;
  readonly description: string;
  readonly note: "required" | "optional";
};

/** The role facts that prompts read. The system template comes from the role catalog. */
type PromptRole = {
  readonly id: string;
  readonly tools: readonly AgentToolName[];
  readonly writes: readonly string[];
  readonly systemPrompt: CompiledAgentRoleDefinition["systemPrompt"];
  readonly agentEvents: readonly TaskWorkflowAgentEvent[];
};

export type PromptTaskContext = {
  taskId: string;
  title?: string;
  issueType?: string;
  status?: string;
  description?: string;
};

export type AgentPromptGitContext = {
  operationLabel?: string;
  currentBranch?: string;
  targetBranch?: string;
  conflictedFiles?: string[];
  conflictOutput?: string;
};

export type ResolvedAgentPromptTemplate = {
  key: string;
  purpose: PromptPurpose;
  source: "builtin" | "override";
  builtinVersion: number;
  overrideBaseVersion?: number;
  hasStaleOverride: boolean;
  content: string;
};

export type AgentPromptWarning = {
  type: "override_base_version_mismatch";
  key: string;
  builtinVersion: number;
  overrideBaseVersion: number;
};

export type BuiltAgentPrompt = {
  prompt: string;
  templates: ResolvedAgentPromptTemplate[];
  warnings: AgentPromptWarning[];
};

export type SystemPromptInput = {
  role: string;
  task: PromptTaskContext;
  settings: PromptSettings;
};

export type KickoffPromptInput = {
  launchActionId: string;
  /** The role of the session. The core pull request launch needs it. */
  role?: string | undefined;
  task: PromptTaskContext;
  humanFeedback?: string | undefined;
  targetBranch?: GitTargetBranch | undefined;
  settings: PromptSettings;
};

/** The instructions that tell a model how to write the goal of a Goal mode launch. */
export type GoalPromptInput = {
  launchActionId: string;
  task: PromptTaskContext;
  humanFeedback?: string | undefined;
  settings: PromptSettings;
};

export type MessagePromptInput = {
  launchActionId: string;
  /** The role of the session. The core pull request launch needs it. */
  role?: string | undefined;
  task: PromptTaskContext;
  git?: AgentPromptGitContext | undefined;
  humanFeedback?: string | undefined;
  targetBranch?: GitTargetBranch | undefined;
  settings: PromptSettings;
};

/** The prompts of a task workflow and of its roles, and the prompts that they build. */
export type TaskPrompts = {
  readonly templates: readonly OwnedPromptTemplate[];
  /** The roles that use a workflow prompt. No role marks shared prompt information. */
  templateRoles(id: string): readonly string[];
  systemPrompt(input: SystemPromptInput): BuiltAgentPrompt;
  kickoffPrompt(input: KickoffPromptInput): BuiltAgentPrompt;
  messagePrompt(input: MessagePromptInput): BuiltAgentPrompt;
  /** The workflow provides the goal prompt, so a launch action that declares `goal` offers Goal mode. */
  readonly hasGoalPrompt: boolean;
  /** The goal prompt of the workflow, which tells a model how to write the goal of a launch. */
  goalPrompt(input: GoalPromptInput): BuiltAgentPrompt;
  readOnlyRejection(input: { role: string; settings: PromptSettings }): string;
  /** The placeholders that OpenDucktor supplies when it builds the prompt of this settings key. */
  placeholdersOf(key: string): readonly AgentPromptPlaceholder[];
  /**
   * The first placeholder problem of the saved layers of the prompts that a session of the role
   * builds: its system prompt and, for a launch, the prompt of the launch action. A problem in
   * another prompt blocks only the action that builds it. Settings reject new invalid layers, so a
   * problem comes from a layer that an earlier version saved.
   */
  findLayerProblem(
    settings: PromptSettings,
    session: { role: string; launchActionId?: string | undefined },
  ): string | undefined;
};

type LaunchTemplate = { templateId: string; kind: "kickoff" | "message" };

/** How an error message names a prompt. */
const promptName = (template: OwnedPromptTemplate, roleIds: readonly string[]): string =>
  template.ownerKind === "role"
    ? `prompt "${roleIds[0]}.${template.id}"`
    : `prompt "${template.id}"`;

/** The workflow prompts of the system prompt, after the role instructions. */
const SYSTEM_PROMPT_IDS = [
  WORKFLOW_PROMPT_IDS.rules,
  WORKFLOW_PROMPT_IDS.toolRules,
  WORKFLOW_PROMPT_IDS.taskContext,
];
const BASE_PROMPT_IDS = new Set<string>(Object.values(WORKFLOW_PROMPT_IDS));

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

/** Fills each `{{placeholder}}` of a template. A placeholder without a value becomes empty. */
export const fillPromptPlaceholders = (
  template: string,
  values: ReadonlyMap<string, string>,
): string =>
  template.replace(PLACEHOLDER_PATTERN, (_match, token: string) => values.get(token) ?? "");
/**
 * The placeholders that every prompt can fill. Role instructions and the base workflow prompts
 * fill exactly these.
 */
export const BASE_PROMPT_PLACEHOLDERS: readonly AgentPromptPlaceholder[] = [
  "role",
  "role.allowedTools",
  "task.id",
  "task.title",
  "task.issueType",
  "task.status",
  "task.description",
];
/** The placeholders of a launch that collects human feedback. */
export const HUMAN_FEEDBACK_PLACEHOLDERS: readonly AgentPromptPlaceholder[] = ["humanFeedback"];
/** The placeholders of the pull request launch and of Git conflict launches. */
export const GIT_PLACEHOLDERS: readonly AgentPromptPlaceholder[] = [
  "git.operationLabel",
  "git.currentBranch",
  "git.targetBranch",
  "git.conflictedFiles",
  "git.conflictOutput",
];

const compact = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "(none)";
};

const compactList = (values: string[] | undefined): string => {
  const normalized = (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return normalized.length === 0 ? "(none)" : normalized.map((value) => `- ${value}`).join("\n");
};

/** The base branch of a pull request. The upstream shorthand cannot name a base branch. */
export const requirePullRequestTarget = (
  templateId: string,
  targetBranch: GitTargetBranch | undefined,
): string => {
  const branch = targetBranch?.branch.trim();
  if (!branch) {
    throw new Error(`Missing required git context for "${templateId}": targetBranch.`);
  }
  if (branch === "@{upstream}") {
    throw new Error(
      "Pull request generation requires an explicit target branch; '@{upstream}' cannot identify a pull request base branch.",
    );
  }
  return branch;
};

/**
 * Checks that the workflow provides each base prompt and the prompt of each launch action, with
 * the core pull request launch. Every other prompt ID is in the messages group.
 */
const checkTemplates = (
  definition: CompiledWorkflowDefinition,
  workflowTemplatesById: ReadonlyMap<string, OwnedPromptTemplate>,
  launchTemplates: ReadonlyMap<string, LaunchTemplate>,
): void => {
  const requireTemplate = (id: string, purpose: PromptPurpose, user: string) => {
    const template = workflowTemplatesById.get(id);
    if (!template) {
      throw new Error(
        `Task workflow "${definition.id}" has no prompt template "${id}" for ${user}.`,
      );
    }
    if (template.purpose !== purpose) {
      throw new Error(
        `Prompt template "${id}" of task workflow "${definition.id}" is a ${template.purpose} template. ${user} needs a ${purpose} template.`,
      );
    }
  };
  for (const id of SYSTEM_PROMPT_IDS) requireTemplate(id, "system", "the system prompt");
  requireTemplate(WORKFLOW_PROMPT_IDS.readOnlyRejection, "permission", "read-only rejections");
  for (const id of workflowTemplatesById.keys())
    if (!BASE_PROMPT_IDS.has(id) && !id.startsWith(WORKFLOW_MESSAGE_PROMPT_PREFIX))
      throw new Error(
        `Prompt "${id}" of task workflow "${definition.id}" is neither a base workflow prompt nor in the "${WORKFLOW_MESSAGE_PROMPT_PREFIX}" group. Rename it.`,
      );
  for (const [launchActionId, launch] of launchTemplates) {
    requireTemplate(launch.templateId, launch.kind, `launch action "${launchActionId}"`);
  }
  if (workflowTemplatesById.has(WORKFLOW_PROMPT_IDS.goal))
    requireTemplate(WORKFLOW_PROMPT_IDS.goal, "goal", "Goal mode");
};

export const createTaskPrompts = (
  definition: CompiledWorkflowDefinition,
  workflowTemplates: readonly PromptTemplate[],
  roles: readonly PromptRole[],
): TaskPrompts => {
  const workflowKey = (promptId: string) =>
    promptOverrideKey({ ownerKind: "workflow", ownerId: definition.id, promptId });
  const roleKey = (roleId: string) =>
    promptOverrideKey({
      ownerKind: "role",
      ownerId: roleId,
      promptId: ROLE_INSTRUCTIONS_PROMPT_ID,
    });
  const workflowTemplatesById = new Map<string, OwnedPromptTemplate>();
  for (const template of workflowTemplates) {
    if (workflowTemplatesById.has(template.id)) {
      throw new Error(
        `Task workflow "${definition.id}" has two prompt templates "${template.id}". Keep one.`,
      );
    }
    workflowTemplatesById.set(template.id, {
      ...template,
      key: workflowKey(template.id),
      ownerKind: "workflow",
    });
  }
  const roleTemplates = roles.map(({ id, systemPrompt }): OwnedPromptTemplate => ({
    ...systemPrompt,
    id: ROLE_INSTRUCTIONS_PROMPT_ID,
    key: roleKey(id),
    ownerKind: "role",
    purpose: "system",
    roleIds: [id],
    requiredPlaceholders: systemPrompt.requiredPlaceholders
      ? [...systemPrompt.requiredPlaceholders]
      : undefined,
  }));
  const templates = [...workflowTemplatesById.values(), ...roleTemplates];
  const templatesByKey = new Map(templates.map((template) => [template.key, template]));
  const rolesById = new Map(roles.map((role) => [role.id, role]));
  const launchActions = [
    ...definition.steps.flatMap((step) => (step.kind === "agent" ? step.launchActions : [])),
    PULL_REQUEST_LAUNCH,
  ];
  const launchTemplates = new Map<string, LaunchTemplate>(
    launchActions.map((launch) => [
      launch.id,
      { templateId: launch.template.id, kind: launch.template.kind },
    ]),
  );
  const createsPullRequest = (roleId: string) =>
    rolesById.has(roleId) &&
    (definition.pullRequestRoles.length === 0 || definition.pullRequestRoles.includes(roleId));
  checkTemplates(definition, workflowTemplatesById, launchTemplates);
  const templateRolesByKey = new Map(
    templates.map((entry) => {
      const templateRoles =
        entry.roleIds ??
        roles
          .filter((role) =>
            entry.ownerKind === "workflow" && entry.id === WORKFLOW_PROMPT_IDS.pullRequest
              ? createsPullRequest(role.id)
              : definition.steps.some(
                  (step) =>
                    step.kind === "agent" &&
                    step.roleId === role.id &&
                    step.launchActions.some((launch) => launch.template.id === entry.id),
                ),
          )
          .map(({ id }) => id);
      for (const role of templateRoles)
        if (!rolesById.has(role))
          throw new Error(
            `Prompt template "${entry.id}" names unknown role "${role}" in task workflow "${definition.id}". Fix its roleIds.`,
          );
      return [entry.key, templateRoles] as const;
    }),
  );
  const nameOf = (entry: OwnedPromptTemplate) =>
    promptName(entry, templateRolesByKey.get(entry.key)!);
  /** The placeholder values that a launch action supplies to its prompt. */
  const launchPlaceholders = (
    launch: Pick<WorkflowLaunchActionDefinition, "id" | "context" | "surface">,
  ): AgentPromptPlaceholder[] => [
    ...BASE_PROMPT_PLACEHOLDERS,
    ...(launch.context === "human_feedback" ? HUMAN_FEEDBACK_PLACEHOLDERS : []),
    ...(isPullRequestLaunch(launch.id) || launch.surface === "git_conflict"
      ? GIT_PLACEHOLDERS
      : []),
  ];
  // A prompt that no launch action sends, such as the role instructions, fills the base set. A
  // prompt that more than one launch action sends can fill only what each of them supplies.
  const fillableByKey = new Map<string, readonly AgentPromptPlaceholder[]>(
    templates.map((entry) => {
      const sets =
        entry.ownerKind === "role"
          ? []
          : launchActions
              .filter((launch) => launch.template.id === entry.id)
              .map(launchPlaceholders);
      const [first = BASE_PROMPT_PLACEHOLDERS, ...rest] = sets;
      return [
        entry.key,
        first.filter((placeholder) => rest.every((set) => set.includes(placeholder))),
      ];
    }),
  );
  const placeholdersOf = (key: string): readonly AgentPromptPlaceholder[] => {
    const fillable = fillableByKey.get(key);
    if (!fillable) throw new Error(`Task workflow "${definition.id}" has no prompt "${key}".`);
    return fillable;
  };
  const rulesOf = (entry: OwnedPromptTemplate): PromptPlaceholderRules => ({
    requiredPlaceholders: entry.requiredPlaceholders ?? [],
    fillablePlaceholders: placeholdersOf(entry.key),
  });
  for (const entry of templates) {
    const { requiredPlaceholders, fillablePlaceholders } = rulesOf(entry);
    const problem = placeholderProblem(entry.template, requiredPlaceholders, fillablePlaceholders);
    if (problem !== undefined)
      throw new Error(
        `The built-in text of ${nameOf(entry)} has a placeholder problem. ${problem} ${fillablePlaceholdersHint(fillablePlaceholders)}`,
      );
  }
  /**
   * The first placeholder problem of a saved layer of one prompt that goes into its final text,
   * with its fix. An override that a repository override hides does not go into the text, so it is
   * not checked here. Settings still shows its problem.
   */
  const savedLayerProblem = (
    entry: OwnedPromptTemplate,
    settings: PromptSettings,
  ): string | undefined => {
    const base = promptBase(settings, entry.key).source;
    const scopeProblem = (
      scope: "global" | "repository",
      layers: PromptSettingsLayers | undefined,
      overrideIsBase: boolean,
    ): string | undefined => {
      if (!layers) return undefined;
      const problems = promptScopeLayerProblems(layers, entry.key, rulesOf(entry));
      const [layer, problem] =
        overrideIsBase && problems.override !== undefined
          ? ["override", problems.override]
          : ["append", problems.append];
      if (problem === undefined) return undefined;
      return `The ${scope} ${layer} of ${nameOf(entry)} has a placeholder problem. ${problem} ${fillablePlaceholdersHint(placeholdersOf(entry.key))} Edit or turn off this ${layer} in Settings.`;
    };
    return (
      scopeProblem("global", settings.global, base === "global_override") ??
      scopeProblem("repository", settings.repository, base === "repository_override")
    );
  };

  const template = (key: string): OwnedPromptTemplate => {
    const found = templatesByKey.get(key);
    if (!found) throw new Error(`Task workflow "${definition.id}" has no prompt "${key}".`);
    return found;
  };
  const launchTemplate = (launchActionId: string, kind: LaunchTemplate["kind"]) => {
    const launch = launchTemplates.get(launchActionId);
    if (!launch) {
      throw new Error(`Task workflow "${definition.id}" has no launch action "${launchActionId}".`);
    }
    if (launch.kind !== kind) {
      throw new Error(`Launch action "${launchActionId}" sends a ${launch.kind} prompt.`);
    }
    return launch;
  };

  const systemTemplateOf = (roleId: string): string => {
    if (!rolesById.has(roleId))
      throw new Error(`Task workflow "${definition.id}" has no role "${roleId}".`);
    return roleKey(roleId);
  };
  const toolList = (roleId: string): string => {
    const role = rolesById.get(roleId);
    if (!role) throw new Error(`Task workflow "${definition.id}" has no role "${roleId}".`);
    const lines = role.tools
      .filter((tool) => !isOdtBrowserToolName(tool))
      .map((tool) => `- ${formatOdtToolArgs(definition, tool)}`);
    lines.push(
      `- Allowed workflow codes for odt_set_task_artifact: ${role.writes.join(", ")}. Free-artifact writes are also allowed.`,
    );
    if (role.agentEvents.length > 0) {
      lines.push("- Workflow events for odt_apply_workflow_event:");
      for (const { id, description, note } of role.agentEvents)
        lines.push(`  - ${id}${note === "required" ? " (note required)" : ""}: ${description}`);
    }
    // The MCP definitions of the browser tools describe their input, so the prompt only names them.
    const browserTools = role.tools.filter(isOdtBrowserToolName);
    if (browserTools.length > 0) lines.push(`- Browser tools: ${browserTools.join(", ")}`);
    return lines.join("\n");
  };

  const placeholderValues = (input: {
    role: string;
    task: PromptTaskContext;
    humanFeedback?: string | undefined;
    pullRequestTarget?: string | undefined;
    git?: AgentPromptGitContext | undefined;
  }) => {
    const { role, task, git, pullRequestTarget } = input;
    const humanFeedback = input.humanFeedback?.trim();
    if (input.humanFeedback !== undefined && !humanFeedback) {
      throw new Error('Prompt placeholder "humanFeedback" must not be empty.');
    }
    const values = new Map<AgentPromptPlaceholder, string>([
      ["role", role],
      ["role.allowedTools", toolList(role)],
      ["task.id", task.taskId],
      ["task.title", compact(task.title)],
      ["task.issueType", compact(task.issueType)],
      ["task.status", compact(task.status)],
      ["task.description", compact(task.description)],
    ]);
    if (humanFeedback) values.set("humanFeedback", humanFeedback);
    if (git || pullRequestTarget) {
      values.set("git.operationLabel", compact(git?.operationLabel));
      values.set("git.currentBranch", compact(git?.currentBranch));
      values.set("git.targetBranch", pullRequestTarget || compact(git?.targetBranch));
      values.set("git.conflictedFiles", compactList(git?.conflictedFiles));
      values.set("git.conflictOutput", compact(git?.conflictOutput));
    }
    return values;
  };

  const resolveTemplate = (
    key: string,
    values: ReadonlyMap<string, string>,
    settings: PromptSettings,
  ): ResolvedAgentPromptTemplate => {
    const definitionTemplate = template(key);
    const name = nameOf(definitionTemplate);
    const problem = savedLayerProblem(definitionTemplate, settings);
    if (problem !== undefined) throw new Error(problem);
    const { parts, override } = composePromptLayers(definitionTemplate.template, settings, key);
    const text = joinPromptLayers(parts);
    const missingValue = extractPromptTemplatePlaceholders(text).find(
      (token) => !values.has(token),
    );
    if (missingValue !== undefined) {
      throw new Error(`The ${name} is missing placeholder value "${missingValue}".`);
    }
    const resolved: ResolvedAgentPromptTemplate = {
      key,
      purpose: definitionTemplate.purpose,
      source: override ? "override" : "builtin",
      builtinVersion: definitionTemplate.builtinVersion,
      hasStaleOverride: isPromptOverrideOutdated(override, definitionTemplate.builtinVersion),
      content: fillPromptPlaceholders(text, values),
    };
    if (override) resolved.overrideBaseVersion = override.baseVersion;
    return resolved;
  };

  const buildPrompt = (
    keys: readonly string[],
    values: ReadonlyMap<string, string>,
    settings: PromptSettings,
  ): BuiltAgentPrompt => {
    const resolved = keys.map((key) => resolveTemplate(key, values, settings));
    return {
      prompt: resolved
        .map((entry) => entry.content.trim())
        .join("\n\n")
        .trim(),
      templates: resolved,
      warnings: resolved.flatMap((entry): AgentPromptWarning[] =>
        entry.hasStaleOverride && entry.overrideBaseVersion !== undefined
          ? [
              {
                type: "override_base_version_mismatch",
                key: entry.key,
                builtinVersion: entry.builtinVersion,
                overrideBaseVersion: entry.overrideBaseVersion,
              },
            ]
          : [],
      ),
    };
  };

  const launchRole = new Map(
    definition.steps.flatMap((step) =>
      step.kind === "agent"
        ? step.launchActions.map((launch) => [launch.id, step.roleId] as const)
        : [],
    ),
  );
  const roleOfLaunch = (launchActionId: string, sessionRole: string | undefined): string => {
    if (isPullRequestLaunch(launchActionId)) {
      if (sessionRole === undefined || !createsPullRequest(sessionRole))
        throw new Error(
          `The pull request prompt of task workflow "${definition.id}" needs a session of a pull request role.`,
        );
      return sessionRole;
    }
    const role = launchRole.get(launchActionId);
    if (role === undefined) {
      throw new Error(`Task workflow "${definition.id}" has no launch action "${launchActionId}".`);
    }
    return role;
  };

  return {
    templates,
    templateRoles: (id) => templateRolesByKey.get(template(workflowKey(id)).key)!,
    systemPrompt: ({ role, task, settings }) =>
      buildPrompt(
        [systemTemplateOf(role), ...SYSTEM_PROMPT_IDS.map(workflowKey)],
        placeholderValues({ role, task }),
        settings,
      ),
    kickoffPrompt: ({ launchActionId, role, task, humanFeedback, targetBranch, settings }) => {
      const launch = launchTemplate(launchActionId, "kickoff");
      const pullRequestTarget = isPullRequestLaunch(launchActionId)
        ? requirePullRequestTarget(launch.templateId, targetBranch)
        : undefined;
      return buildPrompt(
        [workflowKey(launch.templateId)],
        placeholderValues({
          role: roleOfLaunch(launchActionId, role),
          task,
          humanFeedback,
          pullRequestTarget,
        }),
        settings,
      );
    },
    messagePrompt: ({ launchActionId, role, task, git, humanFeedback, targetBranch, settings }) => {
      const launch = launchTemplate(launchActionId, "message");
      if (git && !git.operationLabel?.trim()) {
        throw new Error(
          `Missing required git conflict context for "${launch.templateId}": operationLabel.`,
        );
      }
      return buildPrompt(
        [workflowKey(launch.templateId)],
        placeholderValues({
          role: roleOfLaunch(launchActionId, role),
          task,
          git,
          humanFeedback,
          pullRequestTarget: isPullRequestLaunch(launchActionId)
            ? requirePullRequestTarget(launch.templateId, targetBranch)
            : undefined,
        }),
        settings,
      );
    },
    hasGoalPrompt: workflowTemplatesById.has(WORKFLOW_PROMPT_IDS.goal),
    goalPrompt: ({ launchActionId, task, humanFeedback, settings }) => {
      if (!workflowTemplatesById.has(WORKFLOW_PROMPT_IDS.goal))
        throw new Error(`Task workflow "${definition.id}" has no goal prompt.`);
      return buildPrompt(
        [workflowKey(WORKFLOW_PROMPT_IDS.goal)],
        placeholderValues({ role: roleOfLaunch(launchActionId, undefined), task, humanFeedback }),
        settings,
      );
    },
    readOnlyRejection: ({ role, settings }) =>
      buildPrompt(
        [workflowKey(WORKFLOW_PROMPT_IDS.readOnlyRejection)],
        placeholderValues({ role, task: { taskId: "permission-policy" } }),
        settings,
      ).prompt,
    placeholdersOf,
    findLayerProblem: (settings, { role, launchActionId }) => {
      const launch = launchActionId === undefined ? undefined : launchTemplates.get(launchActionId);
      const keys = [
        systemTemplateOf(role),
        ...SYSTEM_PROMPT_IDS.map(workflowKey),
        ...(launch ? [workflowKey(launch.templateId)] : []),
      ];
      for (const key of keys) {
        const problem = savedLayerProblem(template(key), settings);
        if (problem !== undefined) return problem;
      }
      return undefined;
    },
  };
};
