import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { resolveSessionRuntimeDataRefs } from "./session-runtime-data-refs";

const cloneRuntimeDescriptor = (descriptor: RuntimeDescriptor): RuntimeDescriptor =>
  structuredClone(descriptor);

const createRuntimeDefinitions = ({ supportsTodos }: { supportsTodos: boolean }) => {
  const runtimeDefinition = cloneRuntimeDescriptor(OPENCODE_RUNTIME_DESCRIPTOR);
  runtimeDefinition.capabilities.optionalSurfaces.supportsTodos = supportsTodos;
  return [runtimeDefinition];
};

const sessionIdentity = (overrides: Partial<AgentSessionIdentity> = {}): AgentSessionIdentity => ({
  externalSessionId: "external-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  ...overrides,
});

describe("resolveSessionRuntimeDataRefs", () => {
  test("returns no refs without a selected session", () => {
    expect(
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSessionIdentity: null,
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      }),
    ).toEqual({
      kind: "none",
    });
  });

  test("reports missing repository path without runtime refs", () => {
    expect(
      resolveSessionRuntimeDataRefs({
        repoPath: null,
        selectedSessionIdentity: sessionIdentity(),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      }),
    ).toEqual({
      kind: "unavailable",
      error: "Repository path is required to read selected session runtime data.",
    });
  });

  test("returns stable refs without depending on repo runtime readiness", () => {
    expect(
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSessionIdentity: sessionIdentity(),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      }),
    ).toEqual({
      kind: "available",
      catalogRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
      },
      todosRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "external-1",
      },
    });
  });

  test("returns only the catalog ref when todos are unsupported", () => {
    expect(
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSessionIdentity: sessionIdentity(),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: false }),
      }),
    ).toEqual({
      kind: "available",
      catalogRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
      },
      todosRef: null,
    });
  });

  test("fails fast on invalid selected-session runtime context", () => {
    expect(() =>
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSessionIdentity: sessionIdentity({ workingDirectory: "" }),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      }),
    ).toThrow("Session workingDirectory is required to reach session 'external-1'.");
  });
});
