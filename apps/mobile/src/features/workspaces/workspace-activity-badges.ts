import {
  type WorkspaceActivityBadge,
  workspaceActivityBadges,
} from "@openducktor/frontend-core/workspace-activity/workspace-activity-badges";
import type { WorkspaceActivityState } from "@openducktor/frontend-core/workspace-activity/workspace-activity-state";
import type { Tone } from "@/ui/tones";

export type WorkspaceBadgePresentation = {
  key: WorkspaceActivityBadge["key"];
  /** A short visible label. The tone repeats it, so color is never the only signal. */
  label: string;
  tone: Tone;
  /** The desktop rail text, with the reason when activity is unavailable. */
  accessibilityLabel: string;
};

const BADGES = {
  inputRequired: { label: "Input required", tone: "warning" },
  error: { label: "Error", tone: "destructive" },
  active: { label: "Active", tone: "running" },
  unavailable: { label: "Unavailable", tone: "cancelled" },
} satisfies Record<WorkspaceActivityBadge["key"], { label: string; tone: Tone }>;

/** Badges in the desktop order: input required, error, active; or unavailable alone. */
export const workspaceBadgePresentations = (
  activity: WorkspaceActivityState,
): WorkspaceBadgePresentation[] =>
  workspaceActivityBadges(activity).map((badge) => ({
    key: badge.key,
    ...BADGES[badge.key],
    accessibilityLabel: badge.label,
  }));
