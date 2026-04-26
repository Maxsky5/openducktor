import { describe, expect, test } from "bun:test";
import { createAgentRuntimeRegistry, DEFAULT_RUNTIME_KIND } from "./agent-runtime-registry";

describe("agent-runtime-registry", () => {
  test("registers only the shipped opencode runtime adapter", () => {
    const registry = createAgentRuntimeRegistry();

    expect(registry.defaultRuntimeKind).toBe(DEFAULT_RUNTIME_KIND);
    expect(registry.registeredRuntimeKinds).toEqual(["opencode"]);
    expect(registry.getRuntimeDefinition("opencode").kind).toBe("opencode");
    expect(
      registry
        .createAgentEngine()
        .listRuntimeDefinitions()
        .map((runtime) => runtime.kind),
    ).toEqual(["opencode"]);
  });

  test("rejects unsupported runtime adapters", () => {
    const registry = createAgentRuntimeRegistry();

    expect(() => registry.getAdapter("test-runtime")).toThrow(
      "Unsupported agent runtime 'test-runtime'.",
    );
  });

  test("requires an explicit runtime for adapter selection", async () => {
    const engine = createAgentRuntimeRegistry().createAgentEngine();

    const missingRuntimeInput = {
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
      systemPrompt: "Prompt",
    } as unknown as Parameters<typeof engine.startSession>[0];

    await expect(engine.startSession(missingRuntimeInput)).rejects.toThrow(
      "Runtime kind is required to select an agent runtime adapter.",
    );
  });
});
