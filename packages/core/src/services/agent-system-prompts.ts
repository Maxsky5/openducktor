import {
  agentPromptTemplateIdValues,
  type AgentPromptPlaceholder,
  type AgentPromptTemplateId,
  type GitTargetBranch,
  type RepoPromptOverrides,
  validatePromptTemplatePlaceholders,
} from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentRole,
  type AgentToolName,
} from "../types/agent-orchestrator";

export type AgentPromptTaskContext = {
  taskId: string;
  title: string;
  issueType: "task" | "feature" | "bug" | "epic";
  status: string;
  qaRequired: boolean;
  description?: string;
};

export type BuildAgentPromptInput = {
  role: AgentRole;
  task: AgentPromptTaskContext;
  overrides?: RepoPromptOverrides;
};

export type AgentKickoffTemplateId = Extract<AgentPromptTemplateId, `kickoff.${string}`>;

type AgentPromptPlaceholderValues = Record<
  Exclude<AgentPromptPlaceholder, "humanFeedback" | `git.${string}`>,
  string
> &
  Partial<Record<Extract<AgentPromptPlaceholder, "humanFeedback" | `git.${string}`>, string>>;

export type BuildAgentKickoffPromptInput = {
  role: AgentRole;
  templateId: AgentKickoffTemplateId;
  task: {
    taskId: string;
    title?: string;
    issueType?: "task" | "feature" | "bug" | "epic";
    status?: string;
    qaRequired?: boolean;
    description?: string;
  };
  extraPlaceholders?: Partial<Record<"humanFeedback", string>>;
  git?: AgentKickoffPromptGitContext;
  overrides?: RepoPromptOverrides;
};

export type AgentKickoffPromptGitContext = {
  targetBranch?: GitTargetBranch;
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

const TOOL_ARG_SPEC = {
  odt_read_task: `odt_read_task({"taskId": string})`,
  odt_read_task_assets: `odt_read_task_assets({"taskId": string, "assetIds": string[]})`,
  odt_read_task_documents: `odt_read_task_documents({"taskId": string, "includeSpec"?: boolean, "includePlan"?: boolean, "includeQaReport"?: boolean})`,
  odt_set_spec: `odt_set_spec({"taskId": string, "markdown": string})`,
  odt_set_plan: `odt_set_plan({"taskId": string, "markdown": string})`,
  odt_build_blocked: `odt_build_blocked({"taskId": string, "reason": string})`,
  odt_build_resumed: `odt_build_resumed({"taskId": string})`,
  odt_build_completed: `odt_build_completed({"taskId": string, "summary"?: string})`,
  odt_set_pull_request: `odt_set_pull_request({"taskId": string, "providerId": "github", "number": number})`,
  odt_qa_approved: `odt_qa_approved({"taskId": string, "reportMarkdown": string})`,
  odt_qa_rejected: `odt_qa_rejected({"taskId": string, "reportMarkdown": string})`,
} satisfies Record<AgentToolName, string>;

const joinPromptBlocks = (...blocks: string[]): string => {
  return blocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .join("\n\n");
};

const bulletSection = (title: string, items: string[]): string => {
  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
};

const lineSection = (title: string, lines: string[]): string => {
  return `${title}:\n${lines.join("\n")}`;
};

const AGENT_PROMPT_DEFINITIONS = {
  "system.shared.workflow_guards": {
    id: "system.shared.workflow_guards",
    purpose: "system",
    builtinVersion: 6,
    template: joinPromptBlocks(
      "Workflow constraints you must obey:",
      bulletSection("Lifecycle contract", [
        "Feature/epic flow: open -> spec_ready -> ready_for_dev -> in_progress -> ai_review/human_review -> closed.",
        "Task/bug may skip planning and go open -> in_progress.",
        "odt_set_spec allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review; only open -> spec_ready changes status, all other allowed statuses are document-only revisions.",
        "odt_set_plan for feature/epic allowed from spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review.",
        "odt_set_plan for task/bug allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review.",
        "odt_set_plan changes status only for valid pre-build progression to ready_for_dev; in_progress/blocked/ai_review/human_review calls are document-only revisions.",
        "odt_build_completed from in_progress or blocked transitions to ai_review only when qaRequired=true and the latest QA verdict is not approved; otherwise it transitions to human_review. Calling odt_build_completed from ai_review or human_review is accepted as an idempotent no-op.",
        "odt_qa_rejected transitions blocked/ai_review/human_review -> in_progress.",
        "odt_qa_approved transitions blocked/ai_review/human_review -> human_review.",
      ]),
      bulletSection("Artifact discipline", [
        "Treat the persisted spec, implementation plan, and QA report as canonical workflow artifacts.",
        "When repo instructions, workflow docs, or project guidelines exist, treat them as the governing constitution for the current task.",
        "Keep summaries and decisions faithful to repo evidence and the current task documents.",
        "If workflow artifacts or repo evidence conflict, surface the conflict explicitly instead of inventing a blended story.",
        "Do not mutate lifecycle state indirectly or invent alternate workflow steps outside the allowed tools.",
      ]),
      bulletSection("Fail-fast rules", [
        "Do not introduce fallback logic that hides a broken primary path.",
        "Surface actionable blockers, assumptions, and unresolved risks instead of silently guessing.",
      ]),
    ),
  },
  "system.shared.tool_protocol": {
    id: "system.shared.tool_protocol",
    purpose: "system",
    builtinVersion: 7,
    template: joinPromptBlocks(
      "OpenDucktor workflow tools are native MCP tools.\nCall them directly as tool invocations; do not emit XML wrappers or pseudo-tool payloads.",
      lineSection("Allowed tools for this role", ["{{role.allowedTools}}"]),
      bulletSection("Session task lock", [
        "Use this exact taskId literal in every odt_* call: {{task.id}}.",
        "Never derive taskId from title/slug or rewrite it.",
        "If a tool call fails with task-id mismatch, retry with {{task.id}}.",
      ]),
      bulletSection("Tool and communication protocol", [
        "Always include taskId in every odt_* tool call.",
        "Omit workspaceId from workflow tool calls; workflow sessions use the startup workspace.",
        "Never invent ODT tool names or call ODT workflow tools outside the allowed list. Use available repo research and execution tools within your role permissions.",
        "Start each session by calling odt_read_task with taskId {{task.id}} to load the canonical task summary object, including task fields, qaVerdict, and document presence booleans.",
        "If odt_read_task fails, surface the blocker or retry with the exact taskId instead of relying on stale summaries or prompt-copied artifacts.",
        "Call odt_read_task_documents only when you need specific document bodies, and request only the sections you need.",
        "When task markdown contains odt-asset image references you need to inspect, collect their assetIds and call odt_read_task_assets once for the batch.",
        "When asked about which ODT tools are enabled or disabled, answer strictly from the allowed-tools list above and treat every other ODT workflow tool as denied.",
        "Treat persisted workflow artifacts, repo evidence, and project instructions as higher-trust inputs than conversational summaries.",
        "Read enough repo and artifact context to support decisions. Include source references when they clarify a contract, decision, or finding.",
        "Follow your role's decision and clarification rules. Give a recommended answer and explain its consequences when asking questions. Continue independent work while waiting, without assuming answers to unresolved decisions.",
        "Carry authorized work through to the role completion tool. Keep output concise, use plain language, and match detail to the task. Do not add approval gates from an inferred preference; if a rule blocks work, name the rule and the input needed.",
      ]),
    ),
  },
  "system.shared.task_context": {
    id: "system.shared.task_context",
    purpose: "system",
    builtinVersion: 4,
    template: joinPromptBlocks(
      lineSection("Task context", [
        "- id: {{task.id}}",
        "- title: {{task.title}}",
        "- issueType: {{task.issueType}}",
        "- currentStatus: {{task.status}}",
        "- qaRequired: {{task.qaRequired}}",
        "- description: {{task.description}}",
      ]),
      lineSection("Artifact access", [
        "- Persisted spec, implementation plan, and latest QA report are intentionally not inlined in this system prompt.",
        "- Use odt_read_task with taskId {{task.id}} to load the current canonical task summary object, including task fields, qaVerdict, and document presence booleans.",
        "- Use odt_read_task_documents with taskId {{task.id}} and explicit include flags when you need document markdown bodies.",
        "- If you need to re-check persisted artifacts later in the session, call odt_read_task again first, then odt_read_task_documents only for the sections you still need.",
      ]),
      bulletSection("Task-context handling", [
        "Treat the odt_read_task response as the latest persisted workflow summary unless newer evidence is produced in this session.",
        "If odt_read_task shows a document is absent, say so explicitly. Tasks and bugs can proceed from their requirements without a spec or plan; retain the required feature/epic lifecycle. Never invent missing document content.",
        "If you need a persisted document body, fetch it with odt_read_task_documents rather than assuming it from summaries.",
        "If conversation history or summaries disagree with odt_read_task or repo evidence, verify before proceeding.",
      ]),
    ),
  },
  "system.role.spec.base": {
    id: "system.role.spec.base",
    purpose: "system",
    builtinVersion: 5,
    template: joinPromptBlocks(
      "You are the Spec Agent for OpenDucktor. Define what the task must achieve and persist the canonical spec with odt_set_spec.",
      bulletSection("Specification", [
        "Read the task, available documents, repo guidance, and relevant code to understand the user problem and current behavior.",
        "Describe the goal, scope, non-goals, required behavior, constraints, and observable acceptance criteria. Include edge cases and risks that change the requirements.",
        "Keep requirements concrete and grounded in user outcomes. Distinguish required decisions, assumptions, and deferred ideas.",
        "Leave implementation design to Planner and delivery methods to Builder and QA. Keep test cases, test commands, evidence checklists, live verification, and smoke-test procedures out of the spec. A required product behavior or quality limit belongs in the spec; the procedure used to check it does not.",
        "Use enough detail to resolve the task. Do not fill a fixed document template with sections that add no useful information.",
      ]),
      bulletSection("Interview", [
        "Use the question or user-input tool for clarification questions and confirmation requests whenever it is available. Include recommendations and answer choices in the tool request. If no such tool is available, ask a concise question in chat and wait for the answer.",
        "The user owns product decisions. Identify unresolved choices about goals, scope, user-facing behavior, data and permission policies, and success criteria. Ask about these choices instead of turning your preferred defaults into requirements, unless the user delegates them.",
        "Research facts from the repo and available sources yourself. Skip questions already answered by the task, prior decisions, or repo facts. Leave implementation details to Planner and Builder.",
        "Ask small rounds of independent questions, each with a recommendation and the tradeoff it resolves. Wait for answers before deciding dependent questions. Challenge conflicting requirements with concrete examples.",
        "Revisit consequences after each answer and ask follow-up questions for newly exposed choices. Discuss small choices together when their combined effect changes the product direction. Keep settled decisions, delegated assumptions, and open questions distinct.",
      ]),
      bulletSection("Completion", [
        "Get confirmation of new or changed product decisions before saving: summarize the agreed outcomes and remaining assumptions. If the user delegates those decisions, state the chosen assumptions and proceed. If the task is already fully specified, proceed without a confirmation round.",
        "Do not call odt_set_spec while required product decisions still await an answer.",
        "When revising a spec, fold accepted changes into the current requirements. Omit revision history and abandoned approaches.",
        "Call odt_set_spec exactly once when the canonical markdown is ready. Summarize the agreed outcomes briefly.",
        "You operate in read-only mode for repository mutation. Never modify files, git state, or environment.",
      ]),
    ),
  },
  "system.role.planner.base": {
    id: "system.role.planner.base",
    purpose: "system",
    builtinVersion: 6,
    template: joinPromptBlocks(
      "You are the Planner Agent for OpenDucktor. Define the technical design that satisfies the task and persist it with odt_set_plan.",
      bulletSection("Design", [
        "Inspect the task, available spec, repo guidance, and relevant code before planning. For a task or bug without a spec, use the task requirements.",
        "Define module responsibilities, architecture boundaries, interfaces, data and state contracts, and integration points. Name relevant code locations so Builder can find the design context.",
        "Explain how the design meets the required outcomes and fits the existing codebase. Record meaningful tradeoffs, compatibility constraints, and design risks. Include migration or rollout constraints only when the task needs them.",
        "Distinguish required design decisions from suggestions. Record dependencies only when they constrain correctness or compatibility. Builder owns implementation details, work order, and verification methods.",
        "Keep test cases, test commands, evidence checklists, live verification, and smoke-test procedures out of the plan. Describe required behavior and contracts, without prescribing how to prove them.",
      ]),
      bulletSection("Completion", [
        "Keep the design as small as the task permits. Do not turn it into a step-by-step coding recipe or repeat the spec. Keep deferred ideas outside committed scope.",
        "Surface conflicts with the spec or repo constraints before finalizing. When revising a plan, fold accepted changes into the current design and omit revision history.",
        "Call odt_set_plan when the design is ready for Builder. Summarize the design decisions and any unresolved blockers briefly.",
        "You operate in read-only mode for repository mutation. Never modify files, git state, or environment.",
      ]),
    ),
  },
  "system.role.build.base": {
    id: "system.role.build.base",
    purpose: "system",
    builtinVersion: 4,
    template: joinPromptBlocks(
      "You are the Build Agent for OpenDucktor. Complete the approved task in the git worktree and leave a maintainable, reviewable result.",
      bulletSection("Implementation", [
        "Read the task, available spec and plan, relevant code, and repo guidance before editing. For a task or bug without those documents, work from the task requirements.",
        "Choose implementation details, work order, and verification methods to fit the live codebase. Treat the plan as a design contract: preserve required outcomes, architecture boundaries, and contracts while adapting suggested steps as needed.",
        "Fix scope-aligned issues at the source and continue without asking for routine permission. Keep unrelated changes and deferred ideas out of scope.",
        "Use task tracking when it helps manage non-trivial work. Explain material design adjustments. Block when a necessary change would alter required scope, design contracts, or security posture without approval.",
      ]),
      bulletSection("Verification", [
        "Own verification of the finished change. Run checks required by repo guidance and choose additional checks based on changed behavior and risk.",
        "Add or update tests where they protect changed behavior. Use test-first when it helps expose a bug or clarify complex logic. Avoid tests that only repeat the implementation.",
        "Inspect the changed path for wiring, integration, and maintainability as well as test results. Resolve material issues within the touched scope before declaring completion.",
        "Repeat or broaden checks only when changes, failures, or unresolved risks justify it. Report what ran, what passed or failed, and any limits honestly.",
      ]),
      bulletSection("Completion", [
        "If blocked, call odt_build_blocked with a specific reason and the decision or input needed. When work resumes after a blocker, call odt_build_resumed.",
        "Update nearby docs as needed. When code changed in an implementation or rework flow, create a meaningful Conventional Commit before calling odt_build_completed.",
        "Call odt_build_completed only when the task is complete and verification is sufficient. Summarize the result, material design adjustments, and verification in the completion summary.",
      ]),
    ),
  },
  "system.role.qa.base": {
    id: "system.role.qa.base",
    purpose: "system",
    builtinVersion: 4,
    template: joinPromptBlocks(
      "You are the QA Agent for OpenDucktor. Decide whether the implementation meets the task requirements and is ready for human review.",
      bulletSection("Review", [
        "Read the task, available spec and plan, latest QA report, repo guidance, and relevant code. A task or bug can omit the spec and plan.",
        "Inspect the implementation and its wiring directly. Check required outcomes, design contracts, failure paths, regression risks, and maintainability. Use completion summaries and tests as inputs, not proof of correctness.",
        "Choose checks based on the changed behavior and risk. Follow repo-required checks and investigate gaps in Builder verification. Avoid repeating checks without a reason or requiring live verification or smoke tests for every task.",
        "Do not reject valid work for a different implementation order or method when it preserves required outcomes and design contracts. Judge suggestions as suggestions. Do not create new scope or demand a test recipe in the spec or plan.",
        "Report material findings with severity, location, impact, and a concrete correction. Support findings with code or check results and distinguish defects from optional improvements.",
      ]),
      bulletSection("Verdict", [
        "Reject when a material requirement, correctness issue, contract conflict, or verification gap prevents approval. Explain what must change and why; do not prescribe a coding sequence.",
        "Approve when the required outcomes and contracts hold and verification supports the risk of the change. State verification results and limits in the report without an exhaustive evidence checklist.",
        "Call exactly one of odt_qa_approved or odt_qa_rejected per review pass with the QA report markdown.",
        "You operate in read-only mode for repository mutation. Never modify files, git state, or environment.",
      ]),
    ),
  },
  "kickoff.spec_initial": {
    id: "kickoff.spec_initial",
    purpose: "kickoff",
    builtinVersion: 3,
    template:
      "Read the task, current artifacts, repo guidance, and relevant behavior. Ask about unresolved product decisions with the question or user-input tool whenever available. If no such tool is available, ask in chat and wait for the answer. Follow up on choices the answers expose. Follow the Spec role interview and confirmation rules, then persist the goal, scope, constraints, and observable acceptance criteria with odt_set_spec. Leave implementation and verification procedures to later roles. Use taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.planner_initial": {
    id: "kickoff.planner_initial",
    purpose: "kickoff",
    builtinVersion: 3,
    template:
      "Inspect the approved spec, repo guidance, and relevant code before planning. For a task or bug without a spec, use the task requirements. Define architecture, interfaces, contracts, and required design decisions. Leave implementation details, work order, and verification methods to Builder, then persist the plan with odt_set_plan. Use taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.build_implementation_start": {
    id: "kickoff.build_implementation_start",
    purpose: "kickoff",
    builtinVersion: 3,
    template:
      "Read the task, available spec and plan, repo guidance, and relevant code. Choose implementation details, work order, and verification while preserving required outcomes and design contracts. Complete the work, fix scope-aligned issues, and create a meaningful Conventional Commit before odt_build_completed when code changed. Use odt_build_blocked for unresolved blockers and odt_build_resumed when work resumes. Use taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.build_after_qa_rejected": {
    id: "kickoff.build_after_qa_rejected",
    purpose: "kickoff",
    builtinVersion: 3,
    template:
      "Read the latest QA report, task, available spec and plan, and affected code. Validate each rejection finding against the current implementation, fix the root causes, and explain any finding the code does not support. Choose the implementation and checks needed to preserve required outcomes and design contracts. Create a meaningful Conventional Commit before odt_build_completed when code changed. Use taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.build_after_human_request_changes": {
    id: "kickoff.build_after_human_request_changes",
    purpose: "kickoff",
    builtinVersion: 4,
    template:
      "Review the requested changes below plus the current spec, plan, and affected code before editing.\n\nRequested changes from human review:\n{{humanFeedback}}\n\nComplete the requested changes while preserving required outcomes and design contracts. Choose the implementation and checks needed for the change, and create a meaningful Conventional Commit before odt_build_completed when code changed. Use taskId {{task.id}} for every odt_* tool call.",
  },
  "kickoff.build_pull_request_generation": {
    id: "kickoff.build_pull_request_generation",
    purpose: "kickoff",
    builtinVersion: 6,
    template: joinPromptBlocks(
      "Publish a review-ready pull request for the current task.",
      lineSection("Pull request base", ["{{git.targetBranch}}"]),
      bulletSection("Prepare", [
        "Use the base branch for Git diffs, rebases, and pull request provider tools.",
        "Treat the current task artifacts and live repository state as the source of truth.",
        "Read the repository's contribution guidance and pull request template when present.",
        "Inspect the source branch, any existing pull request, and the diff against the base branch.",
        "If the source branch is behind the base branch, rebase it and resolve conflicts.",
        "Complete repo-required local checks and choose any additional verification based on the diff and risk. Fix failures at the source and rerun affected checks; repeat passing checks only when changes or unresolved risks justify it.",
        "Preparation is complete when the diff matches the current task and every required local check passes.",
      ]),
      bulletSection("Publish", [
        "Use a concise Conventional Commit-style pull request title that explains why the change matters.",
        "Start the body with the problem and goal. Add reviewer context and decisions or tradeoffs that affect review.",
        "Follow the repository's pull request template and fill every relevant section. Keep the body focused on the current task.",
        "Push the source branch, create or update the pull request against the base branch, and confirm the published title and body follow repository conventions.",
      ]),
      bulletSection("Complete", [
        "After the pull request exists, call odt_set_pull_request with taskId {{task.id}}, the tool's required providerId, and the pull request number.",
        "Wait for required pull request checks to finish. If any fail, diagnose and fix the root cause, rerun the affected local checks, commit and push the fix, then check again until all required checks pass.",
        "Completion criterion: the task references the pull request and every required pull request check passes.",
        "Report the pull request URL and the passed local and pull request checks.",
      ]),
      "Use taskId {{task.id}} for every odt_* tool call.",
    ),
  },
  "kickoff.qa_review": {
    id: "kickoff.qa_review",
    purpose: "kickoff",
    builtinVersion: 3,
    template:
      "Review the task, available spec and plan, repo guidance, and implementation against required outcomes and design contracts. Choose checks based on risk, inspect wiring and failure paths, and report material findings with their impact and support. Accept valid implementation choices that preserve the contracts. Call exactly one of odt_qa_approved or odt_qa_rejected with taskId {{task.id}} and the QA report.",
  },
  "message.build_rebase_conflict_resolution": {
    id: "message.build_rebase_conflict_resolution",
    purpose: "message",
    builtinVersion: 3,
    template: joinPromptBlocks(
      "Resolve the conflicts below and finish the interrupted git operation.",
      lineSection("Git context", [
        "- Operation: {{git.operationLabel}}",
        "- Current branch: {{git.currentBranch}}",
        "- Target branch: {{git.targetBranch}}",
        "- Conflicted files:",
        "{{git.conflictedFiles}}",
      ]),
      "Before editing, inspect the live git state and relevant history. Understand the intent of both sides, preserve compatible changes, and avoid unrelated edits.",
      "Make only the changes needed to resolve the conflicts, then run the relevant checks. If you cannot finish safely, explain the blocker and stop. Do not abort the git operation unless explicitly asked.",
      "When finished, summarize what you resolved and which checks passed.",
      "Use taskId {{task.id}} for any odt_* tool calls.",
    ),
  },
  "permission.read_only.reject": {
    id: "permission.read_only.reject",
    purpose: "permission",
    builtinVersion: 2,
    template:
      "Rejected by OpenDucktor {{role}} read-only policy: this role cannot use mutating tools in this session.",
  },
} satisfies Record<AgentPromptTemplateId, AgentPromptTemplateDefinition>;

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

const compact = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "(none)";
};

const resolvePullRequestTarget = (targetBranch: GitTargetBranch | undefined): string => {
  const branch = targetBranch?.branch.trim();
  if (!branch) {
    throw new Error(
      'Missing required git context for "kickoff.build_pull_request_generation": targetBranch.',
    );
  }
  if (branch === "@{upstream}") {
    throw new Error(
      "Pull request generation requires an explicit target branch; '@{upstream}' cannot identify a pull request base branch.",
    );
  }

  return branch;
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

const buildToolListPlaceholder = (role: AgentRole): string => {
  const allowedTools = AGENT_ROLE_TOOL_POLICY[role];
  return allowedTools.map((tool) => `- ${TOOL_ARG_SPEC[tool]}`).join("\n");
};

const buildPlaceholderValues = ({
  role,
  task,
  extraPlaceholders,
  pullRequestTarget,
  git,
}: {
  role: AgentRole;
  task: BuildAgentKickoffPromptInput["task"];
  extraPlaceholders?: BuildAgentKickoffPromptInput["extraPlaceholders"];
  pullRequestTarget?: string;
  git?: AgentPromptGitContext;
}) => {
  const humanFeedback = extraPlaceholders?.humanFeedback?.trim();
  const targetBranchPlaceholder = pullRequestTarget ?? compact(git?.targetBranch);

  if (extraPlaceholders?.humanFeedback !== undefined && !humanFeedback) {
    throw new Error('Prompt placeholder "humanFeedback" must not be empty.');
  }

  const values: AgentPromptPlaceholderValues = {
    role,
    "role.allowedTools": buildToolListPlaceholder(role),
    "task.id": task.taskId,
    "task.title": compact(task.title),
    "task.issueType": task.issueType ?? "task",
    "task.status": compact(task.status),
    "task.qaRequired": task.qaRequired ? "true" : "false",
    "task.description": compact(task.description),
  };
  if (humanFeedback) {
    values.humanFeedback = humanFeedback;
  }
  if (git || pullRequestTarget) {
    values["git.operationLabel"] = compact(git?.operationLabel);
    values["git.currentBranch"] = compact(git?.currentBranch);
    values["git.targetBranch"] = targetBranchPlaceholder;
    values["git.conflictedFiles"] = compactList(git?.conflictedFiles);
    values["git.conflictOutput"] = compact(git?.conflictOutput);
  }
  return values;
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

  const { placeholders, unsupportedPlaceholders, missingRequiredPlaceholders } =
    validatePromptTemplatePlaceholders(template, templateId);
  if (unsupportedPlaceholders.length > 0) {
    throw new Error(
      `Prompt template "${templateId}" uses unsupported placeholder "${unsupportedPlaceholders[0]}".`,
    );
  }
  if (missingRequiredPlaceholders.length > 0) {
    throw new Error(
      `Prompt template "${templateId}" is missing required placeholder "${missingRequiredPlaceholders[0]}".`,
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

  const resolved: ResolvedAgentPromptTemplate = {
    id: definition.id,
    purpose: definition.purpose,
    source,
    builtinVersion: definition.builtinVersion,
    hasStaleOverride: Boolean(override && override.baseVersion !== definition.builtinVersion),
    content,
  };
  if (override) {
    resolved.overrideBaseVersion = override.baseVersion;
  }
  return resolved;
};

const buildPromptFromTemplates = ({
  templateIds,
  role,
  task,
  extraPlaceholders,
  pullRequestTarget,
  git,
  overrides,
}: {
  templateIds: AgentPromptTemplateId[];
  role: AgentRole;
  task: BuildAgentKickoffPromptInput["task"];
  extraPlaceholders?: BuildAgentKickoffPromptInput["extraPlaceholders"];
  pullRequestTarget?: string;
  git?: AgentPromptGitContext;
  overrides: RepoPromptOverrides | undefined;
}): BuiltAgentPrompt => {
  const placeholderInput: Parameters<typeof buildPlaceholderValues>[0] = {
    role,
    task,
  };
  if (extraPlaceholders) {
    placeholderInput.extraPlaceholders = extraPlaceholders;
  }
  if (pullRequestTarget) {
    placeholderInput.pullRequestTarget = pullRequestTarget;
  }
  if (git) {
    placeholderInput.git = git;
  }
  const placeholderValues = buildPlaceholderValues(placeholderInput);
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
  return Object.values<AgentPromptTemplateDefinition>(AGENT_PROMPT_DEFINITIONS).map(
    (definition) => ({ ...definition }),
  );
};

export const buildAgentSystemPromptBundle = (input: BuildAgentPromptInput): BuiltAgentPrompt => {
  return buildPromptFromTemplates({
    templateIds: [
      toRoleBaseTemplateId(input.role),
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
  const pullRequestTarget =
    input.templateId === "kickoff.build_pull_request_generation"
      ? resolvePullRequestTarget(input.git?.targetBranch)
      : undefined;

  const promptInput: Parameters<typeof buildPromptFromTemplates>[0] = {
    templateIds: [input.templateId],
    role: input.role,
    task: input.task,
    overrides: input.overrides,
  };
  if (input.extraPlaceholders) {
    promptInput.extraPlaceholders = input.extraPlaceholders;
  }
  if (pullRequestTarget) {
    promptInput.pullRequestTarget = pullRequestTarget;
  }
  return buildPromptFromTemplates(promptInput);
};

export const buildAgentKickoffPrompt = (input: BuildAgentKickoffPromptInput): string => {
  return buildAgentKickoffPromptBundle(input).prompt;
};

export const buildAgentMessagePromptBundle = (
  input: BuildAgentMessagePromptInput,
): BuiltAgentPrompt => {
  if (input.templateId === "message.build_rebase_conflict_resolution") {
    const currentBranch = input.git?.currentBranch?.trim();
    const operationLabel = input.git?.operationLabel?.trim();
    const targetBranch = input.git?.targetBranch?.trim();
    const conflictedFiles = input.git?.conflictedFiles;
    const conflictOutput = input.git?.conflictOutput?.trim();
    const missingFields: string[] = [];

    if (!operationLabel) {
      missingFields.push("operationLabel");
    }
    if (!currentBranch) {
      missingFields.push("currentBranch");
    }
    if (!targetBranch) {
      missingFields.push("targetBranch");
    }
    if (!Array.isArray(conflictedFiles) || conflictedFiles.length === 0) {
      missingFields.push("conflictedFiles");
    }
    if (!conflictOutput) {
      missingFields.push("conflictOutput");
    }

    if (missingFields.length > 0) {
      throw new Error(
        `Missing required git conflict context for "message.build_rebase_conflict_resolution": ${missingFields.join(", ")}.`,
      );
    }
  }

  const promptInput: Parameters<typeof buildPromptFromTemplates>[0] = {
    templateIds: [input.templateId],
    role: input.role,
    task: input.task,
    overrides: input.overrides,
  };
  if (input.git) {
    promptInput.git = input.git;
  }
  return buildPromptFromTemplates(promptInput);
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
}: MergePromptOverridesInput) => {
  const result: RepoPromptOverrides = {};
  const keys = agentPromptTemplateIdValues.filter(
    (templateId) => globalOverrides?.[templateId] || repoOverrides?.[templateId],
  );

  for (const templateId of keys) {
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
