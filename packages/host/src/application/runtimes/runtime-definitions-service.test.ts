import { createRuntimeDefinitionsService } from "./runtime-definitions-service";

describe("createRuntimeDefinitionsService", () => {
  test("returns the built-in runtime descriptors", () => {
    const service = createRuntimeDefinitionsService();

    const definitions = service.listRuntimeDefinitions();

    expect(definitions.map((definition) => definition.kind)).toEqual([
      "opencode",
      "codex",
      "claude",
    ]);
    expect(definitions[0]?.capabilities.promptInput.supportsAttachments).toBe(true);
    expect(definitions[0]?.capabilities.workflow.supportsOdtWorkflowTools).toBe(true);
    expect(definitions[1]?.capabilities.promptInput.supportedParts).toEqual([
      "text",
      "slash_command",
      "skill_mention",
      "file_reference",
      "folder_reference",
    ]);
    expect(definitions[1]?.capabilities.promptInput.supportsFileSearch).toBe(true);
    expect(definitions[1]?.capabilities.promptInput.supportsSkillReferences).toBe(true);
    expect(definitions[1]?.capabilities.promptInput.supportsAttachments).toBe(true);
    expect(definitions[2]?.capabilities.promptInput.supportedParts).toEqual([
      "text",
      "slash_command",
      "skill_mention",
      "file_reference",
      "folder_reference",
    ]);
    expect(definitions[2]?.capabilities.promptInput.supportsAttachments).toBe(true);
    expect(definitions[2]?.capabilities.promptInput.supportsFileSearch).toBe(true);
    expect(definitions[2]?.capabilities.promptInput.supportsSkillReferences).toBe(true);
    expect(definitions[2]?.capabilities.promptInput.supportsSubagentReferences).toBe(false);
  });
});
