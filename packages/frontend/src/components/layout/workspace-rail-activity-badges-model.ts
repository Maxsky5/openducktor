import type { WorkspaceActivityState } from "@/features/workspace-activity/workspace-activity-state";

const WORKSPACE_ACTIVITY_LABELS = {
  inputRequired: "Sessions waiting for input",
  active: "Sessions running",
  error: "Sessions failed",
  unavailable: "Session activity unavailable",
} as const;

type WorkspaceActivityBadgeKey = "inputRequired" | "error" | "active" | "unavailable";

export type WorkspaceActivityBadge = {
  key: WorkspaceActivityBadgeKey;
  /** Hover text and assistive text. It names the state and gives no count. */
  label: string;
};

/** Left to right: input required, then error, then active. */
export const workspaceActivityBadges = (
  activity: WorkspaceActivityState,
): readonly WorkspaceActivityBadge[] => {
  if (activity.kind === "unknown") {
    return [];
  }
  if (activity.kind === "unavailable") {
    return [
      { key: "unavailable", label: `${WORKSPACE_ACTIVITY_LABELS.unavailable}: ${activity.reason}` },
    ];
  }

  const badges: WorkspaceActivityBadge[] = [];
  if (activity.inputRequired) {
    badges.push({ key: "inputRequired", label: WORKSPACE_ACTIVITY_LABELS.inputRequired });
  }
  if (activity.error) {
    badges.push({ key: "error", label: WORKSPACE_ACTIVITY_LABELS.error });
  }
  if (activity.active) {
    badges.push({ key: "active", label: WORKSPACE_ACTIVITY_LABELS.active });
  }
  return badges;
};
