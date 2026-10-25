import { describe, expect, test } from "bun:test";
import { countPromptErrorsByRoleTab, REPOSITORY_SECTIONS } from "./settings-modal-constants";

describe("settings-modal-constants", () => {
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

  test("lists Scripts directly after repository Configuration", () => {
    expect(REPOSITORY_SECTIONS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "configuration", label: "Configuration" },
      { id: "scripts", label: "Scripts" },
      { id: "git", label: "Git" },
      { id: "agents", label: "Agents" },
      { id: "prompts", label: "Repo Prompts" },
    ]);
  });
});
