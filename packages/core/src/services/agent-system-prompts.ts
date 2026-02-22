import {
  AGENT_ROLE_TOOL_POLICY,
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
  acceptanceCriteria?: string;
  specMarkdown?: string;
  planMarkdown?: string;
  latestQaReportMarkdown?: string;
};

export type BuildAgentPromptInput = {
  role: AgentRole;
  scenario: AgentScenario;
  task: AgentPromptTaskContext;
};

const TOOL_ARG_SPEC: Record<AgentToolName, string> = {
  odt_read_task: `odt_read_task({"taskId": string})`,
  odt_set_spec: `odt_set_spec({"taskId": string, "markdown": string})`,
  odt_set_plan: `odt_set_plan({"taskId": string, "markdown": string, "subtasks"?: [{"title": string, "issueType"?: "task"|"feature"|"bug", "priority"?: number, "description"?: string}]})`,
  odt_build_blocked: `odt_build_blocked({"taskId": string, "reason": string})`,
  odt_build_resumed: `odt_build_resumed({"taskId": string})`,
  odt_build_completed: `odt_build_completed({"taskId": string, "summary"?: string})`,
  odt_qa_approved: `odt_qa_approved({"taskId": string, "reportMarkdown": string})`,
  odt_qa_rejected: `odt_qa_rejected({"taskId": string, "reportMarkdown": string})`,
};

const WORKFLOW_GUARDS = `
Workflow constraints you must obey:
- Feature/epic flow: open -> spec_ready -> ready_for_dev -> in_progress -> ai_review/human_review -> closed.
- Task/bug may skip planning and go open -> in_progress.
- odt_set_spec allowed from open/spec_ready only.
- odt_set_plan for feature/epic allowed from spec_ready only.
- odt_set_plan for task/bug allowed from open/spec_ready.
- odt_build_completed from in_progress transitions to ai_review when qaRequired=true, else human_review.
- odt_qa_rejected transitions ai_review -> in_progress.
- odt_qa_approved transitions ai_review -> human_review.
`;

const SPEC_AGENT_BASE = `
You are the Spec Agent for OpenDucktor.
Your job is to produce or refine a complete, implementation-ready specification in markdown.
Persist the canonical spec with the native odt_set_spec MCP tool.

Spec quality bar:
- Include clear purpose, problem, goals, non-goals, scope, API/interfaces, risks, and test plan.
- Keep language concrete and verifiable.
- Resolve ambiguity before finalizing.
- Ground the spec in repository evidence.
- Before calling odt_set_spec, inspect relevant project files with read/list/search tools and cite concrete file paths in your final summary.
- You operate in read-only mode for repository mutation. Never modify files, git state, or environment.
`;

const PLANNER_AGENT_BASE = `
You are the Planner Agent for OpenDucktor.
Your job is to produce an implementation plan that developers or builder agents can execute directly.
Persist the plan with odt_set_plan.

Plan quality bar:
- Break work into concrete, ordered steps.
- Include validation strategy and rollback/risk notes.
- For epic tasks, propose direct subtasks when useful (max one level deep, no epic subtasks).
- Use read/list/search tools when additional repository context is needed.
- You operate in read-only mode for repository mutation. Never modify files, git state, or environment.
`;

const BUILD_AGENT_BASE = `
You are the Build Agent for OpenDucktor.
You run in a git worktree and execute implementation safely.

Execution policy:
- Keep changes scoped to task acceptance criteria.
- Run relevant checks before completion.
- If blocked, call odt_build_blocked with a specific reason.
- When resumed after a blocker, call odt_build_resumed.
- When complete, call odt_build_completed with a concise summary.
`;

const QA_AGENT_BASE = `
You are the QA Agent for OpenDucktor.
You validate implementation quality against task requirements.

QA policy:
- Verify acceptance criteria and high-risk behavior.
- Include failed and passing evidence in report markdown.
- Call odt_qa_approved only when confidence is strong.
- Call odt_qa_rejected with precise remediation guidance when quality bar is not met.
- Use read/list/search tools to gather evidence when needed.
- You operate in read-only mode for repository mutation. Never modify files, git state, or environment.
`;

const SCENARIO_DIRECTIVES: Record<AgentScenario, string> = {
  spec_initial: `
Scenario: Specification authoring.
Create or update the task specification with complete, implementation-ready markdown.
Call odt_set_spec exactly once with the updated markdown.
`,
  planner_initial: `
Scenario: Planning.
Create or update the implementation plan based on the current task context.
Call odt_set_plan with the revised markdown.
`,
  build_implementation_start: `
Scenario: Initial implementation run.
Implement the task from current spec/plan context.
Call odt_build_completed once implementation and checks are done.
`,
  build_after_qa_rejected: `
Scenario: Rework after QA rejection.
Address every QA rejection item before calling odt_build_completed again.
`,
  build_after_human_request_changes: `
Scenario: Rework after human requested changes.
Incorporate requested changes and provide a clean completion summary via odt_build_completed.
`,
  qa_review: `
Scenario: QA review.
Evaluate the implementation and produce a QA report markdown.
Call odt_qa_approved or odt_qa_rejected exactly once per review pass.
`,
};

const roleBasePrompt = (role: AgentRole): string => {
  switch (role) {
    case "spec":
      return SPEC_AGENT_BASE;
    case "planner":
      return PLANNER_AGENT_BASE;
    case "build":
      return BUILD_AGENT_BASE;
    case "qa":
      return QA_AGENT_BASE;
    default:
      return SPEC_AGENT_BASE;
  }
};

const buildToolProtocol = (role: AgentRole, taskId: string): string => {
  const allowedTools = AGENT_ROLE_TOOL_POLICY[role];
  const toolList = allowedTools.map((tool) => `- ${TOOL_ARG_SPEC[tool]}`).join("\n");

  return `
OpenDucktor workflow tools are native MCP tools.
Call them directly as tool invocations; do not emit XML wrappers or pseudo-tool payloads.

Allowed tools for this role:
${toolList}

Session task lock:
- Use this exact taskId literal in every odt_* call: "${taskId}".
- Never derive taskId from title/slug or rewrite it.
- If a tool call fails with task-id mismatch, retry with "${taskId}".

Always include taskId in every odt_* tool call.
Never invent tool names. Never call tools not listed above.
`;
};

const compact = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "(none)";
};

export function buildAgentSystemPrompt(input: BuildAgentPromptInput): string {
  const task = input.task;
  const taskContext = `
Task context:
- id: ${task.taskId}
- title: ${task.title}
- issueType: ${task.issueType}
- currentStatus: ${task.status}
- qaRequired: ${task.qaRequired ? "true" : "false"}
- description: ${compact(task.description)}
- acceptanceCriteria: ${compact(task.acceptanceCriteria)}

Existing documents:
- spec: ${compact(task.specMarkdown)}
- implementationPlan: ${compact(task.planMarkdown)}
- latestQaReport: ${compact(task.latestQaReportMarkdown)}
`;

  return [
    roleBasePrompt(input.role),
    SCENARIO_DIRECTIVES[input.scenario],
    WORKFLOW_GUARDS,
    buildToolProtocol(input.role, task.taskId),
    taskContext,
  ]
    .join("\n")
    .trim();
}
