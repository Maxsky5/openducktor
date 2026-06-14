import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import { deriveSessionRuntimeDataPlan } from "./session-runtime-data-plan";

const cloneRuntimeDescriptor = (descriptor: RuntimeDescriptor): RuntimeDescriptor =>
  structuredClone(descriptor);

const createRuntimeDefinitions = ({ supportsTodos }: { supportsTodos: boolean }) => {
  const runtimeDefinition = cloneRuntimeDescriptor(OPENCODE_RUNTIME_DESCRIPTOR);
  runtimeDefinition.capabilities.optionalSurfaces.supportsTodos = supportsTodos;
  return [runtimeDefinition];
};

const createSession = (
  overrides: Partial<{
    externalSessionId: string;
    runtimeKind: "opencode";
    workingDirectory: string;
    status: "starting" | "running" | "idle" | "error" | "stopped";
  }> = {},
) => ({
  externalSessionId: "external-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
  status: "running" as const,
  ...overrides,
});

describe("deriveSessionRuntimeDataPlan", () => {
  test("keeps concrete refs while waiting for repo readiness", () => {
    const plan = deriveSessionRuntimeDataPlan({
      repoPath: "/repo",
      session: createSession(),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "checking",
    });

    expect(plan.runtimeRef).toEqual({
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
    });
    expect(plan.sessionRef).toEqual({
      externalSessionId: "external-1",
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
    });
    expect(plan.runtimeDataSupportError).toBeNull();
    expect(plan.canReadModelCatalog).toBe(false);
    expect(plan.canReadTodos).toBe(false);
  });

  test("reads the model catalog without todos when the runtime does not support todos", () => {
    const plan = deriveSessionRuntimeDataPlan({
      repoPath: "/repo",
      session: createSession(),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: false }),
      repoReadinessState: "ready",
    });

    expect(plan.runtimeDataSupportError).toBeNull();
    expect(plan.canReadModelCatalog).toBe(true);
    expect(plan.canReadTodos).toBe(false);
  });

  test("reads todos only when the selected runtime supports todos", () => {
    const plan = deriveSessionRuntimeDataPlan({
      repoPath: "/repo",
      session: createSession(),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready",
    });

    expect(plan.runtimeDataSupportError).toBeNull();
    expect(plan.canReadModelCatalog).toBe(true);
    expect(plan.canReadTodos).toBe(true);
  });

  test("reports invalid session runtime context instead of enabling reads", () => {
    const plan = deriveSessionRuntimeDataPlan({
      repoPath: "/repo",
      session: createSession({ workingDirectory: "" }),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready",
    });

    expect(plan.runtimeRef).toBeNull();
    expect(plan.sessionRef).toBeNull();
    expect(plan.runtimeDataSupportError).toBe(
      "Session workingDirectory is required to read active session runtime data.",
    );
    expect(plan.canReadModelCatalog).toBe(false);
    expect(plan.canReadTodos).toBe(false);
  });
});
