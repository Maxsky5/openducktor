import { expect, mock, spyOn, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND, type WorkspaceSession } from "@openducktor/contracts";
import { type HostClient, HostInvokeError } from "@openducktor/host-client";
import { act, render, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { Activity, type PropsWithChildren, type ReactElement } from "react";
import { toast } from "sonner";
import { createTextSegment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useStableAgentSessionIdentity } from "@openducktor/frontend-core/lib/use-stable-agent-session-identity";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type {
  AgentMessageSendReceipt,
  AgentChatMessage,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { ActiveWorkspace, AgentOperationsContextValue } from "@/types/state-slices";
import { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import { useAgentChatSendForTarget } from "@/test-utils/agent-chat-send-fixture";
import { AgentChatSendProviders } from "@/test-utils/agent-chat-send-providers";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import {
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import { createSessionMessagesFixture } from "@openducktor/frontend-core/test-support/session-message-test-helpers";
import * as sessionChat from "./workspace-session-chat";
import { WorkspaceSessionChatPane } from "./workspace-session-chat-pane";
import { SessionViewContext } from "@/features/session-navigation/session-view-context";
import { createAgentMessageSendReceipt } from "@openducktor/frontend-core/test-support/agent-message-send-fixture";
import { requestWorkspaceGitConflictAssistance } from "./workspace-git-conflict-assistance";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";

/** A workspace chat as the page wires it: its actions with the shared send rules. */
const useWorkspaceChat = (
  workspace: ActiveWorkspace,
  record: WorkspaceSession,
  isMounted: () => boolean,
) => {
  const actions = useWorkspaceSessionChatActions(workspace, record, isMounted);
  const identity = useStableAgentSessionIdentity(workspaceSessionIdentity(record));
  const delivery = useAgentChatSendForTarget(
    actions.sendTarget({
      canSend: true,
      assertCanSubmit: () => {},
    }),
    {
      identity,
      repoPath: workspace.repoPath,
      runtimeDescriptor: RUNTIME_DESCRIPTORS_BY_KIND[record.runtimeKind],
      draftRules: { reusablePrompts: [], supportsAttachments: false },
    },
  );
  return { ...actions, send: delivery.onSend };
};

const WORKSPACE = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };

/** Renders a hook of a saved chat with the contexts of the workspace page. */
const renderWorkspaceChat = <Result,>(
  useChat: () => Result,
  operations: AgentOperationsContextValue,
  store = createAgentSessionsStore("/repo"),
  client: Partial<HostClient> = {},
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = createTestClientConnection({ queryClient, client });
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>
      <AgentSessionsContext value={store}>
        <AgentChatSendProviders operations={operations}>{children}</AgentChatSendProviders>
      </AgentSessionsContext>
    </ClientConnectionProvider>
  );
  const view = renderHook(useChat, { wrapper });
  return {
    result: view.result,
    store,
    dispose: () => {
      view.unmount();
      queryClient.clear();
    },
  };
};

test.each(["local_repo_root", "local_worktree"] as const)(
  "conflict assistance sends to the selected saved %s chat",
  async (kind) => {
    const directory = kind === "local_repo_root" ? "/repo" : "/repo/saved-worktree/";
    const record: WorkspaceSession = {
      ...createWorkspaceSessionRecord(),
      externalSessionId: "selected-chat",
      executionTarget:
        kind === "local_repo_root"
          ? { kind, workingDirectory: directory }
          : { kind, workingDirectory: directory, branchName: "work", worktreeState: "present" },
    };
    const identity = workspaceSessionIdentity(record)!;
    const receipt = createAgentMessageSendReceipt(identity);
    const send = mock<AgentOperationsContextValue["sendAgentMessage"]>(async () => receipt);
    const view = await renderChatPanes(
      record,
      async () => {
        throw new Error("Unexpected draft startup");
      },
      createAgentOperationsFixture({ sendAgentMessage: send }),
    );
    const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
    try {
      let accepted: AgentMessageSendReceipt | false | undefined;
      await act(async () => {
        accepted = await requestWorkspaceGitConflictAssistance({
          workspace,
          record,
          actions: {
            workspace,
            record,
            send: view.actions.sendStandaloneMessage,
            assertCanSubmit: () => {},
            blockedReason: null,
            isStarting: false,
          },
          conflict: {
            operation: "direct_merge_squash",
            workingDir: directory,
            currentBranch: "work",
            targetBranch: "main",
            conflictedFiles: ["src/file.ts"],
            output: "CONFLICT in src/file.ts",
          },
          assertCurrent: () => {},
        });
      });
      expect(accepted).toEqual(receipt);
      const parts = send.mock.calls[0]?.[1];
      const text = parts?.[0]?.kind === "text" ? parts[0].text : "";
      expect(text).toContain(`Working directory: ${directory}`);
      expect(text).toContain("direct squash merge");
      expect(text).toContain("src/file.ts");
      expect(send).toHaveBeenCalledWith(
        identity,
        expect.any(Array),
        expect.objectContaining({
          sessionScope: { kind: "repository" },
          assertCanSubmit: expect.any(Function),
        }),
      );
    } finally {
      view.dispose();
    }
  },
);

const createWorkspaceSessionRecord = (): WorkspaceSession => ({
  id: "draft",
  runtimeKind: "codex",
  externalSessionId: null,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  selectedModel: null,
  roleSnapshot: null,
  generatedTitle: null,
  manualTitle: null,
  targetBranch: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

const createSessionOneRecord = (): WorkspaceSession => ({
  ...createWorkspaceSessionRecord(),
  runtimeKind: "opencode",
  externalSessionId: "session-1",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo/worktree" },
});

test.each([
  ["hidden", true],
  ["removed", true],
  ["unmounted", true],
] as const)("pending draft send with pane %s, already bound=%s", async (change, alreadyBound) => {
  const record = {
    ...createWorkspaceSessionRecord(),
    externalSessionId: alreadyBound ? "native" : null,
  };
  const start = mock(async () => ({
    session: { ...record, externalSessionId: "native" },
    runtimeSession: null,
  }));
  const send = mock(async () => null);
  const view = await renderChatPanes(
    record,
    start,
    createAgentOperationsFixture({ sendAgentMessage: send }),
  );
  let result!: Promise<AgentChatSendResult>;
  try {
    act(() => {
      result = view.actions.send({ segments: [createTextSegment("Hello")] }, "default");
    });
    if (change === "unmounted") view.unmount();
    else {
      const other = { ...record, id: "other" };
      view.select(other, change === "removed" ? [other.id] : [record.id, other.id]);
    }
    await act(async () => {
      await result;
    });
    expect(start).toHaveBeenCalledTimes(change === "hidden" && !alreadyBound ? 1 : 0);
    expect(send).toHaveBeenCalledTimes(change === "hidden" && alreadyBound ? 1 : 0);
    expect(await result).toBe(change === "hidden");
  } finally {
    view.dispose();
  }
});

test.each([
  ["send", "accepted"],
  ["send", "rejected"],
] as const)("keeps an in-flight %s result after pane removal: %s", async (phase, outcome) => {
  const record = {
    ...createWorkspaceSessionRecord(),
    manualTitle: "Test chat",
    externalSessionId: "native",
  };
  const bound = { ...record, externalSessionId: "native" };
  const pending = Promise.withResolvers<void>();
  const start = mock(async () => {
    return { session: bound, runtimeSession: null };
  });
  const send = mock(async () => {
    if (phase === "send") await pending.promise;
    return null;
  });
  const failure = spyOn(toast, "error").mockImplementation(() => "failure");
  const view = await renderChatPanes(
    record,
    start,
    createAgentOperationsFixture({ sendAgentMessage: send }),
  );
  let result!: Promise<AgentChatSendResult>;
  try {
    await act(async () => {
      result = view.actions.send({ segments: [createTextSegment("Hello")] }, "default");
    });
    expect(send).toHaveBeenCalledTimes(1);
    view.select({ ...record, id: "other" }, ["other"]);
    await act(async () => {
      if (outcome === "accepted") pending.resolve();
      else pending.reject(new Error("Request failed. Reopen the chat to retry."));
      await result;
    });
    expect(await result).toBe(outcome === "accepted");
    expect(send).toHaveBeenCalledTimes(1);
    if (outcome === "rejected") {
      expect(failure).toHaveBeenCalledWith('Could not send to "Test chat"', {
        description: "Request failed. Reopen the chat to retry.",
      });
    } else expect(failure).not.toHaveBeenCalled();
  } finally {
    view.dispose();
    failure.mockRestore();
  }
});

test.each([
  ["hidden", "host"],
  ["removed", "host"],
  ["removed", "accepted"],
  ["unmounted", "plain"],
] as const)("shows the %s pane's late resume result: %s", async (change, outcome) => {
  const record = {
    ...createWorkspaceSessionRecord(),
    manualTitle: "Test chat",
    externalSessionId: "native",
  };
  const pending = Promise.withResolvers<void>();
  const failure = spyOn(toast, "error").mockImplementation(() => "failure");
  const resume = mock(() => pending.promise);
  const view = await renderChatPanes(
    record,
    async () => {
      throw new Error("Unexpected start");
    },
    createAgentOperationsFixture({ continueInterruptedTurn: resume }),
  );
  try {
    act(() =>
      view.actions.resumeInterruptedTurn({
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "native",
      }),
    );
    expect(resume).toHaveBeenCalledTimes(1);
    expect(view.actions.isResumingSession).toBe(true);
    if (change === "unmounted") view.unmount();
    else {
      view.select(
        { ...record, id: "other" },
        change === "removed" ? ["other"] : [record.id, "other"],
      );
    }
    await act(async () => {
      if (outcome === "accepted") pending.resolve();
      else if (outcome === "plain")
        pending.reject(new Error("Connection lost. Reopen the chat to retry."));
      else
        pending.reject(
          new HostInvokeError("Continuation unconfirmed", {
            kind: "agent_session_resume",
            agentSessionResumeFailure: {
              reason: "runtime_unavailable",
              sessionRef: {
                repoPath: "/repo",
                runtimeKind: "codex",
                workingDirectory: "/repo",
                externalSessionId: "native",
              },
              operation: "agent-session.continue-interrupted-turn",
              message: "The runtime did not confirm the continuation.",
              nextAction: "Inspect the runtime and this session.",
            },
          }),
        );
    });
    if (change === "hidden") {
      view.select(record);
      expect(view.actions.isResumingSession).toBe(false);
      expect(view.actions.persistentResumeError).toBe(
        "The runtime did not confirm the continuation. Inspect the runtime and this session.",
      );
      expect(failure).not.toHaveBeenCalled();
    } else if (outcome === "accepted") expect(failure).not.toHaveBeenCalled();
    else
      expect(failure).toHaveBeenCalledWith('Could not resume "Test chat"', {
        description:
          outcome === "plain"
            ? "Connection lost. Reopen the chat to retry."
            : "The runtime did not confirm the continuation. Inspect the runtime and this session.",
      });
  } finally {
    view.dispose();
    failure.mockRestore();
  }
});

test.each([
  ["send", "accepted"],
  ["send", "rejected"],
  ["model", "accepted"],
  ["model", "rejected"],
] as const)("settles a hidden chat's %s state after %s", async (action, outcome) => {
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
  const record =
    action === "send"
      ? { ...createWorkspaceSessionRecord(), externalSessionId: "native" }
      : createWorkspaceSessionRecord();
  const bound = { ...record, externalSessionId: "native" };
  const store = createAgentSessionsStore("/repo");
  const identity = workspaceSessionIdentity(record);
  if (identity)
    store.replaceSession(createAgentSessionFixture({ ...identity, historyLoadState: "loaded" }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pending = Promise.withResolvers<void>();
  const operations = createAgentOperationsFixture({
    sendAgentMessage: async () => {
      await pending.promise;
      return null;
    },
  });
  const connection = createTestClientConnection({
    queryClient,
    client: {
      workspaceSessionStart: async () => ({ session: record, runtimeSession: null }),
      workspaceSessionSetDraftModel: async () => {
        await pending.promise;
        return bound;
      },
    },
  });
  let sendResult: Promise<AgentChatSendResult> | undefined;
  let actions!: ReturnType<typeof useWorkspaceChat>;
  const Probe = () => {
    actions = useWorkspaceChat(workspace, record, () => true);
    return null;
  };
  const view = (mode: "visible" | "hidden") => (
    <ClientConnectionProvider connection={connection}>
      <AgentSessionsContext value={store}>
        <AgentChatSendProviders operations={operations}>
          <Activity mode={mode}>
            <Probe />
          </Activity>
        </AgentChatSendProviders>
      </AgentSessionsContext>
    </ClientConnectionProvider>
  );
  const rendered = render(view("visible"));
  await act(async () => {});
  try {
    await act(async () => {
      if (action !== "model") {
        sendResult = actions.send({ segments: [createTextSegment("Hello")] }, "default");
      } else {
        actions.updateDraftModel({ providerId: "openai", modelId: "gpt-5" });
      }
    });
    expect(action !== "model" ? actions.isSending : actions.isSavingModel).toBe(true);
    rendered.rerender(view("hidden"));
    await act(async () => {
      if (outcome === "accepted") pending.resolve();
      else pending.reject(new Error("Request failed"));
    });
    rendered.rerender(view("visible"));
    expect(actions.isSending).toBe(false);
    expect(actions.isStarting).toBe(false);
    expect(actions.isSavingModel).toBe(false);
    expect(actions.error).toBe(outcome === "rejected" ? "Request failed" : null);
    if (action !== "model") expect(await sendResult).toBe(outcome === "accepted");
  } finally {
    rendered.unmount();
    queryClient.clear();
  }
});

test.each([false, true])("saves a speed change without the model lock, live=%p", async (live) => {
  const record = createWorkspaceSessionRecord();
  const pending = Promise.withResolvers<void>();
  const saveDraft = mock(async () => {
    await pending.promise;
    return record;
  });
  const updateLive = mock(async () => {
    await pending.promise;
  });
  const view = renderWorkspaceChat(
    () => useWorkspaceSessionChatActions(WORKSPACE, record, () => true),
    createAgentOperationsFixture({ updateAgentSessionModel: updateLive }),
    undefined,
    { workspaceSessionSetDraftModel: saveDraft },
  );
  const identity = live
    ? workspaceSessionIdentity({ ...record, externalSessionId: "native" })
    : null;
  const selection = { providerId: "codex", modelId: "gpt-5", speed: "priority" };
  try {
    let update!: Promise<void>;
    act(() => {
      update = view.result.current.updateSpeed(identity, selection);
    });
    expect(view.result.current.isSavingModel).toBe(false);
    await act(async () => {
      pending.resolve();
      await update;
    });
    expect((live ? updateLive : saveDraft).mock.calls).toHaveLength(1);
    expect((live ? saveDraft : updateLive).mock.calls).toHaveLength(0);
  } finally {
    view.dispose();
  }
});

test("blocks a second resume selection before the first one settles", async () => {
  let resolveContinuation = (): void => {};
  let continuations = 0;
  const operations = createAgentOperationsFixture({
    continueInterruptedTurn: () => {
      continuations += 1;
      return new Promise<void>((resolve) => {
        resolveContinuation = resolve;
      });
    },
  });
  const record = createSessionOneRecord();
  const view = renderWorkspaceChat(
    () => useWorkspaceSessionChatActions(WORKSPACE, record, () => true),
    operations,
  );

  try {
    act(() => {
      view.result.current.resumeInterruptedTurn({
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      });
      view.result.current.resumeInterruptedTurn({
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      });
    });

    expect(continuations).toBe(1);
    expect(view.result.current.isResumingSession).toBe(true);

    await act(async () => {
      resolveContinuation();
    });

    expect(view.result.current.isResumingSession).toBe(false);
    expect(continuations).toBe(1);
  } finally {
    view.dispose();
  }
});

test("shows the host reason and next action when a continuation is refused", async () => {
  const failure = new HostInvokeError("Continuation refused", {
    kind: "agent_session_resume",
    agentSessionResumeFailure: {
      reason: "completed_turn",
      sessionRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
      operation: "agent-session.continue-interrupted-turn",
      message: "OpenCode session 'session-1' has a completed latest turn.",
      nextAction: "Send a new message to start new work.",
    },
  });
  const operations = createAgentOperationsFixture({
    continueInterruptedTurn: async () => {
      throw failure;
    },
  });
  const record = createSessionOneRecord();
  const view = renderWorkspaceChat(
    () => useWorkspaceSessionChatActions(WORKSPACE, record, () => true),
    operations,
  );

  try {
    await act(async () => {
      view.result.current.resumeInterruptedTurn({
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      });
    });

    expect(view.result.current.resumeSessionError).toBe(
      "OpenCode session 'session-1' has a completed latest turn. Send a new message to start new work.",
    );
    expect(view.result.current.persistentResumeError).toBeNull();
    expect(view.result.current.isResumingSession).toBe(false);
  } finally {
    view.dispose();
  }
});

test("keeps an unconfirmed continuation failure after the Resume action settles", async () => {
  const failure = new HostInvokeError("Continuation unconfirmed", {
    kind: "agent_session_resume",
    agentSessionResumeFailure: {
      reason: "runtime_unavailable",
      sessionRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
      operation: "agent-session.continue-interrupted-turn",
      message: "The runtime did not confirm the continuation.",
      nextAction: "Inspect the runtime and this session.",
    },
  });
  const operations = createAgentOperationsFixture({
    continueInterruptedTurn: async () => {
      throw failure;
    },
  });
  const record = createSessionOneRecord();
  const view = renderWorkspaceChat(
    () => useWorkspaceSessionChatActions(WORKSPACE, record, () => true),
    operations,
  );

  try {
    await act(async () => {
      view.result.current.resumeInterruptedTurn({
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      });
    });

    expect(view.result.current.persistentResumeError).toBe(
      "The runtime did not confirm the continuation. Inspect the runtime and this session.",
    );
  } finally {
    view.dispose();
  }
});

test("clears an unconfirmed continuation failure when the transcript settles", async () => {
  const failure = new HostInvokeError("Continuation unconfirmed", {
    kind: "agent_session_resume",
    agentSessionResumeFailure: {
      reason: "runtime_unavailable",
      sessionRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
      operation: "agent-session.continue-interrupted-turn",
      message: "The runtime did not confirm the continuation.",
      nextAction: "Inspect the runtime and this session.",
    },
  });
  const sessionIdentity = {
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo/worktree",
    externalSessionId: "session-1",
  };
  const userMessage: AgentChatMessage = {
    id: "user-1",
    role: "user",
    content: "Continue please",
    timestamp: "2026-09-12T10:00:00.000Z",
  };
  const finalAssistantMessage: AgentChatMessage = {
    id: "assistant-1",
    role: "assistant",
    content: "Done",
    timestamp: "2026-09-12T10:01:00.000Z",
    meta: { kind: "assistant", isFinal: true },
  };
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(
    createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      messages: [userMessage],
    }),
  );
  const operations = createAgentOperationsFixture({
    continueInterruptedTurn: async () => {
      throw failure;
    },
  });
  const record = createSessionOneRecord();
  const view = renderWorkspaceChat(
    () => useWorkspaceSessionChatActions(WORKSPACE, record, () => true),
    operations,
    store,
  );

  try {
    await act(async () => {
      view.result.current.resumeInterruptedTurn(sessionIdentity);
    });

    expect(view.result.current.persistentResumeError).toBe(
      "The runtime did not confirm the continuation. Inspect the runtime and this session.",
    );

    await act(async () => {
      store.updateSession(sessionIdentity, (current) => ({
        ...current,
        messages: createSessionMessagesFixture("session-1", [userMessage, finalAssistantMessage]),
      }));
    });

    expect(view.result.current.resumeSessionError).toBeNull();
    expect(view.result.current.persistentResumeError).toBeNull();
  } finally {
    view.dispose();
  }
});

async function renderChatPanes(
  record: WorkspaceSession,
  start: () => Promise<{ session: WorkspaceSession; runtimeSession: null }>,
  operations: AgentOperationsContextValue,
) {
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
  const store = createAgentSessionsStore("/repo");
  const identity = workspaceSessionIdentity(record);
  if (identity)
    store.replaceSession(createAgentSessionFixture({ ...identity, historyLoadState: "loaded" }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(
    settingsSnapshotQueryOptions().queryKey,
    createSettingsSnapshotFixture(),
  );
  queryClient.setQueryData(workspaceSessionQueryKeys.list(workspace.workspaceId, false), [record]);
  const connection = createTestClientConnection({
    queryClient,
    client: {
      workspaceSessionStart: async () =>
        record.externalSessionId ? { session: record, runtimeSession: null } : start(),
    },
  });
  let actions!: ReturnType<typeof useWorkspaceChat>;
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation((props) => {
    const current = useWorkspaceChat(props.workspace, props.record, props.isMounted);
    if (props.record.id === record.id) actions = current;
    return <></>;
  });
  const refresh = () => {};
  const selectFile = () => {};
  let sessionIds = [record.id];
  const records = new Map([[record.id, record]]);
  function Content({ current }: { current: WorkspaceSession }): ReactElement {
    return (
      <>
        {sessionIds.map((id) => {
          const pane = records.get(id);
          if (!pane) throw new Error(`Missing test record: ${id}`);
          return (
            <SessionViewContext key={id} value={{ id, isActive: id === current.id }}>
              <WorkspaceSessionChatPane
                workspace={workspace}
                record={pane}
                isActive={id === current.id}
                workingDirectory="/repo"
                branchKey="main"
                onToolRefresh={refresh}
                onSelectFile={selectFile}
              />
            </SessionViewContext>
          );
        })}
      </>
    );
  }
  const content = (current: WorkspaceSession) => (
    <ClientConnectionProvider connection={connection}>
      <AgentSessionsContext value={store}>
        <AgentChatSendProviders operations={operations}>
          <Content current={current} />
        </AgentChatSendProviders>
      </AgentSessionsContext>
    </ClientConnectionProvider>
  );
  const view = render(content(record));
  await act(async () => {});
  return {
    queryClient,
    store,
    get actions() {
      return actions;
    },
    unmount: view.unmount,
    select(next: WorkspaceSession, ids = [...sessionIds, next.id]) {
      sessionIds = [...new Set(ids)];
      records.set(next.id, next);
      view.rerender(content(next));
    },
    dispose() {
      view.unmount();
      chat.mockRestore();
      queryClient.clear();
    },
  };
}
