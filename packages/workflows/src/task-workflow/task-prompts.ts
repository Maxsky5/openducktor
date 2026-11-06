import {
  isOdtBrowserToolName,
  PULL_REQUEST_LAUNCH_ID,
  promptOverrideKey,
  ROLE_INSTRUCTIONS_PROMPT_ID,
  validatePromptTemplatePlaceholders,
  WORKFLOW_MESSAGE_PROMPT_PREFIX,
  WORKFLOW_PROMPT_IDS,
  type AgentPromptPlaceholder,
  type AgentToolName,
  type CompiledAgentRoleDefinition,
  type CompiledWorkflowDefinition,
  type GitTargetBranch,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import { formatOdtToolArgs } from "./prompt-tool-args";
import { isPullRequestLaunch, PULL_REQUEST_LAUNCH } from "./pull-request-launch";

export type PromptPurpose = "system" | "kickoff" | "message" | "permission";

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
  overrides?: RepoPromptOverrides | undefined;
};

export type KickoffPromptInput = {
  launchActionId: string;
  /** The role of the session. The core pull request launch needs it. */
  role?: string | undefined;
  task: PromptTaskContext;
  humanFeedback?: string | undefined;
  targetBranch?: GitTargetBranch | undefined;
  overrides?: RepoPromptOverrides | undefined;
};

export type MessagePromptInput = {
  launchActionId: string;
  /** The role of the session. The core pull request launch needs it. */
  role?: string | undefined;
  task: PromptTaskContext;
  git?: AgentPromptGitContext | undefined;
  humanFeedback?: string | undefined;
  targetBranch?: GitTargetBranch | undefined;
  overrides?: RepoPromptOverrides | undefined;
};

export type MergePromptOverridesInput = {
  globalOverrides?: RepoPromptOverrides | undefined;
  repoOverrides?: RepoPromptOverrides | undefined;
};

/** The prompts of a task workflow and of its roles, and the prompts that they build. */
export type TaskPrompts = {
  readonly templates: readonly OwnedPromptTemplate[];
  /** The roles that use a workflow prompt. No role marks shared prompt information. */
  templateRoles(id: string): readonly string[];
  systemPrompt(input: SystemPromptInput): BuiltAgentPrompt;
  kickoffPrompt(input: KickoffPromptInput): BuiltAgentPrompt;
  messagePrompt(input: MessagePromptInput): BuiltAgentPrompt;
  readOnlyRejection(input: { role: string; overrides?: RepoPromptOverrides | undefined }): string;
  /** The enabled repository override wins over the enabled global override. */
  mergeOverrides(input: MergePromptOverridesInput): RepoPromptOverrides;
  /**
   * The first problem of an enabled override, with its fix. Settings reject new invalid overrides,
   * so a problem comes from an override that an earlier version saved.
   */
  findOverrideProblem(overrides: RepoPromptOverrides | undefined): string | undefined;
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
const OVERRIDE_FIX = "Edit or disable this prompt override in Settings.";

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

type PlaceholderValidation = ReturnType<typeof validatePromptTemplatePlaceholders>;

/** The first unsupported or missing placeholder of a prompt, as an error message. */
const placeholderProblem = (
  name: string,
  { unsupportedPlaceholders, missingRequiredPlaceholders }: PlaceholderValidation,
): string | undefined => {
  const unsupported = unsupportedPlaceholders[0];
  if (unsupported !== undefined) {
    return `The ${name} uses unsupported placeholder "${unsupported}".`;
  }
  const missing = missingRequiredPlaceholders[0];
  return missing === undefined
    ? undefined
    : `The ${name} is missing required placeholder "${missing}".`;
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
  const launchTemplates = new Map<string, LaunchTemplate>([
    ...definition.steps.flatMap((step) =>
      step.kind === "agent"
        ? step.launchActions.map(
            (launch) =>
              [launch.id, { templateId: launch.template.id, kind: launch.template.kind }] as const,
          )
        : [],
    ),
    [
      PULL_REQUEST_LAUNCH_ID,
      { templateId: PULL_REQUEST_LAUNCH.template.id, kind: PULL_REQUEST_LAUNCH.template.kind },
    ],
  ]);
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
  for (const entry of templates) {
    const problem = placeholderProblem(
      nameOf(entry),
      validatePromptTemplatePlaceholders(entry.template, entry.requiredPlaceholders),
    );
    if (problem !== undefined) throw new Error(problem);
  }

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
    overrides: RepoPromptOverrides | undefined,
  ): ResolvedAgentPromptTemplate => {
    const definitionTemplate = template(key);
    const name = nameOf(definitionTemplate);
    const overrideEntry = overrides?.[key];
    const override = overrideEntry && overrideEntry.enabled !== false ? overrideEntry : undefined;
    const text = (override?.template ?? definitionTemplate.template).trim();
    const validation = validatePromptTemplatePlaceholders(
      text,
      definitionTemplate.requiredPlaceholders,
    );
    const problem = placeholderProblem(name, validation);
    if (problem !== undefined) throw new Error(override ? `${problem} ${OVERRIDE_FIX}` : problem);
    const missingValue = validation.placeholders.find((token) => !values.has(token));
    if (missingValue !== undefined) {
      throw new Error(`The ${name} is missing placeholder value "${missingValue}".`);
    }
    const resolved: ResolvedAgentPromptTemplate = {
      key,
      purpose: definitionTemplate.purpose,
      source: override ? "override" : "builtin",
      builtinVersion: definitionTemplate.builtinVersion,
      hasStaleOverride: Boolean(
        override && override.baseVersion !== definitionTemplate.builtinVersion,
      ),
      content: text.replace(
        PLACEHOLDER_PATTERN,
        (_match, token: string) => values.get(token) ?? "",
      ),
    };
    if (override) resolved.overrideBaseVersion = override.baseVersion;
    return resolved;
  };

  const buildPrompt = (
    keys: readonly string[],
    values: ReadonlyMap<string, string>,
    overrides: RepoPromptOverrides | undefined,
  ): BuiltAgentPrompt => {
    const resolved = keys.map((key) => resolveTemplate(key, values, overrides));
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
    systemPrompt: ({ role, task, overrides }) =>
      buildPrompt(
        [systemTemplateOf(role), ...SYSTEM_PROMPT_IDS.map(workflowKey)],
        placeholderValues({ role, task }),
        overrides,
      ),
    kickoffPrompt: ({ launchActionId, role, task, humanFeedback, targetBranch, overrides }) => {
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
        overrides,
      );
    },
    messagePrompt: ({
      launchActionId,
      role,
      task,
      git,
      humanFeedback,
      targetBranch,
      overrides,
    }) => {
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
        overrides,
      );
    },
    readOnlyRejection: ({ role, overrides }) =>
      buildPrompt(
        [workflowKey(WORKFLOW_PROMPT_IDS.readOnlyRejection)],
        placeholderValues({ role, task: { taskId: "permission-policy" } }),
        overrides,
      ).prompt,
    mergeOverrides: ({ globalOverrides, repoOverrides }) =>
      Object.fromEntries(
        templates.flatMap(({ key }) => {
          const repoOverride = repoOverrides?.[key];
          if (repoOverride && repoOverride.enabled !== false) return [[key, repoOverride] as const];
          const globalOverride = globalOverrides?.[key];
          return globalOverride && globalOverride.enabled !== false
            ? [[key, globalOverride] as const]
            : [];
        }),
      ),
    findOverrideProblem: (overrides) => {
      for (const entry of templates) {
        const override = overrides?.[entry.key];
        if (!override || override.enabled === false) continue;
        const problem = placeholderProblem(
          nameOf(entry),
          validatePromptTemplatePlaceholders(override.template.trim(), entry.requiredPlaceholders),
        );
        if (problem !== undefined) return `${problem} ${OVERRIDE_FIX}`;
      }
      return undefined;
    },
  };
};
