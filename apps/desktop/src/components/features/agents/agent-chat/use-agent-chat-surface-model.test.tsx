import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { AgentChatSurfaceModel } from "./agent-chat.types";
import { buildModelSelection, buildSession } from "./agent-chat-test-fixtures";
import { useAgentChatSurfaceModel } from "./use-agent-chat-surface-model";

afterEach(() => {
  cleanup();
});

describe("useAgentChatSurfaceModel", () => {
  test("handles rejected stop operations without surfacing an unhandled rejection", async () => {
    const session = buildSession();
    const stopCalls: string[] = [];
    const unhandledReasons: unknown[] = [];
    let rejectStop: (error: Error) => void = () => {};
    const stopPromise = new Promise<void>((_resolve, reject) => {
      rejectStop = reject;
    });
    let latestModel: AgentChatSurfaceModel | null = null;

    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      unhandledReasons.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    const Harness = (): ReactElement | null => {
      latestModel = useAgentChatSurfaceModel({
        mode: "interactive",
        session,
        isTaskHydrating: false,
        contextSwitchVersion: 0,
        showThinkingMessages: false,
        isSessionWorking: true,
        isSessionHistoryLoading: false,
        isWaitingForRuntimeReadiness: false,
        sessionRuntimeDataError: null,
        runtimeReadiness: {
          readinessState: "ready",
          isReady: true,
          blockedReason: null,
          isLoadingChecks: false,
          refreshChecks: async () => {},
        },
        emptyState: { title: "Empty" },
        pendingQuestions: {
          canSubmit: true,
          isSubmittingByRequestId: {},
          onSubmit: async () => {},
        },
        permissions: {
          canReply: true,
          isSubmittingByRequestId: {},
          errorByRequestId: {},
          onReply: async () => {},
        },
        composer: {
          taskId: "task-1",
          activeSession: session,
          isSessionWorking: true,
          isWaitingInput: false,
          busySendBlockedReason: null,
          canStopSession: true,
          stopAgentSession: async (sessionId) => {
            stopCalls.push(sessionId);
            await stopPromise;
          },
          isReadOnly: false,
          readOnlyReason: null,
          draftStateKey: "task-1:spec:session-1:0",
          onSend: async () => true,
          isSending: false,
          isStarting: false,
          contextUsage: null,
          selectedModelSelection: buildModelSelection(),
          selectedModelDescriptor: null,
          isSelectionCatalogLoading: false,
          supportsSlashCommands: true,
          supportsFileSearch: true,
          slashCommandCatalog: { commands: [] },
          slashCommands: [],
          slashCommandsError: null,
          isSlashCommandsLoading: false,
          searchFiles: async () => [],
          agentOptions: [],
          modelOptions: [],
          modelGroups: [],
          variantOptions: [],
          onSelectAgent: () => {},
          onSelectModel: () => {},
          onSelectVariant: () => {},
        },
      });
      return null;
    };

    try {
      render(<Harness />);
      let stopReturn: unknown;
      act(() => {
        stopReturn = latestModel?.composer?.onStopSession();
      });
      expect(stopReturn).toBeUndefined();
      expect(stopCalls).toEqual(["session-1"]);

      rejectStop(new Error("stop failed"));
      await Promise.resolve();

      expect(unhandledReasons).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    }
  });
});
