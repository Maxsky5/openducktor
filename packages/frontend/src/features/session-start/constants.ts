import type { SessionLaunchActionId } from "./session-start-launch-options";

export const BUILD_TARGET_BRANCH_LAUNCH_ACTIONS = new Set<SessionLaunchActionId>([
  "build_implementation_start",
]);

export const supportsTaskTargetBranchSelection = (
  role: string | null | undefined,
  launchActionId: SessionLaunchActionId | null | undefined,
): boolean => {
  return role === "build" && launchActionId !== undefined && launchActionId !== null
    ? BUILD_TARGET_BRANCH_LAUNCH_ACTIONS.has(launchActionId)
    : false;
};
