import type { AgentPromptTemplateId } from "@openducktor/contracts";
import { agentPromptTemplateIdValues } from "@openducktor/contracts";
import { listBuiltinAgentPromptTemplates } from "@openducktor/core";
import {
  Columns3,
  FolderGit2,
  type LucideIcon,
  MessageSquare,
  MessageSquareText,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";

export type SettingsSectionId =
  | "general"
  | "git"
  | "repositories"
  | "prompts"
  | "chat"
  | "kanban"
  | "autopilot";
export type RepositorySectionId = "configuration" | "git" | "agents" | "prompts";
export type PromptRoleTabId = "shared" | "spec" | "planner" | "build" | "qa";

type BuiltinPromptDefinition = ReturnType<typeof listBuiltinAgentPromptTemplates>[number];

export const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "git", label: "Git", icon: FolderGit2 },
  { id: "repositories", label: "Repositories", icon: FolderGit2 },
  { id: "prompts", label: "Prompts", icon: MessageSquareText },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "kanban", label: "Kanban", icon: Columns3 },
  { id: "autopilot", label: "Autopilot", icon: Workflow },
];

export const REPOSITORY_SECTIONS: ReadonlyArray<{
  id: RepositorySectionId;
  label: string;
}> = [
  { id: "configuration", label: "Configuration" },
  { id: "git", label: "Git" },
  { id: "agents", label: "Agents" },
  { id: "prompts", label: "Repo Prompts" },
];

export const PROMPT_ROLE_TABS: ReadonlyArray<{
  id: PromptRoleTabId;
  label: string;
}> = [
  { id: "shared", label: "Shared" },
  { id: "spec", label: "Spec" },
  { id: "planner", label: "Planner" },
  { id: "build", label: "Builder" },
  { id: "qa", label: "QA" },
];

export const PROMPT_TEMPLATE_LABELS: Record<AgentPromptTemplateId, string> = {
  "system.shared.workflow_guards": "Workflow Guards",
  "system.shared.tool_protocol": "Tool Protocol",
  "system.shared.task_context": "Task Context",
  "system.role.spec.base": "Spec Role Base",
  "system.role.planner.base": "Planner Role Base",
  "system.role.build.base": "Builder Role Base",
  "system.role.qa.base": "QA Role Base",
  "system.scenario.spec_initial": "Spec Scenario",
  "system.scenario.planner_initial": "Planner Scenario",
  "system.scenario.build_implementation_start": "Builder Start Scenario",
  "system.scenario.build_after_qa_rejected": "Builder After QA Rejection",
  "system.scenario.build_after_human_request_changes": "Builder After Human Changes",
  "system.scenario.build_pull_request_generation": "Builder Pull Request Generation",
  "system.scenario.build_rebase_conflict_resolution": "Builder Git Conflict Scenario",
  "system.scenario.qa_review": "QA Review Scenario",
  "kickoff.spec_initial": "Spec Kickoff",
  "kickoff.planner_initial": "Planner Kickoff",
  "kickoff.build_implementation_start": "Builder Kickoff",
  "kickoff.build_after_qa_rejected": "Builder Kickoff After QA Rejection",
  "kickoff.build_after_human_request_changes": "Builder Kickoff After Human Changes",
  "kickoff.build_pull_request_generation": "Builder Pull Request Generation Kickoff",
  "kickoff.qa_review": "QA Kickoff",
  "message.build_rebase_conflict_resolution": "Builder Git Conflict Message",
  "permission.read_only.reject": "Read-Only Permission Rejection",
};

export const PROMPT_TEMPLATE_DESCRIPTIONS: Record<AgentPromptTemplateId, string> = {
  "system.shared.workflow_guards":
    "Added to every system prompt to enforce lifecycle guardrails, artifact discipline, repo-guidance governance, and fail-fast rules.",
  "system.shared.tool_protocol":
    "Added to every system prompt to define the required tool-calling protocol, task lock, question discipline, and evidence hierarchy.",
  "system.shared.task_context":
    "Added to every system prompt to inject the task snapshot and require fetching canonical workflow artifacts through odt_read_task.",
  "system.role.spec.base":
    "Base system instructions used for every Spec run, focused on brownfield-first discovery, clarification discipline, and requirements-quality self-checks.",
  "system.role.planner.base":
    "Base system instructions used for every Planner run, focused on repo-fit execution planning, requirement traceability, dependency waves, and verification.",
  "system.role.build.base":
    "Base system instructions used for every Builder run, focused on plan-faithful execution, durable implementation, verification, and meaningful commits.",
  "system.role.qa.base":
    "Base system instructions used for every QA run, focused on principal-level evidence-based review, requirement coverage, and adversarial edge-case hunting.",
  "system.scenario.spec_initial":
    "Scenario-specific system instructions appended when starting a discovery-first specification pass with clarification control and requirements self-checking.",
  "system.scenario.planner_initial":
    "Scenario-specific system instructions appended when starting an implementation planning pass with requirement traceability and dependency sequencing.",
  "system.scenario.build_implementation_start":
    "Scenario-specific system instructions appended when Builder starts implementation from the approved spec and plan with dependency-order execution and blocker discipline.",
  "system.scenario.build_after_qa_rejected":
    "Scenario-specific system instructions appended when Builder resumes to address all QA findings at the root cause.",
  "system.scenario.build_after_human_request_changes":
    "Scenario-specific system instructions appended when Builder resumes to incorporate human-requested changes while preserving prior must-haves.",
  "system.scenario.build_pull_request_generation":
    "Scenario-specific system instructions appended when Builder forks from an implementation session to generate or update a pull request.",
  "system.scenario.build_rebase_conflict_resolution":
    "Scenario-specific system instructions appended when a fresh Builder session is started to resolve an in-progress git conflict.",
  "system.scenario.qa_review":
    "Scenario-specific system instructions appended when QA starts an evidence-based review with requirement mapping, adversarial review, and goal-backward verification.",
  "kickoff.spec_initial":
    "Initial kickoff message sent when a Spec session is created, reinforcing discovery, deferred-scope handling, and requirements-quality checks.",
  "kickoff.planner_initial":
    "Initial kickoff message sent when a Planner session is created, reinforcing requirement traceability, dependency waves, and execution-plan quality.",
  "kickoff.build_implementation_start":
    "Initial kickoff message sent when Builder starts implementation, reinforcing plan-faithful execution, blocker discipline, verification, and commit quality.",
  "kickoff.build_after_qa_rejected":
    "Initial kickoff message sent when Builder restarts after QA rejection, reinforcing root-cause fixes and renewed verification.",
  "kickoff.build_after_human_request_changes":
    "Initial kickoff message sent when Builder restarts after human-requested changes, reinforcing must-have preservation and renewed verification.",
  "kickoff.build_pull_request_generation":
    "Initial kickoff message sent when Builder forks to generate or update a pull request.",
  "kickoff.qa_review":
    "Initial kickoff message sent when a QA review session is created, reinforcing requirement mapping, adversarial review lenses, and the approval bar.",
  "message.build_rebase_conflict_resolution":
    "Reusable in-session message sent to Builder when a git operation stops on conflicts and must be resolved safely.",
  "permission.read_only.reject":
    "Template used to reject mutating tool requests from read-only roles (spec, planner, qa).",
};

export const BUILTIN_PROMPTS_BY_ID: Record<AgentPromptTemplateId, BuiltinPromptDefinition> =
  (() => {
    const map = {} as Record<AgentPromptTemplateId, BuiltinPromptDefinition>;
    for (const definition of listBuiltinAgentPromptTemplates()) {
      map[definition.id] = definition;
    }
    return map;
  })();

export const resolvePromptRoleTab = (templateId: AgentPromptTemplateId): PromptRoleTabId => {
  if (templateId.includes(".spec.") || templateId.includes("spec_")) {
    return "spec";
  }
  if (templateId.includes(".planner.") || templateId.includes("planner_")) {
    return "planner";
  }
  if (templateId.includes(".build.") || templateId.includes("build_")) {
    return "build";
  }
  if (templateId.includes(".qa.") || templateId.includes("qa_")) {
    return "qa";
  }
  return "shared";
};

export const PROMPT_IDS_BY_ROLE: Record<PromptRoleTabId, AgentPromptTemplateId[]> = {
  shared: [],
  spec: [],
  planner: [],
  build: [],
  qa: [],
};

for (const templateId of agentPromptTemplateIdValues) {
  PROMPT_IDS_BY_ROLE[resolvePromptRoleTab(templateId)].push(templateId);
}

export const countPromptErrorsByRoleTab = (
  errors: Partial<Record<AgentPromptTemplateId, string>>,
): Record<PromptRoleTabId, number> => {
  const counts: Record<PromptRoleTabId, number> = {
    shared: 0,
    spec: 0,
    planner: 0,
    build: 0,
    qa: 0,
  };

  for (const templateId of agentPromptTemplateIdValues) {
    if (!errors[templateId]) {
      continue;
    }
    counts[resolvePromptRoleTab(templateId)] += 1;
  }

  return counts;
};
