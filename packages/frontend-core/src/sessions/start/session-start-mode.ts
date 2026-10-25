import {
  getSessionLaunchAction,
  type BuiltinLaunchActionId as SessionLaunchActionId,
} from "@openducktor/workflows";
import type { AgentSessionStartMode } from "@openducktor/core";
import type { SessionStartExistingSessionOption } from "./session-start-types";

export const resolveLaunchStartMode = ({
  launchActionId,
  existingSessionOptions,
}: {
  launchActionId: SessionLaunchActionId;
  existingSessionOptions: SessionStartExistingSessionOption[];
}): AgentSessionStartMode => {
  const launchAction = getSessionLaunchAction(launchActionId);
  const preferredStartMode = launchAction.defaultStartMode;
  const hasExistingSession = existingSessionOptions.length > 0;
  const canStartFresh = launchAction.startModes.includes("fresh");

  switch (preferredStartMode) {
    case "fresh":
      return "fresh";
    case "reuse":
      return hasExistingSession ? "reuse" : canStartFresh ? "fresh" : "reuse";
    case "fork":
      return hasExistingSession ? "fork" : canStartFresh ? "fresh" : "fork";
  }
};
