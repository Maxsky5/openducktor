import { expect, mock, spyOn, test } from "bun:test";
import { repoConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, memo, type ReactElement, useEffect, useLayoutEffect, useState } from "react";
import { createAgentMessageSendReceipt } from "@/test-utils/agent-message-send-fixture";
import { workspaceConflictChatKey } from "./workspace-git-conflict-assistance";
import { toast } from "sonner";
import { Tabs } from "@/components/ui/tabs";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import {
  AgentSessionReadModelStateContext,
  WorkspaceBranchStateContext,
} from "@/state/app-state-contexts";
import { filesystemQueryKeys, invalidateWorkspaceFileQueries } from "@/state/queries/filesystem";
import { currentBranchQueryOptions } from "@/state/queries/git";
import { repoConfigQueryOptions, settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  getShellBridge,
} from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";
import * as filePreview from "@/components/features/agents/task-execution-file-preview";
import * as toolsModule from "@/components/features/agents/use-workspace-session-tools";
import * as sessionChat from "./workspace-session-chat";
import type { WorkspaceConflictChatActions } from "./use-workspace-conflict-chat-actions";
import { AgentChatMarkdownRenderer } from "@/components/features/agents/agent-chat/agent-chat-markdown-renderer";
import { AgentSessionQuestionCard } from "@/components/features/agents/agent-chat/agent-session-question-card";
import { buildQuestionRequest } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import {
  WorkspaceSessionContent,
  WorkspaceSessionReadModelNotice,
  type WorkspaceSessionPanelState,
} from "./workspace-session-content";

function mockTools(
  renderTools: (props: Parameters<typeof toolsModule.useWorkspaceSessionTools>[0]) => ReactElement,
) {
  return spyOn(toolsModule, "useWorkspaceSessionTools").mockImplementation((props) => ({
    toolsContent: renderTools(props),
    refresh: null,
  }));
}

const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
const record = {
  id: "chat",
  runtimeKind: "opencode" as const,
  externalSessionId: "native-chat",
  executionTarget: { kind: "local_repo_root" as const, workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: "Chat",
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};
const worktreeRecord: WorkspaceSession = {
  ...record,
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: "/repo/worktree",
    branchName: "main",
    worktreeState: "present",
  },
};

function WorkspaceChange({ apply }: { apply: () => Promise<boolean> }) {
  const { run } = useWorkspacePreviewTransitionGuard();
  return (
    <button onClick={() => run(apply, undefined, { waitForSuccess: true })}>
      Change workspace
    </button>
  );
}

function renderClosedSession(
  queryClient: QueryClient,
  branch: string | null | undefined,
  revision?: string,
  sessionRecord: WorkspaceSession = record,
  selectedFile: WorkspaceSessionPanelState["selectedFile"] = {
    rootPath: sessionRecord.executionTarget.workingDirectory,
    relativePath: "file.ts",
  },
  switchWorkspace?: () => Promise<boolean>,
  panelOpen = false,
  onSafeToLeave?: () => void,
) {
  let currentWorkspace: ActiveWorkspace = workspace;
  let currentRecord = sessionRecord;
  let currentFile = selectedFile;
  let sessionIds = [sessionRecord.id];
  const content = (
    name: string | null | undefined,
    currentRevision?: string,
    isSwitchingBranch = false,
  ) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceBranchStateContext.Provider
        value={{
          activeWorkspace: null,
          branches: [],
          activeBranch:
            name === undefined
              ? null
              : name === null
                ? { detached: true, revision: currentRevision }
                : { name, detached: false },
          isLoadingBranches: false,
          isSwitchingBranch,
          branchSyncDegraded: false,
          switchBranch: async () => {},
        }}
      >
        <WorkspacePreviewTransitionGuardProvider>
          {switchWorkspace ? <WorkspaceChange apply={switchWorkspace} /> : null}
          <Tabs value={currentRecord.id}>
            <WorkspaceSessionContent
              workspace={currentWorkspace}
              record={currentRecord}
              sessionIds={sessionIds}
              panelState={{
                isOpen: panelOpen,
                activeTabId: "file_explorer",
                selectedFile: currentFile,
              }}
              onPanelStateChange={() => {}}
              {...(onSafeToLeave ? { onSafeToLeave } : {})}
            />
          </Tabs>
        </WorkspacePreviewTransitionGuardProvider>
      </WorkspaceBranchStateContext.Provider>
    </QueryClientProvider>
  );
  const view = render(content(branch, revision));
  return {
    ...view,
    setSession: (next: WorkspaceSession, file: WorkspaceSessionPanelState["selectedFile"]) => {
      currentRecord = next;
      currentFile = file;
      if (!sessionIds.includes(next.id)) sessionIds = [...sessionIds, next.id];
      view.rerender(content(branch, revision));
    },
    setSessions: (ids: string[]) => {
      sessionIds = ids;
      view.rerender(content(branch, revision));
    },
    setWorkspace: (next: ActiveWorkspace, session: WorkspaceSession) => {
      currentWorkspace = next;
      currentRecord = session;
      currentFile = null;
      sessionIds = [session.id];
      view.rerender(content(branch, revision));
    },
    setPanelOpen: (open: boolean) => {
      panelOpen = open;
      view.rerender(content(branch, revision));
    },
    setBranch: (
      name: string | null | undefined,
      nextRevision?: string,
      isSwitchingBranch = false,
    ) => view.rerender(content(name, nextRevision, isSwitchingBranch)),
  };
}

test("conflict assistance follows the selected chat after switching away and back", async () => {
  const send = mock(
    async (id: string, _parts: Parameters<WorkspaceConflictChatActions["send"]>[0]) =>
      createAgentMessageSendReceipt({
        runtimeKind: "opencode",
        externalSessionId: `native-${id}`,
        workingDirectory: "/repo",
      }),
  );
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(
    ({ workspace, record, onActionsReady }) => {
      useLayoutEffect(() => {
        const key = workspaceConflictChatKey(workspace.workspaceId, record.id);
        onActionsReady?.(key, {
          workspace,
          record,
          send: async (parts) => send(record.id, parts),
          assertCanSubmit: () => {},
          blockedReason: null,
          isStarting: false,
        });
        return () => onActionsReady?.(key, null);
      }, [onActionsReady, record, workspace]);
      return <div>Chat: {record.id}</div>;
    },
  );
  const tools = mockTools((props) => (
    <button
      disabled={Boolean(props.conflictAssistanceBlockedReason)}
      onClick={() =>
        void props.onResolveGitConflict?.({
          operation: "rebase",
          currentBranch: "feature",
          targetBranch: "main",
          conflictedFiles: ["file.ts"],
          output: "Conflict",
          workingDir: props.workingDirectory,
        })
      }
    >
      Resolve conflicts
    </button>
  ));
  const queryClient = newQueryClient();
  const view = renderClosedSession(queryClient, "main", undefined, record, null, undefined, true);
  try {
    fireEvent.click(screen.getByRole("button", { name: "Resolve conflicts" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const other = { ...record, id: "other", externalSessionId: "native-other" };
    view.setSession(other, null);
    fireEvent.click(screen.getByRole("button", { name: "Resolve conflicts" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    view.setSession(record, null);
    fireEvent.click(screen.getByRole("button", { name: "Resolve conflicts" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls.map(([id]) => id)).toEqual(["chat", "other", "chat"]);
  } finally {
    view.unmount();
    queryClient.clear();
    tools.mockRestore();
    chat.mockRestore();
  }
});

test("switching chats keeps the tools and chat drafts and resets the file owner", () => {
  const preview = mockFilePreview(({ model }) => (
    <div>Preview: {model.selectedFile?.relativePath}</div>
  ));
  const tools = mockTools(({ onSelectFile }) => (
    <div>
      <input aria-label="Tools input" />
      <button onClick={() => onSelectFile({ rootPath: "/repo", relativePath: "next.ts" })}>
        Open next file
      </button>
    </div>
  ));
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => (
    <input aria-label="Chat input" />
  ));
  const queryClient = newQueryClient();
  const firstFile = { rootPath: "/repo", relativePath: "first.ts" };
  queryClient.setQueryData(
    repoConfigQueryOptions(workspace.workspaceId).queryKey,
    repoConfigSchema.parse({ ...workspace, agentStudioState: { openTaskIds: [] } }),
  );
  const view = renderClosedSession(
    queryClient,
    "main",
    undefined,
    record,
    firstFile,
    undefined,
    true,
  );
  try {
    const toolsInput = screen.getByRole("textbox", { name: "Tools input" });
    const chatInput = view.container.querySelector<HTMLInputElement>('[aria-label="Chat input"]');
    if (!chatInput) throw new Error("Expected the chat input.");
    fireEvent.change(chatInput, { target: { value: "First chat draft" } });
    const other = {
      ...record,
      id: "other",
      externalSessionId: "native-other",
      manualTitle: "Other",
    };
    view.setSession(other, { rootPath: "/repo", relativePath: "other.ts" });
    expect(screen.getByText("Preview: other.ts")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Tools input" })).toBe(toolsInput);
    const otherInput = [
      ...view.container.querySelectorAll<HTMLInputElement>('[aria-label="Chat input"]'),
    ].find((input) => input !== chatInput);
    expect(otherInput?.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Open next file" }));
    expect(screen.getByText("Preview: next.ts")).toBeTruthy();
    view.setSession(record, firstFile);
    expect(screen.getByText("Preview: first.ts")).toBeTruthy();
    expect(view.container.querySelector('[aria-label="Chat input"]')).toBe(chatInput);
    expect(chatInput.value).toBe("First chat draft");
  } finally {
    view.unmount();
    queryClient.clear();
    preview.mockRestore();
    tools.mockRestore();
    chat.mockRestore();
  }
});

test("switching workspaces retains chat drafts without sharing them or hidden subscriptions", () => {
  const active = new Set<string>();
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(({ workspace }) => {
    useEffect(() => {
      active.add(workspace.workspaceId);
      return () => {
        active.delete(workspace.workspaceId);
      };
    }, [workspace.workspaceId]);
    return <input aria-label={`${workspace.workspaceName} draft`} />;
  });
  const queryClient = newQueryClient();
  const otherWorkspace = { workspaceId: "other", workspaceName: "Other", repoPath: "/other" };
  for (const scope of [workspace, otherWorkspace]) {
    queryClient.setQueryData(
      repoConfigQueryOptions(scope.workspaceId).queryKey,
      repoConfigSchema.parse({ ...scope, agentStudioState: { openTaskIds: [] } }),
    );
  }
  const otherRecord = {
    ...record,
    executionTarget: { kind: "local_repo_root" as const, workingDirectory: "/other" },
  };
  const view = renderClosedSession(queryClient, "main", undefined, record, null);
  try {
    const first = screen.getByLabelText<HTMLInputElement>("Workspace draft");
    fireEvent.change(first, { target: { value: "First workspace draft" } });
    view.setWorkspace(otherWorkspace, otherRecord);
    const second = screen.getByLabelText<HTMLInputElement>("Other draft");
    expect(second.value).toBe("");
    expect(second).not.toBe(first);
    fireEvent.change(second, { target: { value: "Second workspace draft" } });
    expect([...active]).toEqual(["other"]);
    view.setWorkspace(workspace, record);
    expect(screen.getByLabelText("Workspace draft")).toBe(first);
    expect(first.value).toBe("First workspace draft");
    expect([...active]).toEqual(["workspace"]);
    view.setWorkspace(otherWorkspace, otherRecord);
    expect(screen.getByLabelText("Other draft")).toBe(second);
    expect(second.value).toBe("Second workspace draft");
  } finally {
    view.unmount();
    expect(active.size).toBe(0);
    queryClient.clear();
    chat.mockRestore();
  }
});

test("opening and closing tools preserves question drafts, tabs, and collapse choices", () => {
  const request = buildQuestionRequest({
    questions: [
      { header: "First", question: "Enter a first answer", options: [] },
      { header: "Second", question: "Enter a second answer", options: [] },
    ],
  });
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => (
    <AgentSessionQuestionCard request={request} onSubmit={async () => {}} />
  ));
  const tools = mockTools(() => <div>Workspace tools</div>);
  const queryClient = newQueryClient();
  queryClient.setQueryData(
    repoConfigQueryOptions(workspace.workspaceId).queryKey,
    repoConfigSchema.parse({ ...workspace, agentStudioState: { openTaskIds: [] } }),
  );
  const view = renderClosedSession(queryClient, "main", undefined, record, null);
  try {
    fireEvent.change(screen.getByPlaceholderText("Write your answer..."), {
      target: { value: "First draft" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Second" }));
    fireEvent.change(screen.getByPlaceholderText("Write your answer..."), {
      target: { value: "Second draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse question request" }));

    for (const open of [true, false, true]) {
      view.setPanelOpen(open);
      expect(screen.getByRole("button", { name: "Expand question request" })).toBeTruthy();
      expect(screen.getByText("2/2 answered")).toBeTruthy();
      expect(screen.queryByText("Workspace tools") !== null).toBe(open);
    }

    fireEvent.click(screen.getByRole("button", { name: "Expand question request" }));
    expect(screen.getByRole("tab", { name: "Second" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByDisplayValue("Second draft")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "First" }));
    expect(screen.getByDisplayValue("First draft")).toBeTruthy();
  } finally {
    view.unmount();
    queryClient.clear();
    chat.mockRestore();
    tools.mockRestore();
  }
});

test("retained chats stop hidden subscriptions and drop old or removed chats", () => {
  const active = new Set<string>();
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(({ record }) => {
    useEffect(() => {
      active.add(record.id);
      return () => {
        active.delete(record.id);
      };
    }, [record.id]);
    return <input aria-label={`${record.manualTitle} draft`} />;
  });
  const queryClient = newQueryClient();
  queryClient.setQueryData(
    repoConfigQueryOptions(workspace.workspaceId).queryKey,
    repoConfigSchema.parse({ ...workspace, agentStudioState: { openTaskIds: [] } }),
  );
  const sessions = Array.from({ length: 7 }, (_, index) => ({
    ...record,
    id: `chat-${index}`,
    externalSessionId: `native-${index}`,
    manualTitle: `Chat ${index}`,
  }));
  const view = renderClosedSession(queryClient, "main", undefined, sessions[0], null);
  try {
    view.setSessions(sessions.map((session) => session.id));
    let second: Element | null = null;
    for (const session of sessions.slice(1)) {
      view.setSession(session, null);
      expect([...active]).toEqual([session.id]);
      if (session.id === "chat-1")
        second = view.container.querySelector('[aria-label="Chat 1 draft"]');
    }
    expect(view.container.querySelectorAll("input")).toHaveLength(6);
    expect(view.container.querySelector('[aria-label="Chat 0 draft"]')).toBeNull();
    view.setSession(sessions[1]!, null);
    expect(view.container.querySelector('[aria-label="Chat 1 draft"]')).toBe(second);
    view.setSessions(
      sessions.filter((session) => session.id !== "chat-1").map((session) => session.id),
    );
    expect([...active]).toEqual(["chat-1"]);
    view.setSession(sessions[2]!, null);
    expect(view.container.querySelector('[aria-label="Chat 1 draft"]')).toBeNull();
  } finally {
    view.unmount();
    expect(active.size).toBe(0);
    queryClient.clear();
    chat.mockRestore();
  }
});

test.each(["clean", "close"])("a kept file preview is safe after it is %s", async (finish) => {
  const onSafeToLeave = mock(() => {});
  const preview = mockFilePreview(({ model }) => (
    <>
      <button onClick={() => model.onLeavePolicyChange("confirm")}>Edit file</button>
      <button onClick={() => model.onLeavePolicyChange("allow")}>Save file</button>
      <button onClick={model.onClose}>Close file</button>
      <button onClick={model.onKeepEditing}>Keep editing</button>
      {model.hasPendingDiscard ? <button onClick={model.onDiscard}>Discard file</button> : null}
    </>
  ));
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => <div />);
  const queryClient = newQueryClient();
  const view = renderClosedSession(
    queryClient,
    "main",
    undefined,
    record,
    undefined,
    undefined,
    false,
    onSafeToLeave,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: "Edit file" }));
    fireEvent.click(screen.getByRole("button", { name: "Close file" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onSafeToLeave).not.toHaveBeenCalled();

    if (finish === "clean") {
      fireEvent.click(screen.getByRole("button", { name: "Save file" }));
      expect(onSafeToLeave).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Close file" }));
      expect(onSafeToLeave).toHaveBeenCalledTimes(2);
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Close file" }));
      fireEvent.click(screen.getByRole("button", { name: "Discard file" }));
      expect(onSafeToLeave).toHaveBeenCalledTimes(1);
    }
  } finally {
    view.unmount();
    queryClient.clear();
    preview.mockRestore();
    chat.mockRestore();
  }
});

test("a failed switch keeps the dirty draft guarded until a new file opens", async () => {
  const finishChanges: Array<(changed: boolean) => void> = [];
  const switchWorkspace = () =>
    new Promise<boolean>((resolve) => {
      finishChanges.push(resolve);
    });
  const onSafeToLeave = mock(() => {});
  const preview = mockFilePreview(({ model }) => (
    <>
      <button onClick={() => model.onLeavePolicyChange("confirm")}>Edit file</button>
      <button onClick={model.onClose}>Close file</button>
      <button onClick={model.onKeepEditing}>Keep editing</button>
      {model.hasPendingDiscard ? <button onClick={model.onDiscard}>Discard draft</button> : null}
    </>
  ));
  const tools = mockTools(({ onSelectFile }) => (
    <button onClick={() => onSelectFile({ rootPath: "/repo", relativePath: "next.ts" })}>
      Open next file
    </button>
  ));
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => <div />);
  const queryClient = newQueryClient();
  const view = renderClosedSession(
    queryClient,
    "main",
    undefined,
    record,
    undefined,
    switchWorkspace,
    true,
    onSafeToLeave,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: "Edit file" }));
    fireEvent.click(screen.getByRole("button", { name: "Change workspace" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(finishChanges).toHaveLength(1));
    await act(async () => finishChanges[0]?.(false));
    await waitFor(() =>
      expect(preview.mock.calls.at(-1)?.[0].model.isApplyingTransition).toBe(false),
    );
    expect(preview.mock.calls.at(-1)?.[0].model.selectedFile?.relativePath).toBe("file.ts");
    expect(onSafeToLeave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(onSafeToLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open next file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard draft" }));
    await waitFor(() =>
      expect(preview.mock.calls.at(-1)?.[0].model.selectedFile?.relativePath).toBe("next.ts"),
    );
    expect(onSafeToLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close file" }));
    expect(onSafeToLeave).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    queryClient.clear();
    chat.mockRestore();
    preview.mockRestore();
    tools.mockRestore();
  }
});

function newQueryClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(
    settingsSnapshotQueryOptions().queryKey,
    createSettingsSnapshotFixture(),
  );
  return queryClient;
}

function mockFilePreview(
  Preview: (
    props: Parameters<typeof filePreview.TaskExecutionSelectedFilePreview>[0],
  ) => ReactElement,
) {
  // Bun calls the mock as a function, but the exported component has React's memo shape.
  return spyOn(filePreview, "TaskExecutionSelectedFilePreview").mockImplementation(
    Object.assign(Preview, memo(Preview)),
  );
}

test.each([
  { name: "repository", sessionRecord: record, rootPath: "/repo" },
  { name: "worktree", sessionRecord: worktreeRecord, rootPath: "/repo/worktree" },
])(
  "$name chat links open repo files and name the workspace in path errors",
  async ({ sessionRecord, rootPath }) => {
    const previousBridge = getShellBridge();
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitCanonicalizePath: async (path) => path,
          gitGetCurrentBranch: async () => ({ name: "main", detached: false }),
        },
      }),
    );
    const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => (
      <AgentChatMarkdownRenderer markdown="[outside](../secret.md) [README](./README.md)" />
    ));
    const error = spyOn(toast, "error").mockReturnValue("error");
    const preview = mockFilePreview(() => <div>File preview</div>);
    const queryClient = newQueryClient();
    queryClient.setQueryData(currentBranchQueryOptions("/repo").queryKey, {
      name: "main",
      detached: false,
    });
    const view = renderClosedSession(queryClient, "main", undefined, sessionRecord, null);
    try {
      fireEvent.click(screen.getByRole("link", { name: "outside" }));
      await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole("link", { name: "README" }));
      await waitFor(() =>
        expect(screen.getByTestId("workspace-session-file-preview")).toBeTruthy(),
      );
      expect(screen.getByTestId("workspace-session-file-preview").textContent).toContain(
        "File preview",
      );
      expect(preview.mock.calls.at(-1)?.[0].model.selectedFile).toEqual({
        rootPath,
        relativePath: "README.md",
      });
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[1]?.description).toBe(
        "The file path leaves the workspace directory.",
      );
    } finally {
      view.unmount();
      queryClient.clear();
      chat.mockRestore();
      preview.mockRestore();
      error.mockRestore();
      configureShellBridge(previousBridge);
    }
  },
);

test("an outside branch change keeps a dirty preview and refreshes file queries", async () => {
  function Preview() {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="File draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }
  const preview = mockFilePreview(Preview);
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => <div />);
  const queryClient = newQueryClient();
  const view = renderClosedSession(queryClient, "main");
  try {
    const input = screen.getByRole("textbox", { name: "File draft" });
    fireEvent.change(input, { target: { value: "unsaved draft" } });
    const textKey = filesystemQueryKeys.textFile("/repo", "file.ts");
    queryClient.setQueryData(textKey, "old branch");

    view.setBranch("feature");

    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
    expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:feature");
    await waitFor(() => expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true));
  } finally {
    view.unmount();
    chat.mockRestore();
    preview.mockRestore();
    queryClient.clear();
  }
});

test("a guarded workspace change locks the preview and file selection until it fails", async () => {
  const finishChanges: Array<(changed: boolean) => void> = [];
  const switchWorkspace = () =>
    new Promise<boolean>((resolve) => {
      finishChanges.push(resolve);
    });
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => <div />);
  const preview = mockFilePreview(() => <input aria-label="File draft" />);
  const tools = mockTools(({ onSelectFile }) => (
    <button onClick={() => onSelectFile({ rootPath: "/repo", relativePath: "next.ts" })}>
      Open next file
    </button>
  ));
  const queryClient = newQueryClient();
  queryClient.setQueryData(currentBranchQueryOptions("/repo").queryKey, {
    name: "main",
    detached: false,
  });
  const view = renderClosedSession(
    queryClient,
    "main",
    undefined,
    record,
    undefined,
    switchWorkspace,
    true,
  );
  try {
    const file = screen.getByTestId("workspace-session-file-preview");
    expect(file.querySelector("[inert]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change workspace" }));
    await waitFor(() => expect(finishChanges).toHaveLength(1));
    expect(file.querySelector("[inert]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open next file" }));
    expect(preview.mock.calls.at(-1)?.[0].model.selectedFile?.relativePath).toBe("file.ts");

    await act(async () => finishChanges[0]?.(false));
    await waitFor(() => expect(file.querySelector("[inert]")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Open next file" }));
    expect(preview.mock.calls.at(-1)?.[0].model.selectedFile?.relativePath).toBe("next.ts");
  } finally {
    view.unmount();
    queryClient.clear();
    chat.mockRestore();
    preview.mockRestore();
    tools.mockRestore();
  }
});

test("the tools panel stays beside the chat", () => {
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => <div>Chat</div>);
  const tools = mockTools(() => <div>Tools</div>);
  const queryClient = newQueryClient();
  queryClient.setQueryData(
    repoConfigQueryOptions(workspace.workspaceId).queryKey,
    repoConfigSchema.parse({ ...workspace, agentStudioState: { openTaskIds: [] } }),
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceBranchStateContext.Provider
        value={{
          activeWorkspace: null,
          branches: [],
          activeBranch: { name: "main", detached: false },
          isLoadingBranches: false,
          isSwitchingBranch: false,
          branchSyncDegraded: false,
          switchBranch: async () => {},
        }}
      >
        <WorkspacePreviewTransitionGuardProvider>
          <Tabs value={record.id}>
            <WorkspaceSessionContent
              workspace={workspace}
              record={record}
              sessionIds={[record.id]}
              panelState={{ isOpen: true, activeTabId: "git", selectedFile: null }}
              onPanelStateChange={() => {}}
            />
          </Tabs>
        </WorkspacePreviewTransitionGuardProvider>
      </WorkspaceBranchStateContext.Provider>
    </QueryClientProvider>,
  );
  try {
    const panels = view.container.querySelectorAll('[data-slot="resizable-panel"]');
    expect(panels.length).toBe(2);
    expect(screen.getByText("Chat").closest('[data-slot="resizable-panel"]')).toBe(panels.item(0));
    expect(panels[1]?.textContent).toBe("Tools");
  } finally {
    view.unmount();
    queryClient.clear();
    tools.mockRestore();
    chat.mockRestore();
  }
});

test("a branch change and later refresh each obtain a current read", async () => {
  const treeKey = filesystemQueryKeys.tree("/repo");
  let treeReads = 0;
  function ChatWithTree() {
    useQuery({
      queryKey: treeKey,
      queryFn: async () => ++treeReads,
      staleTime: Infinity,
    });
    return <div />;
  }
  const preview = mockFilePreview(() => <div />);
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(ChatWithTree);
  const queryClient = newQueryClient();
  const view = renderClosedSession(queryClient, "main");
  try {
    await waitFor(() => expect(treeReads).toBe(1));

    view.setBranch("feature", undefined, true);
    await act(async () => {
      await invalidateWorkspaceFileQueries(queryClient, "/repo");
    });
    view.setBranch("feature");

    expect(treeReads).toBe(3);
  } finally {
    view.unmount();
    queryClient.clear();
    chat.mockRestore();
    preview.mockRestore();
  }
});

test("a closed worktree panel tracks branch changes without losing a draft", async () => {
  function Preview() {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="File draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }
  const preview = mockFilePreview(Preview);
  let refreshTools = () => {};
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(
    ({ onToolRefresh }) => {
      refreshTools = onToolRefresh;
      return <div />;
    },
  );
  const worktreePath = "/repo/worktree";
  let worktreeBranch = "main";
  let branchError: Error | null = null;
  let holdBranchRead = false;
  let releaseBranchRead: (() => void) | null = null;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetCurrentBranch: async (_repoPath, workingDir) => {
          if (holdBranchRead) {
            await new Promise<void>((resolve) => (releaseBranchRead = resolve));
          }
          if (branchError) throw branchError;
          return {
            name: workingDir === worktreePath ? worktreeBranch : "repo-root",
            detached: false,
          };
        },
      },
    }),
  );
  const queryClient = newQueryClient();
  const worktreeRecord: WorkspaceSession = {
    ...record,
    executionTarget: {
      kind: "local_worktree",
      workingDirectory: worktreePath,
      branchName: "main",
      worktreeState: "present",
    },
  };
  const view = renderClosedSession(queryClient, "main", undefined, worktreeRecord);
  try {
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:main"));
    const input = screen.getByRole("textbox", { name: "File draft" });
    fireEvent.change(input, { target: { value: "unsaved draft" } });
    const textKey = filesystemQueryKeys.textFile(worktreePath, "file.ts");
    queryClient.setQueryData(textKey, "old branch");

    worktreeBranch = "feature";
    holdBranchRead = true;
    act(() => refreshTools());
    await waitFor(() => expect(releaseBranchRead).not.toBeNull());
    expect(preview.mock.calls.at(-1)?.[0].branch).toBeNull();
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
    holdBranchRead = false;
    await act(async () => releaseBranchRead?.());

    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:feature"));
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
    await waitFor(() => expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true));

    branchError = new Error("Git branch read failed");
    act(() => refreshTools());
    await screen.findByText("Could not read worktree branch: Git branch read failed");
    expect(preview.mock.calls.at(-1)?.[0].branch).toBeNull();
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);

    branchError = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry branch" }));
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:feature"));
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);

    queryClient.setQueryData(textKey, "cached before focus");
    worktreeBranch = "focus-branch";
    act(() => globalThis.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:focus-branch"));
    await waitFor(() => expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true));
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
  } finally {
    view.unmount();
    queryClient.clear();
    chat.mockRestore();
    preview.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("a root chat checks the branch after a tool runs and keeps its draft on read failure", async () => {
  function Preview() {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="File draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }
  const preview = mockFilePreview(Preview);
  let refreshTools = () => {};
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(
    ({ onToolRefresh }) => {
      refreshTools = onToolRefresh;
      return <div />;
    },
  );
  let branch = "feature";
  let branchError: Error | null = null;
  let releaseRead: (() => void) | null = null;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetCurrentBranch: async () => {
          await new Promise<void>((resolve) => (releaseRead = resolve));
          if (branchError) throw branchError;
          return { name: branch, detached: false };
        },
      },
    }),
  );
  const queryClient = newQueryClient();
  queryClient.setQueryData(currentBranchQueryOptions("/repo").queryKey, {
    name: "main",
    detached: false,
  });
  const view = renderClosedSession(queryClient, "main");
  try {
    const input = screen.getByRole("textbox", { name: "File draft" });
    fireEvent.change(input, { target: { value: "unsaved draft" } });

    act(() => refreshTools());
    await waitFor(() => expect(releaseRead).not.toBeNull());
    expect(preview.mock.calls.at(-1)?.[0].branch).toBeNull();
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
    await act(async () => releaseRead?.());
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:feature"));

    branchError = new Error("Git branch read failed");
    releaseRead = null;
    act(() => refreshTools());
    await waitFor(() => expect(releaseRead).not.toBeNull());
    expect(preview.mock.calls.at(-1)?.[0].branch).toBeNull();
    await act(async () => releaseRead?.());
    await screen.findByText("Could not read repository branch: Git branch read failed");
    expect(preview.mock.calls.at(-1)?.[0].branch).toBeNull();
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);

    branchError = null;
    branch = "next";
    releaseRead = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry branch" }));
    await waitFor(() => expect(releaseRead).not.toBeNull());
    await act(async () => releaseRead?.());
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:next"));
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
  } finally {
    view.unmount();
    queryClient.clear();
    chat.mockRestore();
    preview.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("a root chat waits for its first branch before opening a file draft", async () => {
  function Preview() {
    return <input aria-label="File draft" />;
  }
  const preview = mockFilePreview(Preview);
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => <div />);
  const queryClient = newQueryClient();
  const view = renderClosedSession(queryClient, undefined);
  try {
    expect(screen.queryByRole("textbox", { name: "File draft" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Checking repository branch");

    act(() => {
      queryClient.setQueryData(currentBranchQueryOptions("/repo").queryKey, {
        name: "main",
        detached: false,
      });
    });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "File draft" })).toBeTruthy());
  } finally {
    view.unmount();
    queryClient.clear();
    chat.mockRestore();
    preview.mockRestore();
  }
});

test("a detached HEAD change gets a new preview branch identity", () => {
  function Preview() {
    return <div />;
  }
  const preview = mockFilePreview(Preview);
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => <div />);
  const queryClient = newQueryClient();
  const view = renderClosedSession(queryClient, null, "first");
  try {
    expect(preview.mock.calls.at(-1)?.[0].branch).toBe("detached:first");

    view.setBranch(null, "second");

    expect(preview.mock.calls.at(-1)?.[0].branch).toBe("detached:second");
  } finally {
    view.unmount();
    chat.mockRestore();
    preview.mockRestore();
    queryClient.clear();
  }
});

test("a file edit refreshes file queries while the tools panel is closed", async () => {
  function Preview() {
    return <div />;
  }
  const preview = mockFilePreview(Preview);
  let finishEdit = () => {};
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(
    ({ onToolRefresh }) => {
      finishEdit = onToolRefresh;
      return <div />;
    },
  );
  const queryClient = newQueryClient();
  const view = renderClosedSession(queryClient, "main");
  try {
    const textKey = filesystemQueryKeys.textFile("/repo", "file.ts");
    const treeKey = filesystemQueryKeys.tree("/repo");
    queryClient.setQueryData(textKey, "old text");
    queryClient.setQueryData(treeKey, "old tree");

    act(() => finishEdit());

    await waitFor(() => {
      expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(treeKey)).toBeUndefined();
    });
  } finally {
    view.unmount();
    chat.mockRestore();
    preview.mockRestore();
    queryClient.clear();
  }
});

test.each(["records", "live"] as const)(
  "shows the %s error with an explicit Retry action",
  (source) => {
    let retries = 0;
    const view = render(
      <AgentSessionReadModelStateContext
        value={{
          sessionReadModelLoadState:
            source === "live"
              ? {
                  kind: "failed",
                  workspaceRepoPath: "/repo",
                  message: "Live status failed",
                  source: "live-stream",
                }
              : { kind: "ready", workspaceRepoPath: "/repo" },
          workspaceSessionRecordsError: "Chat records failed",
          getSessionFault: () => null,
          reloadSessionReadModel: () => {
            retries += 1;
          },
        }}
      >
        <WorkspaceSessionReadModelNotice />
      </AgentSessionReadModelStateContext>,
    );
    try {
      expect(view.getByRole("alert").textContent).toContain(
        source === "live" ? "Live status failed" : "Chat records failed",
      );
      fireEvent.click(view.getByRole("button", { name: "Retry" }));
      expect(retries).toBe(1);
    } finally {
      view.unmount();
    }
  },
);
