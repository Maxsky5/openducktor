import {
  type AgentScenario,
  type AgentSessionStartMode,
  defaultStartModeForScenario,
} from "@openducktor/core";
import type { SessionStartReusableSessionOption } from "./session-start-types";

export const resolveScenarioStartMode = ({
  scenario,
  reusableSessionOptions,
}: {
  scenario: AgentScenario;
  reusableSessionOptions: SessionStartReusableSessionOption[];
}): AgentSessionStartMode => {
  const preferredStartMode = defaultStartModeForScenario(scenario);
  if (preferredStartMode !== "reuse" || reusableSessionOptions.length > 0) {
    return preferredStartMode;
  }
  return "fresh";
};
