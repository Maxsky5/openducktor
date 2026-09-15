import { expect, spyOn, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  DEFAULT_CHAT_SETTINGS,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { act, useState } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { useIsFetching } from "@tanstack/react-query";
import * as messageContent from "@/components/features/agents/agent-chat/agent-chat-message-card-content";
import { buildMessage } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import * as modelPickerModel from "@/components/features/agents/model-picker/model-picker-model";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import {
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "@/state/app-state-contexts";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createAgentSessionFixture,
  createRepoRuntimeHealthFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type {
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
} from "@/types/state-slices";
import { WorkspaceSessionChat } from "./workspace-session-chat";
import { createWorkspaceSessionChatDraftPersistence } from "./workspace-session-chat-draft";
import { createTextSegment } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";

function QueryStatus() {
  const pending = useIsFetching();
  return (
    <output aria-label="Pending queries" hidden>
      {pending}
    </output>
  );
}

test.each(["retry", "streaming", "draft", "record-failure"] as const)(
  "workspace chat %s preserves readiness and completed turns",
  async (scenario) => {
    const workspace = { workspaceId: "A", workspaceName: "Test", repoPath: "/repo" };
    const entry: WorkspaceSession = {
      id: "session-1",
      runtimeKind: "opencode",
      externalSessionId: scenario === "draft" ? null : "native-1",
      executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
      createdAt: 1000,
      updatedAt: 1000,
      archivedAt: null,
    };
    const messages = [
      buildMessage("user", "First question", { id: "user-1" }),
      buildMessage("assistant", "Completed answer", { id: "assistant-1" }),
      buildMessage("user", "Second question", { id: "user-2" }),
      buildMessage("assistant", "Current answer", { id: "assistant-2" }),
    ];
    const session = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "native-1",
      workingDirectory: "/repo",
      sessionAssociation: { kind: "repository" },
      historyLoadState: "loaded",
      status: scenario === "streaming" ? "running" : "idle",
      messages,
      pendingApprovals: [],
      pendingQuestions: [],
    });
    const store = createAgentSessionsStore("/repo");
    if (scenario !== "draft") store.replaceSession(session);
    let runtimeReads = 0;
    const operations: AgentOperationsContextValue = {
      describeGeneratedImages: async () => {
        throw new Error("Unexpected image metadata read");
      },
      beginGeneratedImageBatch: async () => {
        throw new Error("Unexpected image batch");
      },
      releaseGeneratedImageBatch: async () => {
        throw new Error("Unexpected image batch release");
      },
      readGeneratedImage: async () => {
        throw new Error("Unexpected image read");
      },
      readSessionTodos: async () => {
        runtimeReads += 1;
        return [];
      },
      readSessionHistory: async () => [],
      loadAgentSessionHistory: async () => {
        runtimeReads += 1;
        return session;
      },
      loadAgentSessionContext: async () => {
        runtimeReads += 1;
      },
      startAgentSession: async () => {
        throw new Error("Unexpected session startup");
      },
      sendAgentMessage: async () => {
        throw new Error("Unexpected message send");
      },
      stopAgentSession: async () => {},
      continueInterruptedTurn: async () => undefined,
      updateAgentSessionModel: () => {},
      replyAgentApproval: async () => {},
      answerAgentQuestion: async () => {},
    };
    const definitions: RuntimeDefinitionsContextValue = {
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      agentRuntimes: DEFAULT_AGENT_RUNTIMES,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
      isLoadingRuntimeSettings: false,
      runtimeSettingsError: null,
      hasRuntimeSettingsSnapshot: true,
      refreshRuntimeSettings: async () => {},
      loadRepoRuntimeCatalog: async () => ({ models: [], defaultModelsByProvider: {} }),
      loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
      loadRepoRuntimeSkills: async () => ({ skills: [] }),
      loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
      loadRepoRuntimeFileSearch: async () => [],
    };
    const health = { opencode: createRepoRuntimeHealthFixture() };
    let completeObservation!: () => void;
    function Harness() {
      const [phase, setPhase] = useState<"fault" | "loading" | "ready">(
        scenario === "retry" || scenario === "record-failure" ? "fault" : "ready",
      );
      completeObservation = () => setPhase("ready");
      const readModel: AgentSessionReadModelStateContextValue = {
        workspaceSessionRecordsError:
          scenario === "record-failure" && phase !== "ready" ? "Chat records failed" : null,
        sessionReadModelLoadState: {
          kind: phase === "loading" ? "loading" : "ready",
          workspaceRepoPath: "/repo",
        },
        getSessionFault: () =>
          phase === "fault" && scenario === "retry"
            ? { source: "workspace-target", message: "Runtime directory mismatch" }
            : null,
        reloadSessionReadModel: () => setPhase("loading"),
      };
      return (
        <QueryProvider useIsolatedClient>
          <QueryStatus />
          <RuntimeDefinitionsContext value={definitions}>
            <RepoRuntimeHealthContext
              value={{
                runtimeHealthByRuntime: health,
                isLoadingRepoRuntimeHealth: false,
                refreshRepoRuntimeHealth: async () => health,
              }}
            >
              <AgentOperationsContext value={operations}>
                <AgentSessionHistoryLoadContext
                  value={{
                    loadSelectedSessionBaselineHistory: async () => {
                      runtimeReads += 1;
                      return session;
                    },
                  }}
                >
                  <AgentSessionReadModelStateContext value={readModel}>
                    <AgentSessionsContext value={store}>
                      <WorkspaceSessionChat
                        workspace={workspace}
                        record={entry}
                        chatSettings={DEFAULT_CHAT_SETTINGS}
                        reusablePrompts={[]}
                      />
                    </AgentSessionsContext>
                  </AgentSessionReadModelStateContext>
                </AgentSessionHistoryLoadContext>
              </AgentOperationsContext>
            </RepoRuntimeHealthContext>
          </RuntimeDefinitionsContext>
        </QueryProvider>
      );
    }
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
      }),
    );
    const renderCounts = new Map<string, number>();
    const OriginalMessageBody = messageContent.MessageBody;
    const body = spyOn(messageContent, "MessageBody").mockImplementation((props) => {
      renderCounts.set(props.message.id, (renderCounts.get(props.message.id) ?? 0) + 1);
      return <OriginalMessageBody {...props} />;
    });
    const buildPickerItems = spyOn(modelPickerModel, "buildModelPickerItems");
    const draftPersistence = createWorkspaceSessionChatDraftPersistence(
      workspace.workspaceId,
      entry.id,
    );
    if (scenario === "draft") {
      draftPersistence.set({ segments: [createTextSegment("Unsent draft survives reload")] });
      await draftPersistence.flush();
    }
    const view = render(<Harness />);
    try {
      if (scenario === "draft") {
        await waitFor(() => expect(view.getByLabelText("Pending queries").textContent).toBe("0"), {
          timeout: 2000,
        });
        expect(view.getByLabelText("Message composer").textContent).toContain(
          "Unsent draft survives reload",
        );
        expect(view.getByLabelText("Message composer").getAttribute("contenteditable")).toBe(
          "true",
        );
        expect(view.queryByText("Loading session")).toBeNull();
        expect(runtimeReads).toBe(0);
        return;
      }
      if (scenario === "streaming") {
        await view.findByText("Completed answer", {}, { timeout: 2000 });
        await view.findByText("Current answer", {}, { timeout: 2000 });
        await waitFor(() => expect(view.getByLabelText("Pending queries").textContent).toBe("0"), {
          timeout: 2000,
        });
        const completedRenders = renderCounts.get("assistant-1");
        const currentRenders = renderCounts.get("assistant-2") ?? 0;
        const catalogBuilds = buildPickerItems.mock.calls.length;
        expect(catalogBuilds).toBeGreaterThan(0);
        expect(completedRenders).toBeGreaterThan(0);
        await act(async () => {
          store.replaceSession({
            ...session,
            messages: createSessionMessagesState(
              "native-1",
              [
                ...session.messages.items.slice(0, 3),
                { ...session.messages.items[3]!, content: "Current answer with another token" },
              ],
              session.messages.version + 1,
            ),
          });
        });
        await view.findByText("Current answer with another token", {}, { timeout: 2000 });
        expect(renderCounts.get("assistant-2")).toBeGreaterThan(currentRenders);
        expect(renderCounts.get("assistant-1")).toBe(completedRenders);
        expect(buildPickerItems).toHaveBeenCalledTimes(catalogBuilds);
        return;
      }
      const composer = view.getByLabelText("Message composer");
      expect(composer.getAttribute("contenteditable")).toBe("false");
      if (scenario === "record-failure") {
        await view.findByText("Chat records failed");
        expect(view.getByText("Completed answer")).toBeTruthy();
      } else {
        await act(async () => {
          fireEvent.click(view.getByRole("button", { name: "Retry" }));
        });
        expect(composer.getAttribute("contenteditable")).toBe("false");
        expect(view.queryByText("Workspace Session target mismatch")).toBeNull();
      }
      await act(async () => {
        completeObservation();
      });
      await waitFor(() => expect(composer.getAttribute("contenteditable")).toBe("true"), {
        timeout: 800,
      });
    } finally {
      view.unmount();
      await draftPersistence.flush();
      draftPersistence.clear();
      body.mockRestore();
      buildPickerItems.mockRestore();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
  5000,
);
