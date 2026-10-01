import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createWorkspaceActivityObserver } from "@/features/workspace-activity/workspace-activity-observer";
import { sessionNavigationTargetKey } from "@/features/session-navigation/session-navigation-target";
import { VisibleSessionTargetProvider } from "@/features/session-navigation/visible-session-target";
import { SessionReadStateProvider } from "@/features/session-navigation/session-read-state";
import type { HostClient } from "@openducktor/host-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import { runtimeCatalogQueryKeys } from "@/state/queries/runtime-catalog";
import { WorkspaceActivityContext } from "@/state/workspace-activity/workspace-activity-context";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import {
  createRuntimeCatalogFixture,
  createTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import { SessionNavigationList } from "./session-navigation-list";
import { SessionMenuProvider } from "./session-menu-provider";
import {
  betaWorkspace,
  navigationModel,
  NOW,
  taskSessionEntry,
  workspaceSessionEntry,
} from "./session-navigation.test-support";

const ref = {
  repoPath: betaWorkspace.repoPath,
  workingDirectory: "/repos/beta/worktrees/task",
  runtimeKind: "codex" as const,
  externalSessionId: "root",
};
const session = (overrides: Partial<AgentSessionLiveSnapshot> = {}): AgentSessionLiveSnapshot => ({
  ref,
  activity: "idle",
  title: "Ship sign in",
  startedAt: new Date(NOW - 3600000).toISOString(),
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});
const question = {
  requestId: "question-1",
  requestInstanceId: "instance-1",
  blocking: false,
  questions: [{ header: "Scope", question: "Which account types should sign in?", options: [] }],
};
const approval = {
  requestId: "approval-1",
  requestType: "command_execution" as const,
  title: "Run verification",
  command: { command: "bun run test", workingDirectory: ref.workingDirectory },
  supportedReplyOutcomes: ["approve_once", "reject"] as const,
};
const fixtureEntry = () => {
  const task = createTaskCardFixture({
    id: "task-root",
    title: "Ship sign in",
    priority: 1,
    issueType: "feature",
    status: "in_progress",
    labels: ["auth"],
    description: "Sign in with a social account.",
    pullRequest: {
      providerId: "github",
      number: 134,
      url: "https://github.com/openai/openducktor/pull/134",
      state: "open",
      createdAt: "2026-03-12T12:24:09Z",
      updatedAt: "2026-03-12T12:24:09Z",
    },
  });
  const record = {
    ...ref,
    role: "build" as const,
    startedAt: new Date(NOW - 3600000).toISOString(),
    selectedModel: {
      runtimeKind: "codex" as const,
      providerId: "openai",
      modelId: "gpt-5.4",
      variant: "high",
    },
  };
  const entry = taskSessionEntry("root", {
    workspace: betaWorkspace,
    title: task.title,
    attention: ["question"],
    context: { kind: "task", task, sessions: [record] },
  });
  const target = {
    kind: "task_session" as const,
    workspaceId: betaWorkspace.workspaceId,
    taskId: task.id,
    role: "build" as const,
    identity: ref,
  };
  return {
    ...entry,
    target,
    key: sessionNavigationTargetKey(target),
  };
};

const observers: ReturnType<typeof createWorkspaceActivityObserver>[] = [];
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.dispose());
  mock.restore();
  configureShellBridge(createUnavailableShellBridge());
});

const mountSidebar = (
  sessions: AgentSessionLiveSnapshot[],
  entry: SessionNavigationEntry = fixtureEntry(),
) => {
  let listener: ((envelope: AgentSessionLiveEnvelope) => void) | undefined;
  const observe = mock(
    async (
      _input: { repoPath: string },
      onEnvelope: (envelope: AgentSessionLiveEnvelope) => void,
    ) => {
      listener = onEnvelope;
      return () => {};
    },
  );
  const observer = createWorkspaceActivityObserver({
    observe,
    archivedSessions: {
      load: async () => {},
      read: () => ({ status: "ready", keys: new Set() }),
      subscribe: () => () => {},
    },
  });
  observers.push(observer);
  observer.syncWorkspaces([
    { workspaceId: betaWorkspace.workspaceId, repoPath: betaWorkspace.repoPath },
  ]);
  const emit = (envelope: AgentSessionLiveEnvelope) => {
    if (!listener) throw new Error("Workspace observer is not attached.");
    listener(envelope);
  };
  emit({ type: "snapshot", repoPath: ref.repoPath, sessions });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(runtimeQueryKeys.definitions(), Object.values(RUNTIME_DESCRIPTORS_BY_KIND));
  const onOpen = mock(() => {});
  const other = workspaceSessionEntry("other");
  render(
    <QueryClientProvider client={client}>
      <SessionMenuProvider>
        <WorkspaceActivityContext value={observer}>
          <VisibleSessionTargetProvider>
            <SessionReadStateProvider>
              <SessionNavigationList
                model={navigationModel({ needs_you: [entry], recent: [other] })}
                selection={{ entryKey: other.key, visibleKey: other.key }}
                now={NOW}
                onOpen={onOpen}
                onRetry={() => {}}
              />
            </SessionReadStateProvider>
          </VisibleSessionTargetProvider>
        </WorkspaceActivityContext>
      </SessionMenuProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    observe,
    emit,
    onOpen,
    row: screen.getByRole("button", { name: new RegExp(entry.title) }),
  };
};
const openPreview = async (row: HTMLElement) => {
  fireEvent.focus(row);
  return screen.findByRole("dialog", { name: "Ship sign in" });
};

describe("Sidebar session previews", () => {
  test("resolves model aliases for the preview's own runtime and worktree, and reuses the catalog on reopen", async () => {
    const entry = fixtureEntry();
    if (entry.context.kind !== "task") throw new Error("Expected a task entry.");
    const claudeRef = { ...ref, runtimeKind: "claude" as const };
    const target = { ...entry.target, identity: claudeRef };
    const model = {
      runtimeKind: "claude" as const,
      providerId: "claude",
      modelId: "opus",
      variant: "high",
    };
    const catalog = createRuntimeCatalogFixture({
      models: {
        models: [
          {
            id: "opus",
            providerId: "claude",
            providerName: "Claude",
            modelId: "opus",
            modelName: "Opus 5.5",
            variants: ["high"],
            attachmentSupport: { image: true, audio: false, video: false, pdf: true },
          },
        ],
        defaultModelsByProvider: { claude: "opus" },
      },
    });
    const loadCatalog = mock(
      async (_input: Parameters<HostClient["agentRuntimeLoadCatalog"]>[0]) => catalog,
    );
    configureShellBridge(
      createShellBridgeFixture({ client: { agentRuntimeLoadCatalog: loadCatalog } }),
    );
    const { client, row, onOpen } = mountSidebar([], {
      ...entry,
      target,
      key: sessionNavigationTargetKey(target),
      runtimeKind: "claude",
      context: {
        ...entry.context,
        sessions: [{ ...entry.context.sessions[0]!, ...claudeRef, selectedModel: model }],
      },
    });
    client.setQueryData(
      runtimeCatalogQueryKeys.catalog({
        ...claudeRef,
        workingDirectory: "/repos/beta/another-worktree",
      }),
      createRuntimeCatalogFixture({ models: { models: [], defaultModelsByProvider: {} } }),
    );
    expect(loadCatalog).not.toHaveBeenCalled();
    const preview = await openPreview(row);
    const configuration = within(preview).getByLabelText("Session configuration");
    expect(await within(configuration).findByText("claude/Opus 5.5 · high")).toBeTruthy();
    expect(within(configuration).getByRole("img", { name: "Claude runtime" })).toBeTruthy();
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    expect(loadCatalog.mock.calls[0]?.[0]).toEqual({
      repoPath: ref.repoPath,
      runtimeKind: "claude",
      workingDirectory: ref.workingDirectory,
    });
    fireEvent.keyDown(preview, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const reopened = await openPreview(row);
    expect(within(reopened).getByText("claude/Opus 5.5 · high")).toBeTruthy();
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("shows task workflow, metadata, live model and effort without reading history or adding observers", async () => {
    const history = mock(async () => {
      throw new Error("A preview must not load history.");
    });
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          agentRuntimeLoadSessionHistory: history,
          agentRuntimeLoadCatalog: async () =>
            createRuntimeCatalogFixture({
              models: {
                models: [
                  {
                    id: "gpt-5.5",
                    providerId: "openai",
                    providerName: "OpenAI",
                    modelId: "gpt-5.5",
                    modelName: "GPT-5.5",
                    variants: ["xhigh", "medium"],
                    attachmentSupport: { image: true, audio: false, video: false, pdf: true },
                  },
                ],
                defaultModelsByProvider: { openai: "gpt-5.5" },
              },
            }),
        },
      }),
    );
    const { row, observe, emit } = mountSidebar([
      session({ model: { providerId: "openai", modelId: "gpt-5.5", variant: "xhigh" } }),
    ]);
    const preview = await openPreview(row);
    expect(within(preview).getByLabelText("Task workflow").querySelectorAll("li")).toHaveLength(4);
    expect(within(preview).getByText("In progress")).toBeTruthy();
    expect(within(preview).getByText("P1")).toBeTruthy();
    expect(within(preview).getByText("Feature")).toBeTruthy();
    expect(within(preview).queryByLabelText("Task labels")).toBeNull();
    expect(within(preview).queryByText("auth")).toBeNull();
    expect(within(preview).queryByRole("button", { name: "Archive session" })).toBeNull();
    const header = preview.querySelector("header")!;
    expect(within(header).getByRole("button", { name: /PR #134/ })).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Copy task ID" })).toBeTruthy();
    expect(within(preview).queryByText("Sign in with a social account.")).toBeNull();
    expect(within(preview).queryByText(/AI QA (required|optional)/)).toBeNull();
    expect(await within(preview).findByText("openai/GPT-5.5 · xhigh")).toBeTruthy();
    await act(async () =>
      emit({
        type: "session_upsert",
        session: session({
          model: { providerId: "openai", modelId: "gpt-5.5", variant: "medium" },
        }),
      }),
    );
    expect(within(preview).getByText("openai/GPT-5.5 · medium")).toBeTruthy();
    expect(observe).toHaveBeenCalledTimes(1);
    expect(history).not.toHaveBeenCalled();
  });

  test.each(["Code reviewer", null])(
    "shows a workspace session's saved custom role only when present: %s",
    async (roleName) => {
      const entry = workspaceSessionEntry("workspace-chat", {
        workspace: betaWorkspace,
        title: "Ship sign in",
      });
      if (entry.context.kind !== "workspace") throw new Error("Expected a workspace session.");
      entry.context.session = {
        ...entry.context.session,
        externalSessionId: ref.externalSessionId,
        executionTarget: { kind: "local_repo_root", workingDirectory: ref.workingDirectory },
        roleSnapshot: roleName
          ? { id: "reviewer", name: roleName, systemPrompt: "Private role instructions" }
          : null,
      };
      const { row } = mountSidebar([session()], entry);
      const preview = await openPreview(row);
      const role = within(preview).queryByLabelText("Custom role");
      expect(role?.textContent ?? null).toBe(roleName);
      expect(within(preview).queryByLabelText("Role lane")).toBeNull();
      expect(within(preview).queryByText("Private role instructions")).toBeNull();
      expect(within(preview).queryByText(/AI QA (required|optional)/)).toBeNull();
    },
  );

  test("opens the latest full-identity role session or its task context when no session exists", async () => {
    const entry = fixtureEntry();
    if (entry.context.kind !== "task") throw new Error("Expected a task entry.");
    const olderQa = {
      ...entry.context.sessions[0]!,
      role: "qa" as const,
      externalSessionId: "shared-qa-id",
      startedAt: new Date(NOW - 7200000).toISOString(),
    };
    const latestQa = {
      ...olderQa,
      runtimeKind: "opencode" as const,
      workingDirectory: "/repos/beta/worktrees/qa",
      startedAt: new Date(NOW - 1800000).toISOString(),
    };
    const taskEntry = {
      ...entry,
      context: {
        ...entry.context,
        sessions: [...entry.context.sessions, olderQa, latestQa],
      },
    };
    const { row, onOpen } = mountSidebar([session()], taskEntry);
    const preview = await openPreview(row);
    expect(
      within(preview)
        .getByRole("button", { name: /^Builder/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(within(preview).getByRole("button", { name: /^QA/ }));
    expect(onOpen).toHaveBeenCalledWith(taskEntry, {
      kind: "task_session",
      workspaceId: betaWorkspace.workspaceId,
      taskId: entry.context.task.id,
      role: "qa",
      identity: {
        externalSessionId: latestQa.externalSessionId,
        runtimeKind: latestQa.runtimeKind,
        workingDirectory: latestQa.workingDirectory,
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const reopened = await openPreview(row);
    fireEvent.click(within(reopened).getByRole("button", { name: /^Planner/ }));
    expect(onOpen).toHaveBeenLastCalledWith(taskEntry, {
      kind: "task",
      workspaceId: betaWorkspace.workspaceId,
      taskId: entry.context.task.id,
      role: "planner",
    });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  test("shows a catalog failure without blocking an inline question reply", async () => {
    const reply = mock(
      async (_input: Parameters<HostClient["agentSessionLiveReplyQuestion"]>[0]) => {},
    );
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          agentSessionLiveReplyQuestion: reply,
          agentRuntimeLoadCatalog: async () => {
            throw new Error("Model catalog disconnected.");
          },
        },
      }),
    );
    const { row, onOpen } = mountSidebar([session({ pendingQuestions: [question] })]);
    const preview = await openPreview(row);
    const configuration = within(preview).getByLabelText("Session configuration");
    expect((await within(configuration).findByRole("alert")).textContent).toBe(
      "Could not load model details: Model catalog disconnected.",
    );
    fireEvent.change(within(preview).getByRole("textbox"), {
      target: { value: "Personal accounts" },
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Confirm Answers" }));
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0]?.[0].answers).toEqual([["Personal accounts"]]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("answers a child question in another workspace, keeps failed answers, and does not navigate", async () => {
    const childRef = { ...ref, externalSessionId: "child" };
    const reply = mock(
      async (_input: Parameters<HostClient["agentSessionLiveReplyQuestion"]>[0]) => {},
    )
      .mockRejectedValueOnce(new Error("Runtime disconnected. Try again."))
      .mockResolvedValue(undefined);
    configureShellBridge(
      createShellBridgeFixture({ client: { agentSessionLiveReplyQuestion: reply } }),
    );
    const { row, onOpen, emit } = mountSidebar([
      session(),
      session({
        ref: childRef,
        parentExternalSessionId: "root",
        pendingQuestions: [question],
        repositoryScope: { kind: "repository" },
      }),
    ]);
    const preview = await openPreview(row);
    expect(within(preview).getByText("Subagent request")).toBeTruthy();
    const answer = within(preview).getByRole("textbox", { name: "Free text answer" });
    if (!(answer instanceof HTMLTextAreaElement)) throw new Error("Expected a text answer field.");
    fireEvent.focus(answer);
    fireEvent.change(answer, { target: { value: "Personal and business accounts" } });
    fireEvent.pointerLeave(preview, { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByRole("button", { name: /Chat other/ }), {
      pointerType: "mouse",
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 270));
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Ship sign in" })).toBe(preview);
    fireEvent.click(within(preview).getByRole("button", { name: "Confirm Answers" }));
    await waitFor(() =>
      expect(within(preview).getByText("Runtime disconnected. Try again.")).toBeTruthy(),
    );
    expect(answer.value).toBe("Personal and business accounts");
    fireEvent.click(within(preview).getByRole("button", { name: "Confirm Answers" }));
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(2));
    expect(reply.mock.calls[1]?.[0]).toEqual({
      ...childRef,
      requestId: question.requestId,
      answers: [["Personal and business accounts"]],
      blocking: false,
      sessionScope: { kind: "repository" },
    });
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () =>
      emit({
        type: "session_upsert",
        session: session({ ref: childRef, parentExternalSessionId: "root" }),
      }),
    );
    expect(within(preview).queryByPlaceholderText("Write your answer...")).toBeNull();
  });

  test("limits permission choices to runtime capabilities and surfaces reply failures in place", async () => {
    const reply = mock(
      async (_input: Parameters<HostClient["agentSessionLiveReplyApproval"]>[0]) => {},
    )
      .mockRejectedValueOnce(new Error("Permission reply failed."))
      .mockResolvedValue(undefined);
    configureShellBridge(
      createShellBridgeFixture({ client: { agentSessionLiveReplyApproval: reply } }),
    );
    const { row, onOpen } = mountSidebar([
      session({
        pendingApprovals: [
          { ...approval, supportedReplyOutcomes: [...approval.supportedReplyOutcomes] },
        ],
      }),
    ]);
    const preview = await openPreview(row);
    expect(within(preview).getByText("Command: bun run test")).toBeTruthy();
    expect(within(preview).queryByRole("button", { name: "Always allow" })).toBeNull();
    fireEvent.click(within(preview).getByRole("button", { name: "Approve once" }));
    await waitFor(() => expect(within(preview).getByText("Permission reply failed.")).toBeTruthy());
    fireEvent.click(within(preview).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(2));
    expect(reply.mock.calls[1]?.[0]).toEqual({
      ...ref,
      requestId: approval.requestId,
      outcome: "reject",
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("lets keyboard users enter and dismiss the preview while keeping normal row navigation", async () => {
    const { row, onOpen } = mountSidebar([session({ pendingQuestions: [question] })]);
    const preview = await openPreview(row);
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(document.activeElement).toBe(preview);
    fireEvent.keyDown(preview, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(row);
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("keeps identical child request IDs separate and excludes another working directory", async () => {
    const reply = mock(
      async (_input: Parameters<HostClient["agentSessionLiveReplyQuestion"]>[0]) => {},
    );
    configureShellBridge(
      createShellBridgeFixture({ client: { agentSessionLiveReplyQuestion: reply } }),
    );
    const child = (id: string, prompt: string) =>
      session({
        ref: { ...ref, externalSessionId: id },
        parentExternalSessionId: "root",
        pendingQuestions: [
          { ...question, questions: [{ header: id, question: prompt, options: [] }] },
        ],
      });
    const { row } = mountSidebar([
      session(),
      child("first-child", "First child question"),
      child("second-child", "Second child question"),
      session({
        ref: { ...ref, workingDirectory: "/repos/beta/other-worktree" },
        pendingQuestions: [
          {
            ...question,
            questions: [{ header: "Other", question: "Unrelated session question", options: [] }],
          },
        ],
      }),
    ]);
    const preview = await openPreview(row);
    expect(within(preview).queryByText("Unrelated session question")).toBeNull();
    const firstCard = within(preview).getByText("First child question").closest("section")!;
    const secondCard = within(preview).getByText("Second child question").closest("section")!;
    fireEvent.change(within(firstCard).getByRole("textbox"), { target: { value: "First answer" } });
    fireEvent.click(within(firstCard).getByRole("button", { name: "Confirm Answers" }));
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0]?.[0].externalSessionId).toBe("first-child");
    expect(within(secondCard).getByRole("textbox").getAttribute("disabled")).toBeNull();
    expect(
      within(secondCard).getByRole("button", { name: "Confirm Answers" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("resets a replaced request's draft and removes terminal input before a new snapshot", async () => {
    const { row, emit } = mountSidebar([
      session({ pendingQuestions: [{ ...question, blocking: true }] }),
    ]);
    const preview = await openPreview(row);
    fireEvent.change(within(preview).getByRole("textbox"), { target: { value: "Old answer" } });
    await act(async () =>
      emit({
        type: "session_upsert",
        session: session({
          pendingQuestions: [{ ...question, requestInstanceId: "instance-2", blocking: true }],
        }),
      }),
    );
    const answer = within(preview).getByRole("textbox");
    if (!(answer instanceof HTMLTextAreaElement)) throw new Error("Expected a text answer field.");
    expect(answer.value).toBe("");
    expect(
      within(preview).getByRole("button", { name: "Confirm Answers" }).hasAttribute("disabled"),
    ).toBe(true);
    await act(async () =>
      emit({
        type: "transcript_event",
        event: {
          type: "session_finished",
          externalSessionId: ref.externalSessionId,
          sessionRef: ref,
          timestamp: new Date(NOW).toISOString(),
          message: "Completed",
        },
      }),
    );
    expect(within(preview).queryByRole("textbox")).toBeNull();
  });

  test("keeps requests visible but prevents replies after a failed live status read", async () => {
    const reply = mock(
      async (_input: Parameters<HostClient["agentSessionLiveReplyQuestion"]>[0]) => {},
    );
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          agentSessionLiveReplyQuestion: reply,
          agentRuntimeLoadCatalog: async () =>
            createRuntimeCatalogFixture({ models: { models: [], defaultModelsByProvider: {} } }),
        },
      }),
    );
    const { row, emit } = mountSidebar([session({ pendingQuestions: [question] })]);
    const preview = await openPreview(row);
    fireEvent.change(within(preview).getByRole("textbox"), {
      target: { value: "Keep this answer" },
    });
    await act(async () =>
      emit({
        type: "fault",
        ref,
        repoPath: ref.repoPath,
        message: "Status could not be read.",
        statusUnavailable: true,
      }),
    );
    expect(within(preview).getByRole("alert").textContent).toBe("Status could not be read.");
    const button = within(preview).getByRole("button", { name: "Confirm Answers" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(reply).not.toHaveBeenCalled();
    await act(async () =>
      emit({ type: "session_upsert", session: session({ pendingQuestions: [question] }) }),
    );
    expect(within(preview).queryByRole("alert")).toBeNull();
    expect(
      within(preview).getByRole("button", { name: "Confirm Answers" }).hasAttribute("disabled"),
    ).toBe(false);
  });
});
