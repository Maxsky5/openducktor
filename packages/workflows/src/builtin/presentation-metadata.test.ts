import { describe, expect, test } from "bun:test";
import { resolveBuiltinPromptRoleTab } from "./presentation-metadata";

describe("built-in presentation metadata", () => {
  test("maps template ids to prompt role tabs", () => {
    expect(resolveBuiltinPromptRoleTab("system.role.spec.base")).toBe("spec");
    expect(resolveBuiltinPromptRoleTab("kickoff.build_after_qa_rejected")).toBe("build");
    expect(resolveBuiltinPromptRoleTab("system.shared.workflow_guards")).toBe("shared");
  });
});
