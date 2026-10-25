import {
  listBuiltinAgentPromptTemplates,
  resolveBuiltinPromptRoleTab,
  type BuiltinPromptRoleTabId,
  type BuiltinPromptTemplateId as AgentPromptTemplateId,
  BUILTIN_PROMPT_TEMPLATE_IDS,
} from "@openducktor/workflows";
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
  Radio,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";

export type SettingsSectionId =
  | "general"
  | "remote-access"
  | "git"
  | "runtimes"
  | "repositories"
  | "prompts"
  | "reusable-prompts"
  | "custom-agent-roles"
  | "appearance"
  | "chat"
  | "kanban"
  | "autopilot"
  | "notifications";
export type RepositorySectionId = "configuration" | "scripts" | "git" | "agents" | "prompts";
type BuiltinPromptDefinition = ReturnType<typeof listBuiltinAgentPromptTemplates>[number];

export const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "remote-access", label: "Remote control", icon: Radio },
  { id: "git", label: "Git", icon: FolderGit2 },
  { id: "runtimes", label: "Agent Runtimes", icon: Cpu },
  { id: "repositories", label: "Repositories", icon: FolderGit2 },
  { id: "prompts", label: "System Prompts", icon: MessageSquareText },
  { id: "reusable-prompts", label: "Reusable Prompts", icon: MessageSquarePlus },
  { id: "custom-agent-roles", label: "Custom Agent Roles", icon: MessageSquareText },
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

export const BUILTIN_PROMPTS_BY_ID: ReadonlyMap<AgentPromptTemplateId, BuiltinPromptDefinition> =
  new Map(
    listBuiltinAgentPromptTemplates().map((definition) => [definition.id, definition] as const),
  );

export const countPromptErrorsByRoleTab = (
  errors: Partial<Record<AgentPromptTemplateId, string>>,
) => {
  const counts = {
    shared: 0,
    spec: 0,
    planner: 0,
    build: 0,
    qa: 0,
  } satisfies Record<BuiltinPromptRoleTabId, number>;

  for (const templateId of BUILTIN_PROMPT_TEMPLATE_IDS) {
    if (!errors[templateId]) {
      continue;
    }
    counts[resolveBuiltinPromptRoleTab(templateId)] += 1;
  }

  return counts satisfies Record<BuiltinPromptRoleTabId, number>;
};
