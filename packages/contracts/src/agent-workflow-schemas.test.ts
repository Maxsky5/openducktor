import { describe, expect, test } from "bun:test";
import {
  agentScenarioValues,
  defaultAgentScenarioForRole,
  defaultStartModeForScenario,
  getAgentScenarioDefinition,
  getAgentScenariosForRole,
  isAgentKickoffScenario,
  isScenarioStartModeAllowed,
} from "./agent-workflow-schemas";

describe("agent-workflow-schemas", () => {
  test("defines role and start-mode policy for every scenario", () => {
    for (const scenario of agentScenarioValues) {
      const definition = getAgentScenarioDefinition(scenario);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.allowedStartModes.length).toBeGreaterThan(0);
      expect(definition.allowedStartModes).toContain(definition.defaultStartMode);
      expect(isAgentKickoffScenario(scenario)).toBe(definition.supportsKickoff);
    }
  });

  test("derives scenarios by role from the registry", () => {
    expect(getAgentScenariosForRole("spec")).toEqual(["spec_initial"]);
    expect(getAgentScenariosForRole("planner")).toEqual(["planner_initial"]);
    expect(getAgentScenariosForRole("build")).toEqual([
      "build_implementation_start",
      "build_after_qa_rejected",
      "build_after_human_request_changes",
      "build_rebase_conflict_resolution",
    ]);
    expect(getAgentScenariosForRole("qa")).toEqual(["qa_review"]);
  });

  test("uses explicit defaults for each scenario", () => {
    expect(defaultAgentScenarioForRole("build")).toBe("build_implementation_start");
    expect(defaultStartModeForScenario("spec_initial")).toBe("fresh");
    expect(defaultStartModeForScenario("planner_initial")).toBe("fresh");
    expect(defaultStartModeForScenario("qa_review")).toBe("reuse");
    expect(defaultStartModeForScenario("build_implementation_start")).toBe("fresh");
    expect(defaultStartModeForScenario("build_after_qa_rejected")).toBe("reuse");
    expect(defaultStartModeForScenario("build_after_human_request_changes")).toBe("reuse");
    expect(defaultStartModeForScenario("build_rebase_conflict_resolution")).toBe("reuse");
  });

  test("allows reuse only for scenarios that can continue existing work", () => {
    expect(isScenarioStartModeAllowed("spec_initial", "reuse")).toBe(false);
    expect(isScenarioStartModeAllowed("planner_initial", "reuse")).toBe(false);
    expect(isScenarioStartModeAllowed("qa_review", "reuse")).toBe(true);
    expect(isScenarioStartModeAllowed("build_implementation_start", "reuse")).toBe(false);
    expect(isScenarioStartModeAllowed("build_after_qa_rejected", "reuse")).toBe(true);
    expect(isScenarioStartModeAllowed("build_after_human_request_changes", "reuse")).toBe(true);
    expect(isScenarioStartModeAllowed("build_rebase_conflict_resolution", "reuse")).toBe(true);
  });
});
