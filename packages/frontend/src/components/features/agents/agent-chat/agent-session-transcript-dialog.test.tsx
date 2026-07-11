import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentSessionHistoryMessage,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import { act, render, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionsContext,
  ChecksStateContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "@/state/app-state-contexts";
import { host } from "@/state/operations/host";
import {
  createDeferred,
  createRepoRuntimeHealthFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import { AgentSessionTranscriptDialog } from "./agent-session-transcript-dialog";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";

const readSessionHistory = mock(async (): Promise<AgentSessionHistoryMessage[]> => []);
const subscribeSessionEvents = mock(
  async (_sessionRef: PolicyBoundSessionRef, _listener: (event: AgentEvent) => void) => () =>
    undefined,
);
const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;

const transcriptTarget: AgentSessionTranscriptTarget = {
  externalSessionId: "session-subagent-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo-a",
};

const runtimeDefinitionsValue = (): RuntimeDefinitionsContextValue => ({
  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
  availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
  isLoadingRuntimeDefinitions: false,
  runtimeDefinitionsError: null,
  refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
  loadRepoRuntimeCatalog: async () => ({
    runtime: OPENCODE_RUNTIME_DESCRIPTOR,
    agents: [],
    models: [],
    defaultModelsByProvider: {},
  }),
  loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
  loadRepoRuntimeSkills: async () => ({ skills: [] }),
  loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
  loadRepoRuntimeFileSearch: async () => [],
});

const wrapper = ({ children }: PropsWithChildren): ReactElement => {
  const runtimeHealthByRuntime = {
    opencode: createRepoRuntimeHealthFixture(),
  };
  return (
    <QueryProvider useIsolatedClient>
      <AgentOperationsContext.Provider
        value={{
          readSessionHistory,
          subscribeSessionEvents,
          readSessionTodos: async () => [],
          loadAgentSessionHistory: async () => null,
          startAgentSession: async () => ({
            externalSessionId: "session-started",
            runtimeKind: "opencode",
            workingDirectory: "/repo-a",
          }),
          sendAgentMessage: async () => undefined,
          stopAgentSession: async () => undefined,
          updateAgentSessionModel: () => undefined,
          replyAgentApproval: async () => undefined,
          answerAgentQuestion: async () => undefined,
        }}
      >
        <AgentSessionsContext.Provider value={createAgentSessionsStore("/repo-a")}>
          <ChecksStateContext.Provider
            value={{
              runtimeCheck: null,
              taskStoreCheck: null,
              runtimeCheckFailureKind: null,
              taskStoreCheckFailureKind: null,
              isLoadingChecks: false,
              refreshChecks: async () => undefined,
            }}
          >
            <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsValue()}>
              <RepoRuntimeHealthContext.Provider
                value={{
                  runtimeHealthByRuntime,
                  isLoadingRepoRuntimeHealth: false,
                  refreshRepoRuntimeHealth: async () => runtimeHealthByRuntime,
                }}
              >
                {children}
              </RepoRuntimeHealthContext.Provider>
            </RuntimeDefinitionsContext.Provider>
          </ChecksStateContext.Provider>
        </AgentSessionsContext.Provider>
      </AgentOperationsContext.Provider>
    </QueryProvider>
  );
};

const makeScrollableTranscriptHistory = (): AgentSessionHistoryMessage[] =>
  Array.from({ length: 40 }, (_, index) => {
    const timestamp = new Date(Date.UTC(2026, 1, 22, 12, 0, index)).toISOString();
    if (index % 2 === 0) {
      return {
        messageId: `message-user-${index}`,
        role: "user" as const,
        timestamp,
        text: `User prompt ${index}`,
        displayParts: [],
        state: "read" as const,
        parts: [],
      };
    }
    return {
      messageId: `message-assistant-${index}`,
      role: "assistant" as const,
      timestamp,
      text: `Assistant response ${index}`,
      parts: [],
    };
  });

const installScrollMetrics = (element: HTMLDivElement): void => {
  let scrollTop = 0;
  Object.defineProperties(element, {
    clientHeight: { configurable: true, get: () => 300 },
    scrollHeight: { configurable: true, get: () => 1_200 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (nextScrollTop: number) => {
        scrollTop = Math.max(0, Math.min(nextScrollTop, 900));
      },
    },
  });
};

const transcriptScrollRegion = (): HTMLDivElement => {
  const regions = globalThis.document.querySelectorAll(".agent-chat-scroll-region");
  const region = regions.item(regions.length - 1);
  if (!(region instanceof globalThis.HTMLDivElement)) {
    throw new Error("Expected the transcript dialog to render its chat scroll region.");
  }
  return region;
};

const dialog = (open: boolean): ReactElement => (
  <AgentSessionTranscriptDialog
    workspaceRepoPath="/repo-a"
    target={transcriptTarget}
    open={open}
    onOpenChange={() => undefined}
    title="Subagent transcript"
    description="Conversation history"
  />
);

describe("AgentSessionTranscriptDialog", () => {
  beforeEach(() => {
    readSessionHistory.mockClear();
    subscribeSessionEvents.mockClear();
  });

  afterEach(() => {
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
  });

  test("pins to the bottom after async history loads", async () => {
    const history = makeScrollableTranscriptHistory();
    const deferredHistory = createDeferred<AgentSessionHistoryMessage[]>();
    const deferredSettings = createDeferred<SettingsSnapshot>();
    host.workspaceGetSettingsSnapshot = async () => deferredSettings.promise;
    readSessionHistory.mockImplementationOnce(async () => deferredHistory.promise);
    const rendered = render(dialog(true), { wrapper });

    try {
      await act(async () => {
        deferredSettings.resolve(createSettingsSnapshotFixture());
        await deferredSettings.promise;
      });
      await waitFor(() => expect(readSessionHistory).toHaveBeenCalledTimes(1));
      const scrollRegion = transcriptScrollRegion();
      installScrollMetrics(scrollRegion);
      scrollRegion.scrollTop = 0;

      await act(async () => {
        deferredHistory.resolve(history);
        await deferredHistory.promise;
      });

      await waitFor(() => expect(rendered.getByText("Assistant response 39")).toBeTruthy());
      await waitFor(() => expect(scrollRegion.scrollTop).toBe(900));
    } finally {
      rendered.unmount();
    }
  });
});
