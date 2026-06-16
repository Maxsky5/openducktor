import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { resolveSessionRuntimeDataTarget } from "./session-runtime-data-target";

const createRuntimeDefinitions = ({ supportsTodos }: { supportsTodos: boolean }) => {
  const runtimeDefinition = structuredClone(OPENCODE_RUNTIME_DESCRIPTOR) as RuntimeDescriptor;
  runtimeDefinition.capabilities.optionalSurfaces.supportsTodos = supportsTodos;
  return [runtimeDefinition];
};

describe("resolveSessionRuntimeDataTarget", () => {
  test("builds runtime and session refs for a ready loaded session", () => {
    const target = resolveSessionRuntimeDataTarget({
      repoPath: "/repo",
      session: createAgentSessionFixture({
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        historyLoadState: "loaded",
      }),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready",
    });

    expect(target).toEqual({
      kind: "modelCatalogAndTodos",
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      },
      todosSessionRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "external-1",
      },
    });
  });

  test("keeps runtime data disabled while the repo runtime is not ready", () => {
    const target = resolveSessionRuntimeDataTarget({
      repoPath: "/repo",
      session: createAgentSessionFixture({
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        historyLoadState: "loaded",
      }),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "checking",
    });

    expect(target).toEqual({ kind: "none" });
  });

  test("uses canonical activity state instead of raw starting status", () => {
    const target = resolveSessionRuntimeDataTarget({
      repoPath: "/repo",
      session: createAgentSessionFixture({
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        historyLoadState: "loaded",
        status: "starting",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [],
          },
        ],
      }),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready",
    });

    expect(target.kind).toBe("modelCatalogAndTodos");
  });

  test("keeps todos disabled until history has loaded and the runtime supports todos", () => {
    const loadingHistoryTarget = resolveSessionRuntimeDataTarget({
      repoPath: "/repo",
      session: createAgentSessionFixture({
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        historyLoadState: "loading",
      }),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready",
    });
    const unsupportedRuntimeTarget = resolveSessionRuntimeDataTarget({
      repoPath: "/repo",
      session: createAgentSessionFixture({
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        historyLoadState: "loaded",
      }),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: false }),
      repoReadinessState: "ready",
    });

    expect(loadingHistoryTarget).toEqual({
      kind: "modelCatalog",
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      },
    });
    expect(unsupportedRuntimeTarget).toEqual({
      kind: "modelCatalog",
      runtimeRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      },
    });
  });

  test("reports invalid selected session runtime context without enabling reads", () => {
    const target = resolveSessionRuntimeDataTarget({
      repoPath: "/repo",
      session: createAgentSessionFixture({
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "",
      }),
      runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: true }),
      repoReadinessState: "ready",
    });

    expect(target).toEqual({
      kind: "blocked",
      supportError: "Session workingDirectory is required to read active session runtime data.",
    });
  });
});
