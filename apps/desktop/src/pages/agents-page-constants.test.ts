import { describe, expect, test } from "bun:test";
import {
  SCENARIOS_BY_ROLE,
  firstScenario,
  isRole,
  isScenario,
  kickoffPromptForScenario,
} from "./agents-page-constants";

describe("agents-page-constants", () => {
  test("returns first scenario per role", () => {
    expect(firstScenario("spec")).toBe(SCENARIOS_BY_ROLE.spec[0] ?? "spec_initial");
    expect(firstScenario("planner")).toBe(SCENARIOS_BY_ROLE.planner[0] ?? "spec_initial");
    expect(firstScenario("build")).toBe(SCENARIOS_BY_ROLE.build[0] ?? "spec_initial");
    expect(firstScenario("qa")).toBe(SCENARIOS_BY_ROLE.qa[0] ?? "spec_initial");
  });

  test("validates role and scenario guards", () => {
    expect(isRole("build")).toBe(true);
    expect(isRole("unknown")).toBe(false);
    expect(isScenario("qa_review")).toBe(true);
    expect(isScenario("unknown")).toBe(false);
  });

  test("includes task instruction in kickoff prompts", () => {
    const prompt = kickoffPromptForScenario("build", "build_implementation_start", "task-123");
    expect(prompt).toContain('taskId "task-123"');
    expect(prompt).toContain("odt_build_blocked");
  });
});
