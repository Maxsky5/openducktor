import { createRuntimeDefinitionsService } from "./runtime-definitions-service";

describe("createRuntimeDefinitionsService", () => {
  test("returns the built-in runtime descriptors", () => {
    const service = createRuntimeDefinitionsService();

    const definitions = service.listRuntimeDefinitions();

    expect(definitions.map((definition) => definition.kind)).toEqual(["opencode", "codex"]);
    expect(definitions[0]?.capabilities.workflow.supportsOdtWorkflowTools).toBe(true);
    expect(definitions[1]?.capabilities.promptInput.supportedParts).toEqual([
      "text",
      "skill_mention",
    ]);
    expect(definitions[1]?.capabilities.promptInput.supportsSkillReferences).toBe(true);
  });
});
