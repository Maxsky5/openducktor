import type { AgentPromptTemplateId } from "@openducktor/contracts";
import { agentPromptTemplateIdValues } from "@openducktor/contracts";
import { listBuiltinAgentPromptTemplates } from "@openducktor/core";
import { FolderGit2, type LucideIcon, MessageSquareText, SlidersHorizontal } from "lucide-react";

export type SettingsSectionId = "general" | "git" | "repositories" | "prompts";
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
  "system.scenario.build_rebase_conflict_resolution": "Builder Rebase Conflict Scenario",
  "system.scenario.qa_review": "QA Review Scenario",
  "kickoff.spec_initial": "Spec Kickoff",
  "kickoff.planner_initial": "Planner Kickoff",
  "kickoff.build_implementation_start": "Builder Kickoff",
  "kickoff.build_after_qa_rejected": "Builder Kickoff After QA Rejection",
  "kickoff.build_after_human_request_changes": "Builder Kickoff After Human Changes",
  "kickoff.qa_review": "QA Kickoff",
  "message.build_pull_request_draft": "Builder Pull Request Draft Message",
  "message.build_rebase_conflict_resolution": "Builder Rebase Conflict Message",
  "permission.read_only.reject": "Read-Only Permission Rejection",
};

export const PROMPT_TEMPLATE_DESCRIPTIONS: Record<AgentPromptTemplateId, string> = {
  "system.shared.workflow_guards":
    "Added to every system prompt to enforce global workflow guardrails and operating rules.",
  "system.shared.tool_protocol":
    "Added to every system prompt to define the required tool-calling protocol and response handling.",
  "system.shared.task_context":
    "Added to every system prompt to inject task/repository context and execution constraints.",
  "system.role.spec.base":
    "Base system instructions used for every Spec agent run, before scenario-specific additions.",
  "system.role.planner.base":
    "Base system instructions used for every Planner agent run, before scenario-specific additions.",
  "system.role.build.base":
    "Base system instructions used for every Builder agent run, before scenario-specific additions.",
  "system.role.qa.base":
    "Base system instructions used for every QA agent run, before scenario-specific additions.",
  "system.scenario.spec_initial":
    "Scenario-specific system instructions appended when starting an initial specification pass.",
  "system.scenario.planner_initial":
    "Scenario-specific system instructions appended when starting an initial planning pass.",
  "system.scenario.build_implementation_start":
    "Scenario-specific system instructions appended when Builder starts implementation from plan.",
  "system.scenario.build_after_qa_rejected":
    "Scenario-specific system instructions appended when Builder resumes after a QA rejection.",
  "system.scenario.build_after_human_request_changes":
    "Scenario-specific system instructions appended when Builder resumes after human-requested changes.",
  "system.scenario.build_rebase_conflict_resolution":
    "Scenario-specific system instructions appended when a fresh Builder session is started to resolve an in-progress rebase conflict.",
  "system.scenario.qa_review":
    "Scenario-specific system instructions appended when QA starts reviewing an implementation.",
  "kickoff.spec_initial": "Initial kickoff message sent when a Spec session is created.",
  "kickoff.planner_initial": "Initial kickoff message sent when a Planner session is created.",
  "kickoff.build_implementation_start":
    "Initial kickoff message sent when Builder starts implementation.",
  "kickoff.build_after_qa_rejected":
    "Initial kickoff message sent when Builder restarts after QA rejection.",
  "kickoff.build_after_human_request_changes":
    "Initial kickoff message sent when Builder restarts after human-requested changes.",
  "kickoff.qa_review": "Initial kickoff message sent when a QA review session is created.",
  "message.build_pull_request_draft":
    "Reusable in-session message sent to a forked Builder session to generate pull request title and body.",
  "message.build_rebase_conflict_resolution":
    "Reusable in-session message sent to Builder when a git rebase stops on conflicts.",
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
