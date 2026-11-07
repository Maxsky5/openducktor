import { type WorkflowLaunchActionId as SessionLaunchActionId } from "@openducktor/workflows";
import type { AgentSessionStartMode } from "@openducktor/core";
import type { SessionStartExistingSessionOption } from "./session-start-types";

export const resolveLaunchStartMode = ({
  launchActionId,
  taskWorkflow,
  existingSessionOptions,
}: {
  launchActionId: SessionLaunchActionId;
  taskWorkflow: import("@openducktor/workflows").TaskWorkflow;
  existingSessionOptions: SessionStartExistingSessionOption[];
}): AgentSessionStartMode => {
  const launchAction = taskWorkflow.launchDefinition(launchActionId);
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
