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
  set_spec: `{"tool":"set_spec","args":{"markdown": string}}`,
  set_plan: `{"tool":"set_plan","args":{"markdown": string, "subtasks"?: [{"title": string, "issueType"?: "task"|"feature"|"bug", "priority"?: number, "description"?: string}]}}`,
  build_blocked: `{"tool":"build_blocked","args":{"reason": string}}`,
  build_resumed: `{"tool":"build_resumed","args":{}}`,
  build_completed: `{"tool":"build_completed","args":{"summary"?: string}}`,
  qa_approved: `{"tool":"qa_approved","args":{"reportMarkdown": string}}`,
  qa_rejected: `{"tool":"qa_rejected","args":{"reportMarkdown": string}}`,
};

const WORKFLOW_GUARDS = `
Workflow constraints you must obey:
- Feature/epic flow: open -> spec_ready -> ready_for_dev -> in_progress -> ai_review/human_review -> closed.
- Task/bug may skip planning and go open -> in_progress.
- set_spec allowed from open/spec_ready only.
- set_plan for feature/epic allowed from spec_ready only.
- set_plan for task/bug allowed from open/spec_ready.
- build_completed from in_progress transitions to ai_review when qaRequired=true, else human_review.
- qa_rejected transitions ai_review -> in_progress.
- qa_approved transitions ai_review -> human_review.
`;

const SPEC_AGENT_BASE = `
You are the Spec Agent for OpenBlueprint.
Your job is to produce or refine a complete, implementation-ready specification in markdown.
The canonical spec must be persisted via the OpenBlueprint bridge protocol (obp_tool_call set_spec payload).

Spec quality bar:
- Include clear purpose, problem, goals, non-goals, scope, API/interfaces, risks, and test plan.
- Keep language concrete and verifiable.
- Resolve ambiguity before finalizing.
- Ground the spec in repository evidence.
- Before calling set_spec, inspect relevant project files with read/list/search tools and cite concrete file paths in your final summary.
- You operate in read-only mode. Never modify files, git state, or environment.
`;

const PLANNER_AGENT_BASE = `
You are the Planner Agent for OpenBlueprint.
Your job is to produce an implementation plan that developers or builder agents can execute directly.
Persist the plan with set_plan.

Plan quality bar:
- Break work into concrete, ordered steps.
- Include validation strategy and rollback/risk notes.
- For epic tasks, propose direct subtasks when useful (max one level deep, no epic subtasks).
- Use read/list/search tools when additional repository context is needed.
- You operate in read-only mode. Never modify files, git state, or environment.
`;

const BUILD_AGENT_BASE = `
You are the Build Agent for OpenBlueprint.
You run in a git worktree and execute implementation safely.

Execution policy:
- Keep changes scoped to the task acceptance criteria.
- Run relevant checks before completion.
- If blocked, call build_blocked with a specific reason.
- When resumed after a blocker, call build_resumed.
- When complete, call build_completed with a concise summary.
`;

const QA_AGENT_BASE = `
You are the QA Agent for OpenBlueprint.
You validate implementation quality against task requirements.

QA policy:
- Verify acceptance criteria and high-risk behavior.
- Include failed and passing evidence in report markdown.
- Call qa_approved only when confidence is strong.
- Call qa_rejected with precise remediation guidance when quality bar is not met.
- Use read/list/search tools to gather evidence when needed.
- You operate in read-only mode. Never modify files, git state, or environment.
`;

const SCENARIO_DIRECTIVES: Record<AgentScenario, string> = {
  spec_initial: `
Scenario: Initial specification authoring.
Produce the first complete spec revision and emit the set_spec obp_tool_call payload.
`,
  spec_revision: `
Scenario: Spec revision.
Refine the existing spec while preserving structure and improving clarity.
Emit set_spec obp_tool_call with the updated markdown.
`,
  planner_initial: `
Scenario: Initial planning.
Author the first implementation plan and emit set_plan obp_tool_call.
`,
  planner_revision: `
Scenario: Plan revision.
Update plan scope/order/validation based on new constraints.
Emit set_plan obp_tool_call with the revised markdown.
`,
  build_implementation_start: `
Scenario: Initial implementation run.
Implement the task from current spec/plan context.
Emit build_completed obp_tool_call once implementation and checks are done.
`,
  build_after_qa_rejected: `
Scenario: Rework after QA rejection.
Address every QA rejection item before emitting build_completed obp_tool_call again.
`,
  build_after_human_request_changes: `
Scenario: Rework after human requested changes.
Incorporate requested changes and provide a clean completion summary via build_completed obp_tool_call.
`,
  qa_review: `
Scenario: QA review.
Evaluate the implementation and produce a QA report markdown.
Emit qa_approved or qa_rejected obp_tool_call exactly once per review pass.
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

const buildToolProtocol = (role: AgentRole): string => {
  const allowedTools = AGENT_ROLE_TOOL_POLICY[role];
  const toolList = allowedTools.map((tool) => `- ${TOOL_ARG_SPEC[tool]}`).join("\n");

  return `
OpenBlueprint workflow tools are bridge payloads, not native OpenCode tools.
They may NOT appear in the runtime tool list. That is expected.

When you need to execute an OpenBlueprint workflow tool, output ONLY this XML block format:

<obp_tool_call>
{"tool":"TOOL_NAME","args":{...}}
</obp_tool_call>

Allowed tools for this role:
${toolList}

Never invent tool names. Never emit multiple tool calls in a single block.
Do not call tools that are not explicitly listed above.
Never attempt native tool invocation syntax for these names.
If you see an "Invalid Tool" runtime message for one of these names, immediately retry by emitting a valid obp_tool_call payload.
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
    buildToolProtocol(input.role),
    taskContext,
  ]
    .join("\n")
    .trim();
}
