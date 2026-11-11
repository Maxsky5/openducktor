import { describe, expect, test } from "bun:test";
import { REPOSITORY_SECTIONS } from "./settings-modal-constants";

describe("settings-modal-constants", () => {
  test("lists Scripts directly after repository Configuration", () => {
    expect(REPOSITORY_SECTIONS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "configuration", label: "Configuration" },
      { id: "scripts", label: "Scripts" },
      { id: "git", label: "Git" },
      { id: "agents", label: "Agents" },
      { id: "prompts", label: "Repository prompts" },
    ]);
  });
});
