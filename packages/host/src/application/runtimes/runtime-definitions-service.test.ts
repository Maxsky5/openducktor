import { Effect } from "effect";
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

  test("reports interrupted-turn resume support for every built-in runtime", () => {
    const service = createRuntimeDefinitionsService();

    const definitions = service.listRuntimeDefinitions();

    expect(
      definitions.map(
        (definition) => definition.capabilities.sessionLifecycle.supportsInterruptedTurnResume,
      ),
    ).toEqual([true, true, true]);
  });

  test("turns off the Claude capability when the safety gate is disabled", () => {
    const service = createRuntimeDefinitionsService({
      claudeInterruptedTurnResumeEnabled: false,
    });

    const definitions = service.listRuntimeDefinitions();

    expect(
      definitions.map((definition) => [
        definition.kind,
        definition.capabilities.sessionLifecycle.supportsInterruptedTurnResume,
      ]),
    ).toEqual([
      ["opencode", true],
      ["codex", true],
      ["claude", false],
    ]);
  });

  test("reports the effective Claude capability from the executable support probe", async () => {
    const unsupported = createRuntimeDefinitionsService({
      resolveClaudeInterruptedTurnResumeSupport: () => Effect.succeed(false),
    });
    const supported = createRuntimeDefinitionsService({
      resolveClaudeInterruptedTurnResumeSupport: () => Effect.succeed(true),
    });

    await expect(
      Effect.runPromise(unsupported.listEffectiveRuntimeDefinitions()),
    ).resolves.toMatchObject([
      { kind: "opencode" },
      { kind: "codex" },
      {
        kind: "claude",
        capabilities: { sessionLifecycle: { supportsInterruptedTurnResume: false } },
      },
    ]);
    await expect(
      Effect.runPromise(supported.listEffectiveRuntimeDefinitions()),
    ).resolves.toMatchObject([
      { kind: "opencode" },
      { kind: "codex" },
      {
        kind: "claude",
        capabilities: { sessionLifecycle: { supportsInterruptedTurnResume: true } },
      },
    ]);
  });

  test("keeps the Claude capability off when the safety gate is disabled", async () => {
    const service = createRuntimeDefinitionsService({
      claudeInterruptedTurnResumeEnabled: false,
      resolveClaudeInterruptedTurnResumeSupport: () => Effect.succeed(true),
    });

    const definitions = await Effect.runPromise(service.listEffectiveRuntimeDefinitions());

    expect(
      definitions.map((definition) => [
        definition.kind,
        definition.capabilities.sessionLifecycle.supportsInterruptedTurnResume,
      ]),
    ).toEqual([
      ["opencode", true],
      ["codex", true],
      ["claude", false],
    ]);
  });
});
