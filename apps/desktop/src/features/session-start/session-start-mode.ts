import {
  type AgentScenario,
  type AgentSessionStartMode,
  defaultStartModeForScenario,
  getAgentScenarioDefinition,
} from "@openducktor/core";
import type { SessionStartExistingSessionOption } from "./session-start-types";

export const resolveScenarioStartMode = ({
  scenario,
  existingSessionOptions,
}: {
  scenario: AgentScenario;
  existingSessionOptions: SessionStartExistingSessionOption[];
}): AgentSessionStartMode => {
  const preferredStartMode = defaultStartModeForScenario(scenario);
  const needsExistingSession = preferredStartMode === "reuse" || preferredStartMode === "fork";
  if (!needsExistingSession || existingSessionOptions.length > 0) {
    return preferredStartMode;
  }
  return getAgentScenarioDefinition(scenario).allowedStartModes.includes("fresh")
    ? "fresh"
    : preferredStartMode;
};
