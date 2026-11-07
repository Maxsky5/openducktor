import type { AgentSessionGoalControlAction } from "@openducktor/contracts";
import type { AgentSessionGoalTone } from "@openducktor/frontend-core/sessions/goals/agent-session-goal-row";
import type { AgentSessionGoalRowModel } from "@openducktor/frontend-core/sessions/goals/use-agent-session-goal-row";
import type { AppTheme } from "@/theme/tokens";

/** The desktop text color of each goal tone. */
export const goalToneColor = (theme: AppTheme, tone: AgentSessionGoalTone): string => {
  switch (tone) {
    case "success":
      return theme.desktop.successMuted;
    case "warning":
      return theme.desktop.warningMuted;
    case "danger":
      return theme.desktop.destructiveMuted;
    case "info":
      return theme.desktop.infoMuted;
    case "muted":
      return theme.desktop.mutedForeground;
  }
};

/**
 * Goal actions send host commands, so they wait for the command gate and for the action that
 * runs. Expanding the objective sends nothing and stays available.
 */
export const goalActionsOpen = (
  model: Pick<AgentSessionGoalRowModel, "pendingAction">,
  commandsOpen: boolean,
): boolean => commandsOpen && model.pendingAction === null;

/** Runs a goal action only while the actions are open, so a late press sends nothing. */
export const pressGoalAction = (
  model: Pick<AgentSessionGoalRowModel, "pendingAction" | "onAction">,
  commandsOpen: boolean,
  action: AgentSessionGoalControlAction,
): void => {
  if (goalActionsOpen(model, commandsOpen)) model.onAction(action);
};
