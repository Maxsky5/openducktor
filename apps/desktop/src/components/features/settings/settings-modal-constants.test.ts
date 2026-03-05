import { describe, expect, test } from "bun:test";
import { countPromptErrorsByRoleTab, resolvePromptRoleTab } from "./settings-modal-constants";

describe("settings-modal-constants", () => {
  test("maps template ids to prompt role tabs", () => {
    expect(resolvePromptRoleTab("system.role.spec.base")).toBe("spec");
    expect(resolvePromptRoleTab("kickoff.build_after_qa_rejected")).toBe("build");
    expect(resolvePromptRoleTab("system.scenario.qa_review")).toBe("qa");
    expect(resolvePromptRoleTab("system.shared.workflow_guards")).toBe("shared");
  });

  test("counts validation errors per prompt role tab", () => {
    const counts = countPromptErrorsByRoleTab({
      "system.shared.workflow_guards": "bad",
      "system.role.spec.base": "bad",
      "kickoff.build_implementation_start": "bad",
    });

    expect(counts).toEqual({
      shared: 1,
      spec: 1,
      planner: 0,
      build: 1,
      qa: 0,
    });
  });
});
