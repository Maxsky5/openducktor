import type { PullRequest } from "@openducktor/contracts";
import type { LucideIcon } from "lucide-react";
import type { ComboboxGroup } from "@/components/ui/combobox";
import type { SessionStartPostAction } from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import type { WorkflowRailStep } from "@/types/agent-workflow";
import type {
  BuiltinLaunchActionId as SessionLaunchActionId,
  BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";

export type AgentRoleOption = {
  role: AgentRole;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export type AgentWorkflowStep = WorkflowRailStep & {
  role: AgentRole;
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
  /** The pull request linked to the task, shown in the top bar. */
  pullRequest: PullRequest | null;
  onOpenTaskDetails: (() => void) | null;
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
