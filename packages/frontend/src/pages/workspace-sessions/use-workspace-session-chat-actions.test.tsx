import { expect, mock, spyOn, test } from "bun:test";
import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type WorkspaceSession,
  type WorkspaceSessionLaunchRequest,
  type WorkspaceSessionLaunchResult,
} from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import { act, render, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity, type PropsWithChildren } from "react";
import { toast } from "sonner";
import { createTextSegment } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentSessionsContext } from "@/state/app-state-contexts";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { workspaceSessionQueryKeys } from "@/state/queries/workspace-sessions";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import type { AgentMessageSendReceipt, AgentChatMessage } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, AgentOperationsContextValue } from "@/types/state-slices";
import { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import { useAgentChatSendForTarget } from "@/test-utils/agent-chat-send-fixture";
import { AgentChatSendProviders } from "@/test-utils/agent-chat-send-providers";
import { createAgentOperationsFixture } from "@/test-utils/agent-operations-fixture";
import {
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import {
  createSessionMessagesFixture,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import * as sessionChat from "./workspace-session-chat";
import { WorkspaceSessionChatPanes } from "./workspace-session-chat-panes";
import { createAgentMessageSendReceipt } from "@/test-utils/agent-message-send-fixture";
import { GitConflictRequestCancelled } from "@/features/git-conflict-resolution/conflict-assistance";
import { requestWorkspaceGitConflictAssistance } from "./workspace-git-conflict-assistance";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";

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
      prepareModelForSend: async () => () => {},
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
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext value={store}>
        <AgentChatSendProviders operations={operations}>{children}</AgentChatSendProviders>
      </AgentSessionsContext>
    </QueryClientProvider>
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
    const view = renderChatPanes(
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

test.each([false, true])(
  "a submitted conflict launch completes after context changes, workspace changed=%s",
  async (workspaceChanged) => {
    const record = createWorkspaceSessionRecord();
    const bound = { ...record, externalSessionId: "started-draft" };
    const startup = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const send = mock(async () => createAgentMessageSendReceipt(workspaceSessionIdentity(bound)!));
    const view = renderChatPanes(
      record,
      async () => {
        entered.resolve();
        await startup.promise;
        return { session: bound, runtimeSession: null };
      },
      createAgentOperationsFixture({ sendAgentMessage: send }),
    );
    let current = true;
    let outcome: unknown;
    let pending!: Promise<void>;
    try {
      act(() => {
        pending = view.actions
          .sendStandaloneMessage([{ kind: "text", text: "Resolve conflict" }], {
            assertCurrent: () => {
              if (!current) throw new GitConflictRequestCancelled();
            },
          })
          .then(
            (receipt) => {
              outcome = receipt;
            },
            (cause) => {
              outcome = cause;
            },
          );
      });
      await entered.promise;
      current = false;
      view.select({ ...record, id: "other-chat" });
      if (workspaceChanged) view.store.resetWorkspace("/other");
      await act(async () => {
        startup.resolve();
        await pending;
      });
      expect(outcome).toEqual(
        expect.objectContaining({
          recipient: workspaceSessionIdentity(bound),
          acceptedMessage: expect.any(Object),
        }),
      );
      expect(send).not.toHaveBeenCalled();
      expect(
        view.queryClient.getQueryData<WorkspaceSession[]>(
          workspaceSessionQueryKeys.list("workspace", false),
        ),
      ).toEqual([bound]);
      expect(view.store.listSessionSnapshots().map((session) => session.externalSessionId)).toEqual(
        workspaceChanged ? [] : ["started-draft"],
      );
    } finally {
      startup.resolve();
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
  ["hidden", false],
  ["hidden", true],
  ["removed", false],
  ["removed", true],
  ["evicted", false],
  ["evicted", true],
  ["unmounted", false],
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
  const view = renderChatPanes(
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
    else if (change === "evicted") {
      for (let index = 0; index < 6; index += 1) {
        view.select({ ...record, id: `other-${index}` });
      }
    } else {
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
  ["start", "accepted"],
  ["start", "rejected"],
  ["send", "accepted"],
  ["send", "rejected"],
] as const)("keeps an in-flight %s result after pane removal: %s", async (phase, outcome) => {
  const record = {
    ...createWorkspaceSessionRecord(),
    manualTitle: "Test chat",
    externalSessionId: phase === "send" ? "native" : null,
  };
  const bound = { ...record, externalSessionId: "native" };
  const pending = Promise.withResolvers<void>();
  const start = mock(async () => {
    if (phase === "start") await pending.promise;
    return { session: bound, runtimeSession: null };
  });
  const send = mock(async () => {
    if (phase === "send") await pending.promise;
    return null;
  });
  const failure = spyOn(toast, "error").mockImplementation(() => "failure");
  const view = renderChatPanes(
    record,
    start,
    createAgentOperationsFixture({ sendAgentMessage: send }),
  );
  let result!: Promise<AgentChatSendResult>;
  try {
    await act(async () => {
      result = view.actions.send({ segments: [createTextSegment("Hello")] }, "default");
    });
    expect(phase === "start" ? start : send).toHaveBeenCalledTimes(1);
    view.select({ ...record, id: "other" }, ["other"]);
    await act(async () => {
      if (outcome === "accepted") pending.resolve();
      else pending.reject(new Error("Request failed. Reopen the chat to retry."));
      await result;
    });
    expect(await result).toBe(outcome === "accepted");
    expect(send).toHaveBeenCalledTimes(phase === "send" ? 1 : 0);
    if (phase === "start" && outcome === "accepted") {
      expect(
        view.queryClient.getQueryData<WorkspaceSession[]>(
          workspaceSessionQueryKeys.list("workspace", false),
        ),
      ).toEqual([bound]);
      expect(view.store.listSessionSnapshots().map((session) => session.externalSessionId)).toEqual(
        ["native"],
      );
    }
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
  ["evicted", "host"],
  ["unmounted", "plain"],
  ["evicted", "accepted"],
] as const)("shows the %s pane's late resume result: %s", async (change, outcome) => {
  const record = {
    ...createWorkspaceSessionRecord(),
    manualTitle: "Test chat",
    externalSessionId: "native",
  };
  const pending = Promise.withResolvers<void>();
  const failure = spyOn(toast, "error").mockImplementation(() => "failure");
  const resume = mock(() => pending.promise);
  const view = renderChatPanes(
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
    else if (change === "evicted") {
      for (let index = 0; index < 6; index += 1) view.select({ ...record, id: `other-${index}` });
    } else {
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
  ["send", "accepted", false],
  ["send", "rejected", false],
  ["model", "accepted", false],
  ["model", "rejected", false],
  ["start", "accepted", false],
  ["start", "rejected", false],
  ["start", "accepted", true],
] as const)(
  "settles a hidden chat's %s state after %s, workspace changed=%s",
  async (action, outcome, workspaceChanged) => {
    const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
    const record = createWorkspaceSessionRecord();
    const bound = { ...record, externalSessionId: "native" };
    const store = createAgentSessionsStore("/repo");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const pending = Promise.withResolvers<void>();
    const operations = createAgentOperationsFixture({
      sendAgentMessage: async () => {
        if (action !== "start") await pending.promise;
        return null;
      },
    });
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionLaunch: async (request) => {
            await pending.promise;
            return launchOutcome(request, bound);
          },
          workspaceSessionSetDraftModel: async () => {
            await pending.promise;
            return bound;
          },
        },
      }),
    );
    let sendResult: Promise<AgentChatSendResult> | undefined;
    let actions!: ReturnType<typeof useWorkspaceChat>;
    const Probe = () => {
      actions = useWorkspaceChat(workspace, record, () => true);
      return null;
    };
    const view = (mode: "visible" | "hidden") => (
      <QueryClientProvider client={queryClient}>
        <AgentSessionsContext value={store}>
          <AgentChatSendProviders operations={operations}>
            <Activity mode={mode}>
              <Probe />
            </Activity>
          </AgentChatSendProviders>
        </AgentSessionsContext>
      </QueryClientProvider>
    );
    const rendered = render(view("visible"));
    try {
      await act(async () => {
        if (action !== "model") {
          sendResult = actions.send({ segments: [createTextSegment("Hello")] }, "default");
        } else {
          actions.updateDraftModel({ providerId: "openai", modelId: "gpt-5" });
        }
      });
      expect(
        action !== "model" ? actions.isSending && actions.isStarting : actions.isSavingModel,
      ).toBe(true);
      rendered.rerender(view("hidden"));
      if (workspaceChanged) store.resetWorkspace("/other");
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
      if (workspaceChanged) expect(store.listSessionSnapshots()).toEqual([]);
    } finally {
      rendered.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

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
  configureShellBridge(
    createShellBridgeFixture({ client: { workspaceSessionSetDraftModel: saveDraft } }),
  );
  const view = renderWorkspaceChat(
    () => useWorkspaceSessionChatActions(WORKSPACE, record, () => true),
    createAgentOperationsFixture({ updateAgentSessionModel: updateLive }),
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
    configureShellBridge(createUnavailableShellBridge());
  }
});

const firstSendCases: Array<{
  name: string;
  launch: (
    request: WorkspaceSessionLaunchRequest,
    bound: WorkspaceSession,
  ) => WorkspaceSessionLaunchResult;
  sent: boolean;
  error: string | null;
  sessions: number;
  userMessages: number;
}> = [
  {
    name: "an accepted launch keeps the draft cleared",
    launch: launchOutcome,
    sent: true,
    error: null,
    sessions: 1,
    userMessages: 1,
  },
  {
    name: "a rejected first message restores the draft and shows the error",
    launch: (request, bound) => {
      const { acceptedMessage: _accepted, ...result } = launchOutcome(request, bound);
      return {
        ...result,
        status: "failed",
        unsentInstruction: request.parts,
        failure: { message: "Send failed", cleanupErrors: [] },
      };
    },
    sent: false,
    error: "Send failed",
    sessions: 1,
    userMessages: 0,
  },
  {
    name: "an accepted message with a later failure keeps the draft cleared and shows the error",
    launch: (request, bound) => ({
      ...launchOutcome(request, bound),
      status: "failed",
      failure: { message: "Stream closed after acceptance", cleanupErrors: [] },
    }),
    sent: true,
    error: "Stream closed after acceptance",
    sessions: 1,
    userMessages: 1,
  },
  {
    name: "an accepted message with failed cleanup keeps the draft cleared and names the cleanup step",
    launch: (request, bound) => ({
      ...launchOutcome(request, bound),
      status: "failed",
      failure: {
        message: "Session launch cleanup failed.",
        cleanupErrors: ["Failed to release session hold; restart the runtime."],
      },
    }),
    sent: true,
    error:
      "Session launch cleanup failed. Cleanup failed: Failed to release session hold; restart the runtime.",
    sessions: 1,
    userMessages: 1,
  },
  {
    name: "a rejected first message with failed cleanup restores the draft and names the cleanup step",
    launch: (request, bound) => {
      const { acceptedMessage: _accepted, ...result } = launchOutcome(request, bound);
      return {
        ...result,
        status: "failed",
        unsentInstruction: request.parts,
        failure: { message: "Send failed", cleanupErrors: ["Stop failed; stop the session."] },
      };
    },
    sent: false,
    error: "Send failed Cleanup failed: Stop failed; stop the session.",
    sessions: 1,
    userMessages: 0,
  },
  {
    name: "a launch without a saved session restores the draft and shows the error",
    launch: (request) => ({
      workspaceId: request.workspaceId,
      repoPath: request.repoPath,
      sessionId: request.sessionId,
      status: "failed",
      unsentInstruction: request.parts,
      failure: { message: "Runtime is offline", cleanupErrors: [] },
    }),
    sent: false,
    error: "Runtime is offline",
    sessions: 0,
    userMessages: 0,
  },
  {
    name: "a transport error restores the draft and shows the error",
    launch: () => {
      throw new Error("Disconnected");
    },
    sent: false,
    error: "Disconnected",
    sessions: 0,
    userMessages: 0,
  },
];

test.each(firstSendCases)("first draft send: $name", async (testCase) => {
  const record = createWorkspaceSessionRecord();
  const bound = { ...record, externalSessionId: "native" };
  const browserSend = mock(async () => null);
  const launch = mock(async (request: WorkspaceSessionLaunchRequest) =>
    testCase.launch(request, bound),
  );
  configureShellBridge(createShellBridgeFixture({ client: { workspaceSessionLaunch: launch } }));
  const view = renderWorkspaceChat(
    () => useWorkspaceChat(WORKSPACE, record, () => true),
    createAgentOperationsFixture({ sendAgentMessage: browserSend }),
  );
  try {
    let sent: AgentChatSendResult | undefined;
    await act(async () => {
      sent = await view.result.current.send({ segments: [createTextSegment("Hello")] }, "default");
    });
    expect(sent).toBe(testCase.sent);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]?.[0]).toEqual({
      workspaceId: "workspace",
      repoPath: "/repo",
      sessionId: "draft",
      parts: [{ kind: "text", text: "Hello" }],
    });
    expect(browserSend).not.toHaveBeenCalled();
    expect(view.result.current.error).toBe(testCase.error);
    expect(view.result.current.isSending).toBe(false);
    expect(view.result.current.isStarting).toBe(false);
    const sessions = view.store.listSessionSnapshots();
    expect(sessions).toHaveLength(testCase.sessions);
    const messages = sessions[0] ? sessionMessagesToArray(sessions[0]) : [];
    expect(messages.filter((message) => message.role === "user")).toHaveLength(
      testCase.userMessages,
    );
  } finally {
    view.dispose();
    configureShellBridge(createUnavailableShellBridge());
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

function renderChatPanes(
  record: WorkspaceSession,
  start: () => Promise<{ session: WorkspaceSession; runtimeSession: null }>,
  operations: AgentOperationsContextValue,
) {
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(
    settingsSnapshotQueryOptions().queryKey,
    createSettingsSnapshotFixture(),
  );
  queryClient.setQueryData(workspaceSessionQueryKeys.list(workspace.workspaceId, false), [record]);
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        workspaceSessionLaunch: async (request) => launchOutcome(request, (await start()).session),
      },
    }),
  );
  let actions!: ReturnType<typeof useWorkspaceChat>;
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation((props) => {
    const current = useWorkspaceChat(props.workspace, props.record, props.isMounted);
    if (props.record.id === record.id) actions = current;
    return <></>;
  });
  const refresh = () => {};
  const selectFile = () => {};
  let sessionIds = [record.id];
  const content = (current: WorkspaceSession) => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext value={store}>
        <AgentChatSendProviders operations={operations}>
          <WorkspaceSessionChatPanes
            workspace={workspace}
            record={current}
            sessionIds={sessionIds}
            workingDirectory="/repo"
            branchKey="main"
            onToolRefresh={refresh}
            onSelectFile={selectFile}
          />
        </AgentChatSendProviders>
      </AgentSessionsContext>
    </QueryClientProvider>
  );
  const view = render(content(record));
  return {
    queryClient,
    store,
    get actions() {
      return actions;
    },
    unmount: view.unmount,
    select(next: WorkspaceSession, ids = [...sessionIds, next.id]) {
      sessionIds = ids;
      view.rerender(content(next));
    },
    dispose() {
      view.unmount();
      chat.mockRestore();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    },
  };
}

function launchOutcome(
  request: WorkspaceSessionLaunchRequest,
  record: WorkspaceSession,
): WorkspaceSessionLaunchResult {
  const session = {
    externalSessionId: record.externalSessionId!,
    runtimeKind: record.runtimeKind,
    workingDirectory: record.executionTarget.workingDirectory,
    startedAt: new Date(record.createdAt).toISOString(),
    status: "idle" as const,
  };
  return {
    workspaceId: request.workspaceId,
    repoPath: request.repoPath,
    sessionId: record.id,
    status: "completed",
    record,
    session,
    acceptedMessage: {
      type: "user_message",
      externalSessionId: session.externalSessionId,
      messageId: "accepted-1",
      timestamp: session.startedAt,
      message: "Hello",
      parts: [],
      state: "read",
    },
  };
}
