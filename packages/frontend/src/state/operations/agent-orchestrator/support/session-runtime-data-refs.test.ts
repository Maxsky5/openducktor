import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";
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
const sessionState = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  ...sessionIdentity(),
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  title: "BUILD task-1",
  status: "idle",
  runtimeStatusMessage: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  historyLoadState: "not_requested",
  messages: createSessionMessagesState("external-1"),
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  ...overrides,
});
const identityTarget = (identity = sessionIdentity()) => ({
  identity,
  sessionAssociation: { kind: "unbound" as const },
  selectedModel: null,
});
const stateTarget = (state = sessionState()) => ({
  identity: sessionIdentity(state),
  sessionAssociation: state.sessionAssociation,
  selectedModel: state.selectedModel,
});

describe("resolveSessionRuntimeDataRefs", () => {
  test("returns no refs without a selected session", () => {
    expect(
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSession: null,
        runtimePolicy: null,
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
        selectedSession: stateTarget(),
        runtimePolicy: { kind: "opencode" },
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
        selectedSession: stateTarget(),
        runtimePolicy: { kind: "opencode" },
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
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      },
    });
  });

  test("returns only the catalog ref when todos are unsupported", () => {
    expect(
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSession: identityTarget(),
        runtimePolicy: { kind: "opencode" },
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

  test("returns todo refs for a plain selected-session identity", () => {
    expect(
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSession: identityTarget(),
        runtimePolicy: { kind: "opencode" },
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
        runtimePolicy: { kind: "opencode" },
      },
    });
  });

  test("forwards repository scope from the selected session association", () => {
    expect(
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSession: {
          ...identityTarget(),
          sessionAssociation: { kind: "repository" },
        },
        runtimePolicy: { kind: "opencode" },
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
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "repository" },
      },
    });
  });

  test("returns unscoped todo refs for an unbound session", () => {
    expect(
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSession: stateTarget(sessionState({ sessionAssociation: { kind: "unbound" } })),
        runtimePolicy: { kind: "opencode" },
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
        runtimePolicy: { kind: "opencode" },
      },
    });
  });

  test("fails fast on invalid selected-session runtime context", () => {
    expect(() =>
      resolveSessionRuntimeDataRefs({
        repoPath: "/repo",
        selectedSession: stateTarget(sessionState({ workingDirectory: "" })),
        runtimePolicy: { kind: "opencode" },
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      }),
    ).toThrow("Session workingDirectory is required to reach session 'external-1'.");
  });
});
