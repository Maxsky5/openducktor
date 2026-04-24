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
  const hasExistingSession = existingSessionOptions.length > 0;
  const canStartFresh = getAgentScenarioDefinition(scenario).allowedStartModes.includes("fresh");

  switch (preferredStartMode) {
    case "fresh":
      return "fresh";
    case "reuse":
      return hasExistingSession ? "reuse" : canStartFresh ? "fresh" : "reuse";
    case "fork":
      return hasExistingSession ? "fork" : canStartFresh ? "fresh" : "fork";
  }
};
