import { expect, mock, spyOn, test } from "bun:test";
import type {
  WorkspaceSession,
  WorkspaceSessionLaunchRequest,
  WorkspaceSessionLaunchSnapshot,
} from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import { act, render, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity, type PropsWithChildren } from "react";
import { toast } from "sonner";
import { createTextSegment } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentOperationsContext, AgentSessionsContext } from "@/state/app-state-contexts";
import { workspaceSessionQueryKeys } from "@/state/queries/workspace-sessions";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import type { AgentMessageSendReceipt, AgentChatMessage } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
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
      createOperations({ sendAgentMessage: send, continueInterruptedTurn: async () => {} }),
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
      createOperations({ sendAgentMessage: send, continueInterruptedTurn: async () => {} }),
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

const createOperations = (
  overrides: Pick<AgentOperationsContextValue, "sendAgentMessage" | "continueInterruptedTurn">,
): AgentOperationsContextValue => ({
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
    throw new Error("Unexpected todos read");
  },
  readSessionHistory: async () => {
    throw new Error("Unexpected history read");
  },
  loadAgentSessionHistory: async () => {
    throw new Error("Unexpected history load");
  },
  loadAgentSessionContext: async () => {
    throw new Error("Unexpected context read");
  },
  startAgentSession: async () => {
    throw new Error("Unexpected workflow start");
  },
  stopAgentSession: async () => {},
  updateAgentSessionModel: async () => {},
  replyAgentApproval: async () => {},
  answerAgentQuestion: async () => {},
  ...overrides,
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
    createOperations({ sendAgentMessage: send, continueInterruptedTurn: async () => {} }),
  );
  let result!: Promise<AgentChatSendResult>;
  try {
    act(() => {
      result = view.actions.sendDraft(
        { segments: [createTextSegment("Hello")] },
        {
          canSend: true,
          reusablePrompts: [],
          selectedModelDescriptor: null,
          supportsAttachments: false,
        },
      );
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
    createOperations({ sendAgentMessage: send, continueInterruptedTurn: async () => {} }),
  );
  let result!: Promise<AgentChatSendResult>;
  try {
    await act(async () => {
      result = view.actions.sendDraft(
        { segments: [createTextSegment("Hello")] },
        {
          canSend: true,
          reusablePrompts: [],
          selectedModelDescriptor: null,
          supportsAttachments: false,
        },
      );
    });
    expect(phase === "start" ? start : send).toHaveBeenCalledTimes(1);
    view.select({ ...record, id: "other" }, ["other"]);
    await act(async () => {
      if (outcome === "accepted") pending.resolve();
      else pending.reject(new Error("Request failed. Reopen the chat to retry."));
      await result;
    });
    expect(await result).toBe(phase === "start" || outcome === "accepted");
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
        description:
          phase === "start"
            ? expect.stringContaining("Inspect launch")
            : "Request failed. Reopen the chat to retry.",
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
    createOperations({
      sendAgentMessage: async () => null,
      continueInterruptedTurn: resume,
    }),
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
    const operations = createOperations({
      sendAgentMessage: async () => {
        if (action !== "start") await pending.promise;
        return null;
      },
      continueInterruptedTurn: async () => {},
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
    let actions!: ReturnType<typeof useWorkspaceSessionChatActions>;
    const Probe = () => {
      actions = useWorkspaceSessionChatActions(workspace, record, () => true);
      return null;
    };
    const view = (mode: "visible" | "hidden") => (
      <QueryClientProvider client={queryClient}>
        <AgentSessionsContext value={store}>
          <AgentOperationsContext value={operations}>
            <Activity mode={mode}>
              <Probe />
            </Activity>
          </AgentOperationsContext>
        </AgentSessionsContext>
      </QueryClientProvider>
    );
    const rendered = render(view("visible"));
    try {
      await act(async () => {
        if (action !== "model") {
          sendResult = actions.sendDraft(
            { segments: [createTextSegment("Hello")] },
            {
              canSend: true,
              reusablePrompts: [],
              selectedModelDescriptor: null,
              supportsAttachments: false,
            },
          );
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
      expect(actions.error).toEqual(
        outcome === "rejected"
          ? action === "model"
            ? "Request failed"
            : expect.stringContaining("Inspect launch")
          : null,
      );
      if (action !== "model") expect(await sendResult).toBe(true);
      if (workspaceChanged) expect(store.listSessionSnapshots()).toEqual([]);
    } finally {
      rendered.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test.each([false, true])("saves a speed change without the model lock, live=%p", async (live) => {
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
  const record = createWorkspaceSessionRecord();
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  const operations: AgentOperationsContextValue = {
    ...createOperations({
      sendAgentMessage: async () => null,
      continueInterruptedTurn: async () => {},
    }),
    updateAgentSessionModel: updateLive,
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext value={store}>
        <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
      </AgentSessionsContext>
    </QueryClientProvider>
  );
  const view = renderHook(() => useWorkspaceSessionChatActions(workspace, record, () => true), {
    wrapper,
  });
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
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test.each(["accepted", "rejected", "unknown", "unreadable", "pending"] as const)(
  "keeps the host first-send outcome: %s",
  async (acceptance) => {
    const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
    const record = createWorkspaceSessionRecord();
    const bound = { ...record, externalSessionId: "native" };
    const store = createAgentSessionsStore("/repo");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const browserSend = mock(async () => null);
    const launch = mock(async (request: WorkspaceSessionLaunchRequest) => {
      if (acceptance === "unreadable" || acceptance === "pending") throw new Error("Disconnected");
      const snapshot = launchOutcome(request, bound);
      if (acceptance !== "accepted")
        return {
          ...snapshot,
          phase: "failed" as const,
          acceptance,
          recoveryAllowed: acceptance === "rejected",
          acceptedMessage: undefined,
          failure: { message: "Send failed", stage: "send", cleanupErrors: [] },
        };
      return snapshot;
    });
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionLaunch: launch,
          workspaceSessionLaunchRead: async (ref) => {
            if (acceptance === "unreadable") throw new Error("Read failed");
            return [
              {
                ...launchOutcome(
                  { ...ref, launchAttemptId: ref.launchAttemptId!, parts: [] },
                  bound,
                ),
                phase: "sending",
                acceptance: "unknown",
                acceptedMessage: undefined,
              },
            ];
          },
        },
      }),
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <AgentSessionsContext value={store}>
          <AgentOperationsContext
            value={createOperations({
              sendAgentMessage: browserSend,
              continueInterruptedTurn: async () => {},
            })}
          >
            {children}
          </AgentOperationsContext>
        </AgentSessionsContext>
      </QueryClientProvider>
    );
    const view = renderHook(() => useWorkspaceSessionChatActions(workspace, record, () => true), {
      wrapper,
    });
    try {
      await act(async () => {
        const result = await view.result.current.sendDraft(
          { segments: [createTextSegment("Hello")] },
          {
            canSend: true,
            reusablePrompts: [],
            selectedModelDescriptor: null,
            supportsAttachments: false,
          },
        );
        if (acceptance === "rejected")
          expect(result).toMatchObject({
            kind: "recover_draft",
            launchAttemptId: launch.mock.calls[0]?.[0].launchAttemptId,
          });
        else expect(result).toBe(true);
      });
      expect(launch).toHaveBeenCalledTimes(1);
      expect(launch.mock.calls[0]?.[0]).toMatchObject({
        workspaceId: "workspace",
        repoPath: "/repo",
        sessionId: "draft",
        parts: [{ kind: "text", text: "Hello" }],
      });
      expect(browserSend).not.toHaveBeenCalled();
      const unresolved = acceptance === "unreadable" || acceptance === "pending";
      expect(store.listSessionSnapshots()).toHaveLength(unresolved ? 0 : 1);
      const session = store.listSessionSnapshots()[0];
      const messages = session ? sessionMessagesToArray(session) : [];
      expect(messages.filter((message) => message.role === "user")).toHaveLength(
        acceptance === "accepted" ? 1 : 0,
      );
      expect(view.result.current.error).toEqual(
        acceptance === "accepted"
          ? null
          : acceptance === "unknown"
            ? "Send failed Inspect the saved session before sending another instruction."
            : unresolved
              ? expect.stringContaining("Inspect launch")
              : "Send failed",
      );
    } finally {
      view.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("blocks a second resume selection before the first one settles", async () => {
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolveContinuation = (): void => {};
  let continuations = 0;
  const operations = createOperations({
    sendAgentMessage: async () => null,
    continueInterruptedTurn: () => {
      continuations += 1;
      return new Promise<void>((resolve) => {
        resolveContinuation = resolve;
      });
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext value={store}>
        <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
      </AgentSessionsContext>
    </QueryClientProvider>
  );
  const view = renderHook(
    ({ record }) => useWorkspaceSessionChatActions(workspace, record, () => true),
    {
      wrapper,
      initialProps: { record: createSessionOneRecord() },
    },
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
    view.unmount();
    queryClient.clear();
  }
});

test("shows the host reason and next action when a continuation is refused", async () => {
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
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
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const operations = createOperations({
    sendAgentMessage: async () => null,
    continueInterruptedTurn: async () => {
      throw failure;
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext value={store}>
        <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
      </AgentSessionsContext>
    </QueryClientProvider>
  );
  const view = renderHook(
    ({ record }) => useWorkspaceSessionChatActions(workspace, record, () => true),
    {
      wrapper,
      initialProps: { record: createSessionOneRecord() },
    },
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
    view.unmount();
    queryClient.clear();
  }
});

test("keeps an unconfirmed continuation failure after the Resume action settles", async () => {
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
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
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const operations = createOperations({
    sendAgentMessage: async () => null,
    continueInterruptedTurn: async () => {
      throw failure;
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext value={store}>
        <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
      </AgentSessionsContext>
    </QueryClientProvider>
  );
  const view = renderHook(
    ({ record }) => useWorkspaceSessionChatActions(workspace, record, () => true),
    {
      wrapper,
      initialProps: { record: createSessionOneRecord() },
    },
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
    view.unmount();
    queryClient.clear();
  }
});

test("clears an unconfirmed continuation failure when the transcript settles", async () => {
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const operations = createOperations({
    sendAgentMessage: async () => null,
    continueInterruptedTurn: async () => {
      throw failure;
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext value={store}>
        <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
      </AgentSessionsContext>
    </QueryClientProvider>
  );
  const view = renderHook(
    ({ record }) => useWorkspaceSessionChatActions(workspace, record, () => true),
    {
      wrapper,
      initialProps: { record: createSessionOneRecord() },
    },
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
    view.unmount();
    queryClient.clear();
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
  let actions!: ReturnType<typeof useWorkspaceSessionChatActions>;
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation((props) => {
    const current = useWorkspaceSessionChatActions(props.workspace, props.record, props.isMounted);
    if (props.record.id === record.id) actions = current;
    return <></>;
  });
  const refresh = () => {};
  const selectFile = () => {};
  let sessionIds = [record.id];
  const content = (current: WorkspaceSession) => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext value={store}>
        <AgentOperationsContext value={operations}>
          <WorkspaceSessionChatPanes
            workspace={workspace}
            record={current}
            sessionIds={sessionIds}
            workingDirectory="/repo"
            branchKey="main"
            onToolRefresh={refresh}
            onSelectFile={selectFile}
          />
        </AgentOperationsContext>
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
): WorkspaceSessionLaunchSnapshot {
  const session = {
    externalSessionId: record.externalSessionId!,
    runtimeKind: record.runtimeKind,
    workingDirectory: record.executionTarget.workingDirectory,
    startedAt: new Date(record.createdAt).toISOString(),
    status: "idle" as const,
  };
  return {
    launchAttemptId: request.launchAttemptId,
    workspaceId: request.workspaceId,
    repoPath: request.repoPath,
    sessionId: record.id,
    phase: "completed",
    acceptance: "accepted",
    ownershipSaved: true,
    record,
    session,
    acceptedMessage: {
      type: "user_message",
      externalSessionId: session.externalSessionId,
      messageId: request.launchAttemptId,
      timestamp: session.startedAt,
      message: "Hello",
      parts: [],
      state: "read",
    },
  };
}
