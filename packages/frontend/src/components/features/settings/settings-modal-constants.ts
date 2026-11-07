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

export const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "remote-access", label: "Remote control", icon: Radio },
  { id: "git", label: "Git", icon: FolderGit2 },
  { id: "runtimes", label: "Agent runtimes", icon: Cpu },
  { id: "repositories", label: "Repositories", icon: FolderGit2 },
  { id: "prompts", label: "System prompts", icon: MessageSquareText },
  { id: "reusable-prompts", label: "Reusable prompts", icon: MessageSquarePlus },
  { id: "custom-agent-roles", label: "Custom agent roles", icon: MessageSquareText },
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
  { id: "prompts", label: "Repository prompts" },
];

export const countPromptErrorsByRoleTab = (
  errors: Partial<Record<string, string>>,
  tabs: readonly { id: string; templates: readonly { key: string }[] }[],
): Record<string, number> =>
  Object.fromEntries(
    tabs.map((tab) => [tab.id, tab.templates.filter(({ key }) => errors[key]).length]),
  );
