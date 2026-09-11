import type { AgentPromptTemplateId } from "@openducktor/contracts";
import { agentPromptTemplateIdValues } from "@openducktor/contracts";
import { listBuiltinAgentPromptTemplates } from "@openducktor/core";
import {
  Bell,
  Columns3,
  Cpu,
  FolderGit2,
  type LucideIcon,
  MessageSquare,
  MessageSquarePlus,
  MessageSquareText,
  Palette,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";

export type SettingsSectionId =
  | "general"
  | "git"
  | "runtimes"
  | "repositories"
  | "prompts"
  | "reusable-prompts"
  | "appearance"
  | "chat"
  | "kanban"
  | "autopilot"
  | "notifications";
export type RepositorySectionId = "configuration" | "scripts" | "git" | "agents" | "prompts";
export type PromptRoleTabId = "shared" | "spec" | "planner" | "build" | "qa";

type BuiltinPromptDefinition = ReturnType<typeof listBuiltinAgentPromptTemplates>[number];

export const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "git", label: "Git", icon: FolderGit2 },
  { id: "runtimes", label: "Agent Runtimes", icon: Cpu },
  { id: "repositories", label: "Repositories", icon: FolderGit2 },
  { id: "prompts", label: "System Prompts", icon: MessageSquareText },
  { id: "reusable-prompts", label: "Reusable Prompts", icon: MessageSquarePlus },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "kanban", label: "Kanban", icon: Columns3 },
  { id: "autopilot", label: "Autopilot", icon: Workflow },
];

export const REPOSITORY_SECTIONS: ReadonlyArray<{
  id: RepositorySectionId;
  label: string;
}> = [
  { id: "configuration", label: "Configuration" },
  { id: "scripts", label: "Scripts" },
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

export const PROMPT_TEMPLATE_LABELS = {
  "system.shared.workflow_guards": "Workflow Guards",
  "system.shared.tool_protocol": "Tool Protocol",
  "system.shared.task_context": "Task Context",
  "system.role.spec.base": "Spec Role Base",
  "system.role.planner.base": "Planner Role Base",
  "system.role.build.base": "Builder Role Base",
  "system.role.qa.base": "QA Role Base",
  "kickoff.spec_initial": "Spec Kickoff",
  "kickoff.planner_initial": "Planner Kickoff",
  "kickoff.build_implementation_start": "Builder Kickoff",
  "kickoff.build_after_qa_rejected": "Builder Kickoff After QA Rejection",
  "kickoff.build_after_human_request_changes": "Builder Kickoff After Human Changes",
  "kickoff.build_pull_request_generation": "Builder Pull Request Generation Kickoff",
  "kickoff.qa_review": "QA Kickoff",
  "message.build_rebase_conflict_resolution": "Builder Git Conflict Message",
  "permission.read_only.reject": "Read-Only Permission Rejection",
} satisfies Record<AgentPromptTemplateId, string>;

export const PROMPT_TEMPLATE_DESCRIPTIONS = {
  "system.shared.workflow_guards":
    "Shared lifecycle rules, canonical task documents, and repo guidance.",
  "system.shared.tool_protocol":
    "Shared ODT tool permissions, task lock, artifact reads, and clarification rules.",
  "system.shared.task_context": "Task snapshot and access rules for current workflow documents.",
  "system.role.spec.base":
    "Resolves product decisions with the user and defines scope, required behavior, and constraints.",
  "system.role.planner.base":
    "Defines architecture, module responsibilities, interfaces, and contracts. Leaves implementation order and verification to Builder.",
  "system.role.build.base":
    "Completes the approved outcomes and design contracts with control over implementation, work order, and verification.",
  "system.role.qa.base":
    "Reviews required outcomes, design contracts, correctness, and maintainability with checks based on risk.",
  "kickoff.spec_initial":
    "Requests a saved specification. Asks questions only for unresolved product decisions.",
  "kickoff.planner_initial": "Requests a saved implementation plan.",
  "kickoff.build_implementation_start":
    "Starts implementation with control over work order and checks within the approved design.",
  "kickoff.build_after_qa_rejected":
    "Starts review of QA findings, root-cause fixes, and checks for the affected behavior.",
  "kickoff.build_after_human_request_changes":
    "Starts work on the requested changes while preserving required outcomes and design contracts.",
  "kickoff.build_pull_request_generation":
    "Starts pull request creation or updates with required checks and task association.",
  "kickoff.qa_review": "Starts review of required outcomes, contracts, and material risks.",
  "message.build_rebase_conflict_resolution":
    "Reusable in-session message sent to Builder when a git operation stops on conflicts and must be resolved safely.",
  "permission.read_only.reject":
    "Template used to reject mutating tool requests from read-only roles (spec, planner, qa).",
} satisfies Record<AgentPromptTemplateId, string>;

export const BUILTIN_PROMPTS_BY_ID: ReadonlyMap<AgentPromptTemplateId, BuiltinPromptDefinition> =
  new Map(
    listBuiltinAgentPromptTemplates().map((definition) => [definition.id, definition] as const),
  );

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

export const PROMPT_IDS_BY_ROLE = {
  shared: new Array<AgentPromptTemplateId>(),
  spec: new Array<AgentPromptTemplateId>(),
  planner: new Array<AgentPromptTemplateId>(),
  build: new Array<AgentPromptTemplateId>(),
  qa: new Array<AgentPromptTemplateId>(),
} satisfies Record<PromptRoleTabId, AgentPromptTemplateId[]>;

for (const templateId of agentPromptTemplateIdValues) {
  PROMPT_IDS_BY_ROLE[resolvePromptRoleTab(templateId)].push(templateId);
}

export const countPromptErrorsByRoleTab = (
  errors: Partial<Record<AgentPromptTemplateId, string>>,
) => {
  const counts = {
    shared: 0,
    spec: 0,
    planner: 0,
    build: 0,
    qa: 0,
  } satisfies Record<PromptRoleTabId, number>;

  for (const templateId of agentPromptTemplateIdValues) {
    if (!errors[templateId]) {
      continue;
    }
    counts[resolvePromptRoleTab(templateId)] += 1;
  }

  return counts satisfies Record<PromptRoleTabId, number>;
};
