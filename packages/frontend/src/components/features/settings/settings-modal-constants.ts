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

/** The title of System prompts, in the Settings menu and on its screen. */
export const SYSTEM_PROMPTS_TITLE = "System prompts";
/** The title of Repository prompts, in the repository menu and on its screen. */
export const REPOSITORY_PROMPTS_TITLE = "Repository prompts";

/** The text under the title of the page of a workflow. */
export const WORKFLOW_PROMPTS_DESCRIPTION =
  "The prompts that this workflow uses in its steps. A change applies to every task of this workflow.";

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
  { id: "prompts", label: SYSTEM_PROMPTS_TITLE, icon: MessageSquareText },
  { id: "reusable-prompts", label: "Reusable prompts", icon: MessageSquarePlus },
  { id: "custom-agent-roles", label: "Custom agent roles", icon: MessageSquareText },
  { id: "chat", label: "Sessions", icon: MessageSquare },
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
  { id: "prompts", label: REPOSITORY_PROMPTS_TITLE },
];
