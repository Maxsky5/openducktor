import type { AgentRole } from "@openducktor/core";
import type { ComboboxGroup } from "@/components/ui/combobox";
import type { SessionLaunchActionId, SessionStartPostAction } from "@/features/session-start";
import type { AgentWorkflowStepState } from "@/types/agent-workflow";
import type { AgentRoleOption } from "./agent-chat/agent-chat.types";

export type AgentWorkflowStep = {
  role: AgentRole;
  label: string;
  icon: AgentRoleOption["icon"];
  state: AgentWorkflowStepState;
  sessionValue: string | null;
};

export type AgentStudioSessionSelectorModel = {
  value: string;
  groups: ComboboxGroup[];
  disabled: boolean;
  onValueChange: (value: string) => void;
  shouldAutofocusComposerForValue: (value: string) => boolean;
};

export type AgentSessionCreateOption = {
  id: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  label: string;
  description: string;
  disabled: boolean;
  disabledReason?: string;
};

export type AgentStudioQuickActionOption = {
  id: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  label: string;
  description: string;
  postStartAction: SessionStartPostAction;
  disabled: boolean;
  disabledReason?: string;
};

export type AgentStudioHeaderModel = {
  taskTitle: string | null;
  taskId: string | null;
  onOpenTaskDetails: (() => void) | null;
  sessionStatus: "starting" | "running" | "idle" | "error" | "stopped" | null;
  selectedRole: AgentRole | null;
  workflowSteps: AgentWorkflowStep[];
  onWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  sessionSelector: AgentStudioSessionSelectorModel;
  sessionCreateOptions: AgentSessionCreateOption[];
  onPrepareMessageFirstSession: (option: AgentSessionCreateOption) => void;
  quickActions: AgentStudioQuickActionOption[];
  primaryQuickAction: AgentStudioQuickActionOption | null;
  onQuickAction: (option: AgentStudioQuickActionOption) => void;
  onResolveGitConflictQuickAction: (() => void) | null;
  isCreatingSession: boolean;
  agentStudioReady: boolean;
};
