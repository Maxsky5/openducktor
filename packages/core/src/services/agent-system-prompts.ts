import {
  type AgentPromptTemplateId,
  isAgentKickoffScenario,
  type RepoPromptOverrides,
  validatePromptTemplatePlaceholders,
} from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentKickoffScenario,
  type AgentRole,
  type AgentScenario,
  type AgentToolName,
} from "../types/agent-orchestrator";

export type AgentPromptTaskContext = {
  taskId: string;
  title: string;
  issueType: "task" | "feature" | "bug" | "epic";
  status: string;
  qaRequired: boolean;
  description?: string;
  specMarkdown?: string;
  planMarkdown?: string;
  latestQaReportMarkdown?: string;
};

export type BuildAgentPromptInput = {
  role: AgentRole;
  scenario: AgentScenario;
  task: AgentPromptTaskContext;
  overrides?: RepoPromptOverrides;
};

export type BuildAgentKickoffPromptInput = {
  role: AgentRole;
  scenario: AgentKickoffScenario;
  task: {
    taskId: string;
    title?: string;
    issueType?: "task" | "feature" | "bug" | "epic";
    status?: string;
    qaRequired?: boolean;
    description?: string;
    specMarkdown?: string;
    planMarkdown?: string;
    latestQaReportMarkdown?: string;
  };
  overrides?: RepoPromptOverrides;
};

export type AgentPromptGitContext = {
  operationLabel?: string;
  currentBranch?: string;
  targetBranch?: string;
  conflictedFiles?: string[];
  conflictOutput?: string;
};

export type AgentMessageTemplateId = Extract<AgentPromptTemplateId, `message.${string}`>;

export type BuildAgentMessagePromptInput = {
  role: AgentRole;
  templateId: AgentMessageTemplateId;
  task: {
    taskId: string;
    title?: string;
    issueType?: "task" | "feature" | "bug" | "epic";
    status?: string;
    qaRequired?: boolean;
    description?: string;
    specMarkdown?: string;
    planMarkdown?: string;
    latestQaReportMarkdown?: string;
  };
  git?: AgentPromptGitContext;
  overrides?: RepoPromptOverrides;
};

export type BuildReadOnlyPermissionRejectionMessageInput = {
  role: AgentRole;
  overrides?: RepoPromptOverrides;
};

export type MergePromptOverridesInput = {
  globalOverrides?: RepoPromptOverrides;
  repoOverrides?: RepoPromptOverrides;
};

type AgentPromptPurpose = "system" | "kickoff" | "message" | "permission";

type AgentPromptTemplateDefinition = {
  id: AgentPromptTemplateId;
  purpose: AgentPromptPurpose;
  builtinVersion: number;
  template: string;
};

export type ResolvedAgentPromptTemplate = {
  id: AgentPromptTemplateId;
  purpose: AgentPromptPurpose;
  source: "builtin" | "override";
  builtinVersion: number;
  overrideBaseVersion?: number;
  hasStaleOverride: boolean;
  content: string;
};

export type AgentPromptWarning = {
  type: "override_base_version_mismatch";
  templateId: AgentPromptTemplateId;
  builtinVersion: number;
  overrideBaseVersion: number;
};

export type BuiltAgentPrompt = {
  prompt: string;
  templates: ResolvedAgentPromptTemplate[];
  warnings: AgentPromptWarning[];
};

const TOOL_ARG_SPEC: Record<AgentToolName, string> = {
  odt_read_task: `odt_read_task({"taskId": string})`,
  odt_set_spec: `odt_set_spec({"taskId": string, "markdown": string})`,
  odt_set_plan: `odt_set_plan({"taskId": string, "markdown": string, "subtasks"?: [{"title": string, "issueType"?: "task"|"feature"|"bug", "priority"?: 0|1|2|3|4, "description"?: string}]})`,
  odt_build_blocked: `odt_build_blocked({"taskId": string, "reason": string})`,
  odt_build_resumed: `odt_build_resumed({"taskId": string})`,
  odt_build_completed: `odt_build_completed({"taskId": string, "summary"?: string})`,
  odt_qa_approved: `odt_qa_approved({"taskId": string, "reportMarkdown": string})`,
  odt_qa_rejected: `odt_qa_rejected({"taskId": string, "reportMarkdown": string})`,
};

const AGENT_PROMPT_DEFINITIONS: Record<AgentPromptTemplateId, AgentPromptTemplateDefinition> = {
  "system.shared.workflow_guards": {
    id: "system.shared.workflow_guards",
    purpose: "system",
    builtinVersion: 2,
    template: `Workflow constraints you must obey:
- Feature/epic flow: open -> spec_ready -> ready_for_dev -> in_progress -> ai_review/human_review -> closed.
- Task/bug may skip planning and go open -> in_progress.
- odt_set_spec allowed from open/spec_ready/ready_for_dev.
- odt_set_plan for feature/epic allowed from spec_ready/ready_for_dev.
- odt_set_plan for task/bug allowed from open/spec_ready/ready_for_dev.
- For odt_set_plan subtasks, priority must be an integer 0..4 (default 2).
- odt_build_completed from in_progress transitions to ai_review only when qaRequired=true and the latest QA verdict is not approved; otherwise it transitions to human_review.
- odt_qa_rejected transitions ai_review/human_review -> in_progress.
- odt_qa_approved transitions ai_review/human_review -> human_review.`,
  },
  "system.shared.tool_protocol": {
    id: "system.shared.tool_protocol",
    purpose: "system",
    builtinVersion: 1,
    template: `OpenDucktor workflow tools are native MCP tools.
Call them directly as tool invocations; do not emit XML wrappers or pseudo-tool payloads.

Allowed tools for this role:
{{role.allowedTools}}

Session task lock:
- Use this exact taskId literal in every odt_* call: {{task.id}}.
- Never derive taskId from title/slug or rewrite it.
- If a tool call fails with task-id mismatch, retry with {{task.id}}.

Always include taskId in every odt_* tool call.
Never invent tool names. Never call tools not listed above.
When asked about which ODT tools are enabled or disabled, answer strictly from the allowed-tools list above and treat every other ODT workflow tool as denied.`,
  },
  "system.shared.task_context": {
    id: "system.shared.task_context",
    purpose: "system",
    builtinVersion: 1,
    template: `Task context:
- id: {{task.id}}
- title: {{task.title}}
- issueType: {{task.issueType}}
- currentStatus: {{task.status}}
- qaRequired: {{task.qaRequired}}
- description: {{task.description}}

Existing documents:
- spec: {{task.specMarkdown}}
- implementationPlan: {{task.planMarkdown}}
- latestQaReport: {{task.latestQaReportMarkdown}}`,
  },
  "system.role.spec.base": {
    id: "system.role.spec.base",
    purpose: "system",
    builtinVersion: 1,
    template: `You are the Spec Agent for OpenDucktor.
Your job is to produce or refine a complete, implementation-ready specification in markdown.
Persist the canonical spec with the native odt_set_spec MCP tool.

Spec quality bar:
- Include clear purpose, problem, goals, non-goals, scope, API/interfaces, risks, and test plan.
- Keep language concrete and verifiable.
- Resolve ambiguity before finalizing.
- Ground the spec in repository evidence.
- Before calling odt_set_spec, inspect relevant project files with read/list/search tools and cite concrete file paths in your final summary.
- You operate in read-only mode for repository mutation. Never modify files, git state, or environment.`,
  },
  "system.role.planner.base": {
    id: "system.role.planner.base",
    purpose: "system",
    builtinVersion: 1,
    template: `You are the Planner Agent for OpenDucktor.
Your job is to produce an implementation plan that developers or builder agents can execute directly.
Persist the plan with odt_set_plan.

Plan quality bar:
- Break work into concrete, ordered steps.
- Include validation strategy and rollback/risk notes.
- For epic tasks, propose direct subtasks when useful (max one level deep, no epic subtasks).
- If you include subtask priority, use integers only in 0..4 (default 2).
- Use read/list/search tools when additional repository context is needed.
- You operate in read-only mode for repository mutation. Never modify files, git state, or environment.`,
  },
  "system.role.build.base": {
    id: "system.role.build.base",
    purpose: "system",
    builtinVersion: 1,
    template: `You are the Build Agent for OpenDucktor.
You run in a git worktree and execute implementation safely.

Execution policy:
- Keep changes scoped to task requirements and documented intent.
- Run relevant checks before completion.
- If blocked, call odt_build_blocked with a specific reason.
- When resumed after a blocker, call odt_build_resumed.
- When complete, call odt_build_completed with a concise summary.`,
  },
  "system.role.qa.base": {
    id: "system.role.qa.base",
    purpose: "system",
    builtinVersion: 1,
    template: `You are the QA Agent for OpenDucktor.
You validate implementation quality against task requirements.

QA policy:
- Verify task requirements and high-risk behavior.
- Include failed and passing evidence in report markdown.
- Call odt_qa_approved only when confidence is strong.
- Call odt_qa_rejected with precise remediation guidance when quality bar is not met.
- Use read/list/search tools to gather evidence when needed.
- You operate in read-only mode for repository mutation. Never modify files, git state, or environment.`,
  },
  "system.scenario.spec_initial": {
    id: "system.scenario.spec_initial",
    purpose: "system",
    builtinVersion: 1,
    template: `Scenario: Specification authoring.
Create or update the task specification with complete, implementation-ready markdown.
Call odt_set_spec exactly once with the updated markdown.`,
  },
  "system.scenario.planner_initial": {
    id: "system.scenario.planner_initial",
    purpose: "system",
    builtinVersion: 1,
    template: `Scenario: Planning.
Create or update the implementation plan based on the current task context.
Call odt_set_plan with the revised markdown.`,
  },
  "system.scenario.build_implementation_start": {
    id: "system.scenario.build_implementation_start",
    purpose: "system",
    builtinVersion: 1,
    template: `Scenario: Initial implementation run.
Implement the task from current spec/plan context.
Call odt_build_completed once implementation and checks are done.`,
  },
  "system.scenario.build_after_qa_rejected": {
    id: "system.scenario.build_after_qa_rejected",
    purpose: "system",
    builtinVersion: 1,
    template: `Scenario: Rework after QA rejection.
Address every QA rejection item before calling odt_build_completed again.`,
  },
  "system.scenario.build_after_human_request_changes": {
    id: "system.scenario.build_after_human_request_changes",
    purpose: "system",
    builtinVersion: 1,
    template: `Scenario: Rework after human requested changes.
Incorporate requested changes and provide a clean completion summary via odt_build_completed.`,
  },
  "system.scenario.build_rebase_conflict_resolution": {
    id: "system.scenario.build_rebase_conflict_resolution",
    purpose: "system",
    builtinVersion: 1,
    template: `Scenario: Git conflict resolution.
The worktree is paused on an in-progress git conflict. Resolve it safely, continue or complete the interrupted git operation, and rerun relevant checks.
Do not call odt_build_completed unless the task itself is actually complete after the conflict is resolved.`,
  },
  "system.scenario.qa_review": {
    id: "system.scenario.qa_review",
    purpose: "system",
    builtinVersion: 1,
    template: `Scenario: QA review.
Evaluate the implementation and produce a QA report markdown.
Call odt_qa_approved or odt_qa_rejected exactly once per review pass.`,
  },
  "kickoff.spec_initial": {
    id: "kickoff.spec_initial",
    purpose: "kickoff",
    builtinVersion: 1,
    template:
      "Create or update the specification and call odt_set_spec with complete markdown when ready.\nUse taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.planner_initial": {
    id: "kickoff.planner_initial",
    purpose: "kickoff",
    builtinVersion: 1,
    template:
      "Create or update the implementation plan and call odt_set_plan when ready.\nUse taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.build_implementation_start": {
    id: "kickoff.build_implementation_start",
    purpose: "kickoff",
    builtinVersion: 1,
    template:
      "Start implementation now. Use odt_build_blocked/odt_build_resumed/odt_build_completed for workflow transitions.\nUse taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.build_after_qa_rejected": {
    id: "kickoff.build_after_qa_rejected",
    purpose: "kickoff",
    builtinVersion: 1,
    template:
      "Address all QA rejection findings and call odt_build_completed when done.\nUse taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.build_after_human_request_changes": {
    id: "kickoff.build_after_human_request_changes",
    purpose: "kickoff",
    builtinVersion: 1,
    template:
      "Apply all human-requested changes and call odt_build_completed when done.\nUse taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.qa_review": {
    id: "kickoff.qa_review",
    purpose: "kickoff",
    builtinVersion: 1,
    template:
      "Perform QA review now and call exactly one of odt_qa_approved or odt_qa_rejected.\nUse taskId {{task.id}} for every odt_* tool call.",
  },
  "message.build_pull_request_draft": {
    id: "message.build_pull_request_draft",
    purpose: "message",
    builtinVersion: 1,
    template: `Generate a pull request title and description for this task.

Requirements:
- Base the result on the implemented work in this forked builder session.
- Use the task title, description, spec, plan, latest QA report, and actual code changes.
- Be specific about the user-visible outcome and major implementation points.
- Do not mention that this came from an AI, agent, or forked session.
- Respond with exactly this format:
Title: <single-line title>
Description:
<markdown body>

Task context:
- id: {{task.id}}
- title: {{task.title}}
- issueType: {{task.issueType}}
- status: {{task.status}}
- description: {{task.description}}
- spec: {{task.specMarkdown}}
- implementationPlan: {{task.planMarkdown}}
- latestQaReport: {{task.latestQaReportMarkdown}}`,
  },
  "message.build_rebase_conflict_resolution": {
    id: "message.build_rebase_conflict_resolution",
    purpose: "message",
    builtinVersion: 1,
    template: `Resolve the current git conflict in this worktree.
- operation: {{git.operationLabel}}
- currentBranch: {{git.currentBranch}}
- targetBranch: {{git.targetBranch}}
- conflictedFiles:
{{git.conflictedFiles}}
- gitOutput:
{{git.conflictOutput}}

Continue or complete the interrupted git operation after resolving the conflicts, run the relevant checks for the touched code, and reply with a concise summary.
Use taskId {{task.id}} for any odt_* tool calls.`,
  },
  "permission.read_only.reject": {
    id: "permission.read_only.reject",
    purpose: "permission",
    builtinVersion: 1,
    template: "Rejected by OpenDucktor {{role}} read-only policy.",
  },
};

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

const compact = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "(none)";
};

const compactList = (values: string[] | undefined): string => {
  const normalized = (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (normalized.length === 0) {
    return "(none)";
  }

  return normalized.map((value) => `- ${value}`).join("\n");
};

const toRoleBaseTemplateId = (role: AgentRole): AgentPromptTemplateId => {
  return `system.role.${role}.base`;
};

const toSystemScenarioTemplateId = (scenario: AgentScenario): AgentPromptTemplateId => {
  return `system.scenario.${scenario}`;
};

const KICKOFF_TEMPLATE_IDS: Record<AgentKickoffScenario, AgentPromptTemplateId> = {
  spec_initial: "kickoff.spec_initial",
  planner_initial: "kickoff.planner_initial",
  build_implementation_start: "kickoff.build_implementation_start",
  build_after_qa_rejected: "kickoff.build_after_qa_rejected",
  build_after_human_request_changes: "kickoff.build_after_human_request_changes",
  qa_review: "kickoff.qa_review",
};

const toKickoffTemplateId = (scenario: AgentScenario): AgentPromptTemplateId => {
  if (!isAgentKickoffScenario(scenario)) {
    throw new Error(`Scenario "${scenario}" does not define a kickoff prompt.`);
  }

  return KICKOFF_TEMPLATE_IDS[scenario];
};

const buildToolListPlaceholder = (role: AgentRole): string => {
  const allowedTools = AGENT_ROLE_TOOL_POLICY[role];
  return allowedTools.map((tool) => `- ${TOOL_ARG_SPEC[tool]}`).join("\n");
};

const buildPlaceholderValues = ({
  role,
  task,
  git,
}: {
  role: AgentRole;
  task: BuildAgentKickoffPromptInput["task"];
  git?: AgentPromptGitContext;
}): Record<string, string> => {
  return {
    role,
    "role.allowedTools": buildToolListPlaceholder(role),
    "task.id": task.taskId,
    "task.title": compact(task.title),
    "task.issueType": task.issueType ?? "task",
    "task.status": compact(task.status),
    "task.qaRequired": task.qaRequired ? "true" : "false",
    "task.description": compact(task.description),
    "task.specMarkdown": compact(task.specMarkdown),
    "task.planMarkdown": compact(task.planMarkdown),
    "task.latestQaReportMarkdown": compact(task.latestQaReportMarkdown),
    ...(git
      ? {
          "git.operationLabel": compact(git.operationLabel),
          "git.currentBranch": compact(git.currentBranch),
          "git.targetBranch": compact(git.targetBranch),
          "git.conflictedFiles": compactList(git.conflictedFiles),
          "git.conflictOutput": compact(git.conflictOutput),
        }
      : {}),
  };
};

const collectPromptWarnings = (templates: ResolvedAgentPromptTemplate[]): AgentPromptWarning[] => {
  const warnings: AgentPromptWarning[] = [];
  for (const template of templates) {
    if (!template.hasStaleOverride || template.overrideBaseVersion === undefined) {
      continue;
    }
    warnings.push({
      type: "override_base_version_mismatch",
      templateId: template.id,
      builtinVersion: template.builtinVersion,
      overrideBaseVersion: template.overrideBaseVersion,
    });
  }
  return warnings;
};

const resolveTemplate = ({
  templateId,
  placeholderValues,
  overrides,
}: {
  templateId: AgentPromptTemplateId;
  placeholderValues: Record<string, string>;
  overrides: RepoPromptOverrides | undefined;
}): ResolvedAgentPromptTemplate => {
  const definition = AGENT_PROMPT_DEFINITIONS[templateId];
  if (!definition) {
    throw new Error(`Unknown prompt template id "${templateId}".`);
  }

  const overrideEntry = overrides?.[templateId];
  const override = overrideEntry && overrideEntry.enabled !== false ? overrideEntry : undefined;
  const source = override ? "override" : "builtin";
  const template = (override?.template ?? definition.template).trim();

  const { placeholders, unsupportedPlaceholders } = validatePromptTemplatePlaceholders(template);
  if (unsupportedPlaceholders.length > 0) {
    throw new Error(
      `Prompt template "${templateId}" uses unsupported placeholder "${unsupportedPlaceholders[0]}".`,
    );
  }
  for (const token of placeholders) {
    if (!(token in placeholderValues)) {
      throw new Error(`Prompt template "${templateId}" is missing placeholder value "${token}".`);
    }
  }

  const content = template.replace(PLACEHOLDER_PATTERN, (_match, token: string) => {
    const value = placeholderValues[token];
    if (value === undefined) {
      throw new Error(`Prompt template "${templateId}" is missing placeholder value "${token}".`);
    }
    return value;
  });

  return {
    id: definition.id,
    purpose: definition.purpose,
    source,
    builtinVersion: definition.builtinVersion,
    ...(override ? { overrideBaseVersion: override.baseVersion } : {}),
    hasStaleOverride: Boolean(override && override.baseVersion !== definition.builtinVersion),
    content,
  };
};

const buildPromptFromTemplates = ({
  templateIds,
  role,
  task,
  git,
  overrides,
}: {
  templateIds: AgentPromptTemplateId[];
  role: AgentRole;
  task: BuildAgentKickoffPromptInput["task"];
  git?: AgentPromptGitContext;
  overrides: RepoPromptOverrides | undefined;
}): BuiltAgentPrompt => {
  const placeholderValues = buildPlaceholderValues({
    role,
    task,
    ...(git ? { git } : {}),
  });
  const templates = templateIds.map((templateId) =>
    resolveTemplate({
      templateId,
      placeholderValues,
      overrides,
    }),
  );

  return {
    prompt: templates
      .map((entry) => entry.content.trim())
      .join("\n\n")
      .trim(),
    templates,
    warnings: collectPromptWarnings(templates),
  };
};

export const listBuiltinAgentPromptTemplates = (): AgentPromptTemplateDefinition[] => {
  return Object.values(AGENT_PROMPT_DEFINITIONS).map((definition) => ({ ...definition }));
};

export const buildAgentSystemPromptBundle = (input: BuildAgentPromptInput): BuiltAgentPrompt => {
  return buildPromptFromTemplates({
    templateIds: [
      toRoleBaseTemplateId(input.role),
      toSystemScenarioTemplateId(input.scenario),
      "system.shared.workflow_guards",
      "system.shared.tool_protocol",
      "system.shared.task_context",
    ],
    role: input.role,
    task: input.task,
    overrides: input.overrides,
  });
};

export function buildAgentSystemPrompt(input: BuildAgentPromptInput): string {
  return buildAgentSystemPromptBundle(input).prompt;
}

export const buildAgentKickoffPromptBundle = (
  input: BuildAgentKickoffPromptInput,
): BuiltAgentPrompt => {
  return buildPromptFromTemplates({
    templateIds: [toKickoffTemplateId(input.scenario)],
    role: input.role,
    task: input.task,
    overrides: input.overrides,
  });
};

export const buildAgentKickoffPrompt = (input: BuildAgentKickoffPromptInput): string => {
  return buildAgentKickoffPromptBundle(input).prompt;
};

export const buildAgentMessagePromptBundle = (
  input: BuildAgentMessagePromptInput,
): BuiltAgentPrompt => {
  return buildPromptFromTemplates({
    templateIds: [input.templateId],
    role: input.role,
    task: input.task,
    ...(input.git ? { git: input.git } : {}),
    overrides: input.overrides,
  });
};

export const buildAgentMessagePrompt = (input: BuildAgentMessagePromptInput): string => {
  return buildAgentMessagePromptBundle(input).prompt;
};

export const buildReadOnlyPermissionRejectionMessageBundle = (
  input: BuildReadOnlyPermissionRejectionMessageInput,
): BuiltAgentPrompt => {
  return buildPromptFromTemplates({
    templateIds: ["permission.read_only.reject"],
    role: input.role,
    task: {
      taskId: "permission-policy",
    },
    overrides: input.overrides,
  });
};

export const buildReadOnlyPermissionRejectionMessage = (
  input: BuildReadOnlyPermissionRejectionMessageInput,
): string => {
  return buildReadOnlyPermissionRejectionMessageBundle(input).prompt;
};

export const mergePromptOverrides = ({
  globalOverrides,
  repoOverrides,
}: MergePromptOverridesInput): RepoPromptOverrides => {
  const result: RepoPromptOverrides = {};
  const keys = new Set([
    ...Object.keys(globalOverrides ?? {}),
    ...Object.keys(repoOverrides ?? {}),
  ]);

  for (const key of keys) {
    const templateId = key as AgentPromptTemplateId;
    const repoOverride = repoOverrides?.[templateId];
    if (repoOverride) {
      if (repoOverride.enabled !== false) {
        result[templateId] = repoOverride;
        continue;
      }

      const globalOverride = globalOverrides?.[templateId];
      if (globalOverride && globalOverride.enabled !== false) {
        result[templateId] = globalOverride;
      }
      continue;
    }

    const globalOverride = globalOverrides?.[templateId];
    if (globalOverride && globalOverride.enabled !== false) {
      result[templateId] = globalOverride;
    }
  }

  return result;
};
