import type {
  AgentSessionCreateOption,
  AgentStudioQuickActionOption,
} from "./agent-studio-header.types";

export type QuickActionsMenuAvailability = {
  agentStudioReady: boolean;
  isCreatingSession: boolean;
  options: AgentStudioQuickActionOption[];
  primaryAction: AgentStudioQuickActionOption | null;
  sessionCreateOptions: AgentSessionCreateOption[];
  onResolveGitConflictQuickAction: (() => void) | null;
};

type QuickActionBlockedReasonInput = {
  option: AgentStudioQuickActionOption;
  agentStudioReady: boolean;
  sessionStartBlockedReason: string | null;
  onResolveGitConflictQuickAction: (() => void) | null;
};

export const isGitConflictResolutionQuickAction = (
  option: AgentStudioQuickActionOption,
): boolean => {
  return option.launchActionId === "build_rebase_conflict_resolution";
};

export const getQuickActionBlockedReason = ({
  option,
  agentStudioReady,
  sessionStartBlockedReason,
  onResolveGitConflictQuickAction,
}: QuickActionBlockedReasonInput): string | null => {
  if (!agentStudioReady) {
    return "Agent Studio is not ready.";
  }

  if (sessionStartBlockedReason) {
    return sessionStartBlockedReason;
  }

  if (option.disabled) {
    return option.disabledReason ?? "Action unavailable.";
  }

  if (isGitConflictResolutionQuickAction(option) && !onResolveGitConflictQuickAction) {
    return "Git conflict resolution is unavailable.";
  }

  return null;
};

export const canRunPrimaryQuickAction = ({
  agentStudioReady,
  isCreatingSession,
  primaryAction,
  onResolveGitConflictQuickAction,
}: Pick<
  QuickActionsMenuAvailability,
  "agentStudioReady" | "isCreatingSession" | "primaryAction" | "onResolveGitConflictQuickAction"
>): boolean => {
  if (primaryAction === null) {
    return false;
  }

  const sessionStartBlockedReason = isCreatingSession
    ? "Session start is already in progress."
    : null;

  return (
    getQuickActionBlockedReason({
      option: primaryAction,
      agentStudioReady,
      sessionStartBlockedReason,
      onResolveGitConflictQuickAction,
    }) === null
  );
};

export const canOpenQuickActionsMenu = ({
  agentStudioReady,
  isCreatingSession,
  options,
  primaryAction,
  sessionCreateOptions,
  onResolveGitConflictQuickAction,
}: QuickActionsMenuAvailability): boolean => {
  const hasMenuEntries = options.length + sessionCreateOptions.length > 0;
  const primaryActionDisabled =
    primaryAction !== null &&
    !canRunPrimaryQuickAction({
      agentStudioReady,
      isCreatingSession,
      primaryAction,
      onResolveGitConflictQuickAction,
    });

  return agentStudioReady && hasMenuEntries && !primaryActionDisabled;
};
