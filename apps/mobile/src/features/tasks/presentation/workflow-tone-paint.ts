import type { WorkflowStepTone } from "@openducktor/frontend-core/types/agent-workflow";
import { withAlpha } from "@/theme/color-alpha";
import type { AppTheme } from "@/theme/tokens";

export type WorkflowToneColors = { surface: string; border: string; text: string; icon: string };

/**
 * The desktop workflow step colors of each state, from the semantic status families: the
 * `AGENT_WORKFLOW_TONE_TEXT_CLASSES` and `AGENT_WORKFLOW_TONE_ICON_CLASSES` text and icon, with
 * the surface and border of the role buttons.
 */
export const workflowToneColors = (theme: AppTheme, tone: WorkflowStepTone): WorkflowToneColors => {
  const d = theme.desktop;
  switch (tone) {
    case "in_progress":
      return { surface: d.infoSurface, border: d.infoBorder, text: d.infoMuted, icon: d.infoMuted };
    case "done":
      return {
        surface: d.successSurface,
        border: d.successBorder,
        text: d.successMuted,
        icon: d.successIcon,
      };
    case "available":
    case "optional":
      return { surface: d.card, border: d.input, text: d.foreground, icon: d.foreground };
    case "rejected":
      return {
        surface: d.rejectedSurface,
        border: d.rejectedBorder,
        text: d.rejectedMuted,
        icon: d.rejectedMuted,
      };
    case "waiting_input":
      return {
        surface: d.warningSurface,
        border: d.warningBorder,
        text: d.warningMuted,
        icon: d.warningMuted,
      };
    case "failed":
      return {
        surface: d.destructiveSurface,
        border: d.destructiveBorder,
        text: d.destructiveMuted,
        icon: d.destructiveMuted,
      };
    case "blocked":
      return {
        surface: d.muted,
        border: d.border,
        text: d.secondaryForeground,
        icon: d.mutedForeground,
      };
  }
};

/**
 * The desktop `WORKFLOW_CONNECTOR_CLASSES` color between two steps, from the state of the next
 * step: the `*-ring` color of each tone.
 */
export const workflowConnectorColor = (theme: AppTheme, tone: WorkflowStepTone): string => {
  const d = theme.desktop;
  switch (tone) {
    case "done":
      return d.successRing;
    case "in_progress":
      return d.infoRing;
    case "rejected":
      return d.rejectedRing;
    case "waiting_input":
      return d.warningRing;
    case "failed":
      // The desktop theme defines no `destructive-ring`, so the destructive accent stands in.
      return d.destructiveAccent;
    case "available":
    case "optional":
      return withAlpha(d.mutedForeground, 0.4);
    case "blocked":
      return withAlpha(d.mutedForeground, 0.2);
  }
};
