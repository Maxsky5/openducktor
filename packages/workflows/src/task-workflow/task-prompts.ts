import {
  isOdtBrowserToolName,
  validatePromptTemplatePlaceholders,
  type AgentPromptPlaceholder,
  type CompiledWorkflowDefinition,
  type GitTargetBranch,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import { formatOdtToolArgs } from "./prompt-tool-args";

export type PromptPurpose = "system" | "kickoff" | "message" | "permission";

export type PromptTemplate = {
  id: string;
  purpose: PromptPurpose;
  builtinVersion: number;
  template: string;
  /** An override must keep each of these placeholders. */
  requiredPlaceholders?: AgentPromptPlaceholder[];
};

/** The shared system templates, in prompt order after the role template. */
export const SHARED_SYSTEM_TEMPLATE_IDS = [
  "system.shared.workflow_guards",
  "system.shared.tool_protocol",
  "system.shared.task_context",
] as const;
export const READ_ONLY_REJECTION_TEMPLATE_ID = "permission.read_only.reject";
/** The system template of a role. */
export const roleSystemTemplateId = (roleId: string): string => `system.role.${roleId}.base`;

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
  id: string;
  purpose: PromptPurpose;
  source: "builtin" | "override";
  builtinVersion: number;
  overrideBaseVersion?: number;
  hasStaleOverride: boolean;
  content: string;
};

export type AgentPromptWarning = {
  type: "override_base_version_mismatch";
  templateId: string;
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
  task: PromptTaskContext;
  humanFeedback?: string | undefined;
  targetBranch?: GitTargetBranch | undefined;
  overrides?: RepoPromptOverrides | undefined;
};

export type MessagePromptInput = {
  launchActionId: string;
  task: PromptTaskContext;
  git: AgentPromptGitContext;
  overrides?: RepoPromptOverrides | undefined;
};

export type MergePromptOverridesInput = {
  globalOverrides?: RepoPromptOverrides | undefined;
  repoOverrides?: RepoPromptOverrides | undefined;
};

/** The prompt templates of a task workflow and the prompts that they build. */
export type TaskPrompts = {
  readonly templates: readonly PromptTemplate[];
  template(id: string): PromptTemplate;
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

type LaunchTemplate = { templateId: string; kind: "kickoff" | "message"; context?: string };

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

/** The first unsupported or missing placeholder of a template, as an error message. */
const placeholderProblem = (
  templateId: string,
  { unsupportedPlaceholders, missingRequiredPlaceholders }: PlaceholderValidation,
): string | undefined => {
  const unsupported = unsupportedPlaceholders[0];
  if (unsupported !== undefined) {
    return `Prompt template "${templateId}" uses unsupported placeholder "${unsupported}".`;
  }
  const missing = missingRequiredPlaceholders[0];
  return missing === undefined
    ? undefined
    : `Prompt template "${templateId}" is missing required placeholder "${missing}".`;
};

/** Checks that the templates cover the roles and launch actions of the definition. */
const checkTemplates = (
  definition: CompiledWorkflowDefinition,
  templatesById: ReadonlyMap<string, PromptTemplate>,
  launchTemplates: ReadonlyMap<string, LaunchTemplate>,
): void => {
  const requireTemplate = (id: string, purpose: PromptPurpose, user: string) => {
    const template = templatesById.get(id);
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
    const problem = placeholderProblem(
      id,
      validatePromptTemplatePlaceholders(template.template, template.requiredPlaceholders),
    );
    if (problem !== undefined) throw new Error(problem);
  };
  for (const id of SHARED_SYSTEM_TEMPLATE_IDS) requireTemplate(id, "system", "the system prompt");
  requireTemplate(READ_ONLY_REJECTION_TEMPLATE_ID, "permission", "read-only rejections");
  for (const role of definition.roles) {
    requireTemplate(roleSystemTemplateId(role.id), "system", `role "${role.id}"`);
  }
  for (const [launchActionId, launch] of launchTemplates) {
    requireTemplate(launch.templateId, launch.kind, `launch action "${launchActionId}"`);
  }
};

export const createTaskPrompts = (
  definition: CompiledWorkflowDefinition,
  templates: readonly PromptTemplate[],
): TaskPrompts => {
  const templatesById = new Map<string, PromptTemplate>();
  for (const template of templates) {
    if (templatesById.has(template.id)) {
      throw new Error(
        `Task workflow "${definition.id}" has two prompt templates "${template.id}". Keep one.`,
      );
    }
    templatesById.set(template.id, template);
  }
  const rolesById = new Map(definition.roles.map((role) => [role.id, role]));
  const launchTemplates = new Map<string, LaunchTemplate>(
    definition.steps.flatMap((step) =>
      step.kind === "agent"
        ? step.launchActions.map((launch) => {
            const entry: LaunchTemplate = {
              templateId: launch.template.id,
              kind: launch.template.kind,
            };
            if (launch.context !== undefined) entry.context = launch.context;
            return [launch.id, entry] as const;
          })
        : [],
    ),
  );
  checkTemplates(definition, templatesById, launchTemplates);

  const template = (id: string): PromptTemplate => {
    const found = templatesById.get(id);
    if (!found) throw new Error(`Task workflow "${definition.id}" has no prompt template "${id}".`);
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

  const toolList = (roleId: string): string => {
    const role = rolesById.get(roleId);
    if (!role) throw new Error(`Task workflow "${definition.id}" has no role "${roleId}".`);
    const lines = role.tools
      .filter((tool) => !isOdtBrowserToolName(tool))
      .map((tool) => `- ${formatOdtToolArgs(definition, tool)}`);
    lines.push(
      `- Allowed workflow codes for odt_set_task_artifact: ${role.writes.join(", ")}. Free-artifact writes are also allowed.`,
    );
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
    git?: AgentPromptGitContext;
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
    templateId: string,
    values: ReadonlyMap<string, string>,
    overrides: RepoPromptOverrides | undefined,
  ): ResolvedAgentPromptTemplate => {
    const definitionTemplate = template(templateId);
    const overrideEntry = overrides?.[templateId];
    const override = overrideEntry && overrideEntry.enabled !== false ? overrideEntry : undefined;
    const text = (override?.template ?? definitionTemplate.template).trim();
    const validation = validatePromptTemplatePlaceholders(
      text,
      definitionTemplate.requiredPlaceholders,
    );
    const problem = placeholderProblem(templateId, validation);
    if (problem !== undefined) throw new Error(override ? `${problem} ${OVERRIDE_FIX}` : problem);
    const missingValue = validation.placeholders.find((token) => !values.has(token));
    if (missingValue !== undefined) {
      throw new Error(
        `Prompt template "${templateId}" is missing placeholder value "${missingValue}".`,
      );
    }
    const resolved: ResolvedAgentPromptTemplate = {
      id: definitionTemplate.id,
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
    templateIds: readonly string[],
    values: ReadonlyMap<string, string>,
    overrides: RepoPromptOverrides | undefined,
  ): BuiltAgentPrompt => {
    const resolved = templateIds.map((templateId) =>
      resolveTemplate(templateId, values, overrides),
    );
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
                templateId: entry.id,
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
  const roleOfLaunch = (launchActionId: string): string => {
    const role = launchRole.get(launchActionId);
    if (role === undefined) {
      throw new Error(`Task workflow "${definition.id}" has no launch action "${launchActionId}".`);
    }
    return role;
  };

  return {
    templates,
    template,
    systemPrompt: ({ role, task, overrides }) =>
      buildPrompt(
        [roleSystemTemplateId(role), ...SHARED_SYSTEM_TEMPLATE_IDS],
        placeholderValues({ role, task }),
        overrides,
      ),
    kickoffPrompt: ({ launchActionId, task, humanFeedback, targetBranch, overrides }) => {
      const launch = launchTemplate(launchActionId, "kickoff");
      const pullRequestTarget =
        launch.context === "pull_request"
          ? requirePullRequestTarget(launch.templateId, targetBranch)
          : undefined;
      return buildPrompt(
        [launch.templateId],
        placeholderValues({
          role: roleOfLaunch(launchActionId),
          task,
          humanFeedback,
          pullRequestTarget,
        }),
        overrides,
      );
    },
    messagePrompt: ({ launchActionId, task, git, overrides }) => {
      const launch = launchTemplate(launchActionId, "message");
      if (!git.operationLabel?.trim()) {
        throw new Error(
          `Missing required git conflict context for "${launch.templateId}": operationLabel.`,
        );
      }
      return buildPrompt(
        [launch.templateId],
        placeholderValues({ role: roleOfLaunch(launchActionId), task, git }),
        overrides,
      );
    },
    readOnlyRejection: ({ role, overrides }) =>
      buildPrompt(
        [READ_ONLY_REJECTION_TEMPLATE_ID],
        placeholderValues({ role, task: { taskId: "permission-policy" } }),
        overrides,
      ).prompt,
    mergeOverrides: ({ globalOverrides, repoOverrides }) =>
      Object.fromEntries(
        templates.flatMap(({ id }) => {
          const repoOverride = repoOverrides?.[id];
          if (repoOverride && repoOverride.enabled !== false) return [[id, repoOverride] as const];
          const globalOverride = globalOverrides?.[id];
          return globalOverride && globalOverride.enabled !== false
            ? [[id, globalOverride] as const]
            : [];
        }),
      ),
    findOverrideProblem: (overrides) => {
      for (const { id, requiredPlaceholders } of templates) {
        const override = overrides?.[id];
        if (!override || override.enabled === false) continue;
        const problem = placeholderProblem(
          id,
          validatePromptTemplatePlaceholders(override.template.trim(), requiredPlaceholders),
        );
        if (problem !== undefined) return `${problem} ${OVERRIDE_FIX}`;
      }
      return undefined;
    },
  };
};
