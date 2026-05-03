import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { useAgentChatSessionRuntimeData } from "./use-agent-chat-session-runtime-data";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const cloneRuntimeDescriptor = (descriptor: RuntimeDescriptor): RuntimeDescriptor =>
  structuredClone(descriptor);

const createRuntimeDefinitions = ({ supportsTodos }: { supportsTodos: boolean }) => {
  const runtimeDefinition = cloneRuntimeDescriptor(OPENCODE_RUNTIME_DESCRIPTOR);
  runtimeDefinition.capabilities.optionalSurfaces.supportsTodos = supportsTodos;
  return [runtimeDefinition];
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryProvider, { useIsolatedClient: true }, children);

describe("useAgentChatSessionRuntimeData", () => {
  test("does not query session todos when the runtime does not support todos", async () => {
    const readSessionModelCatalog = mock(() => new Promise<AgentModelCatalog>(() => {}));
    const readSessionTodos = mock(async () => {
      throw new Error("todos should not be queried");
    });
    const harness = createHookHarness(
      useAgentChatSessionRuntimeData,
      {
        session: createAgentSessionFixture({
          externalSessionId: "external-1",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/repo",
          modelCatalog: null,
          isLoadingModelCatalog: true,
        }),
        runtimeDefinitions: createRuntimeDefinitions({ supportsTodos: false }),
        repoReadinessState: "ready",
        readSessionModelCatalog,
        readSessionTodos,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(harness.getLatest().session?.todos).toEqual([]);
      expect(harness.getLatest().runtimeDataError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});
