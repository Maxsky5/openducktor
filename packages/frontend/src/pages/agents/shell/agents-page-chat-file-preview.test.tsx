import { expect, spyOn, test } from "bun:test";
import { act, fireEvent, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { createDialogPreviewHarness } from "@/components/features/agents/agent-chat/agent-session-dialog-preview-test-harness";
import {
  buildMessage,
  buildSession,
  buildSessionTranscript,
} from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import { useTaskExecutionFilePreviewController } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { AgentsPageLayout, type AgentsPageLayoutModel } from "./agents-page-layout";
import * as modals from "./agents-page-modal-content";
import {
  createAgentChatModelFixture,
  createAgentStudioHeaderModelFixture,
  createAgentStudioTaskTabsModelFixture,
} from "./use-agents-page-shell-model.test-support";

function MainChatPreview() {
  const preview = useTaskExecutionFilePreviewController();
  const [taskId, setTaskId] = useState("a");
  const chatModel = useMemo(() => {
    const fixture = createAgentChatModelFixture();
    const session = buildSession({
      externalSessionId: taskId,
      messages: createSessionMessagesState(taskId, [
        buildMessage("assistant", `Task ${taskId}. [Open file](src/file.ts)`),
      ]),
    });
    return {
      chatSettings: fixture.chatSettings,
      thread: { ...fixture.thread, transcript: buildSessionTranscript(session) },
    };
  }, [taskId]);
  const model: AgentsPageLayoutModel = {
    activeWorkspace: { workspaceId: "repo", workspaceName: "Repo", repoPath: "/repo" },
    activeTabValue: taskId,
    navigationPersistenceError: null,
    chatSettingsLoadError: null,
    gitProviderContextLoadError: null,
    onRetryNavigationPersistence: () => {},
    onRetryChatSettingsLoad: () => {},
    onRetryGitProviderContext: () => {},
    onTabValueChange: () => {},
    taskTabsModel: createAgentStudioTaskTabsModelFixture(),
    rightPanelToggleModel: undefined,
    hasSelectedTask: true,
    chatHeaderModel: createAgentStudioHeaderModelFixture(),
    chatModel,
    chatFileLinkOwner: {
      repoPath: "/repo",
      taskId,
      ownerKey: taskId,
      onSelectFile: preview.onSelectFile,
    },
    taskExecutionSelectedFilePreviewModel: preview.model,
    isRightPanelVisible: false,
    rightPanelBridge: null,
    selectedFileRefresh: null,
    modalContent: {
      humanReviewFeedbackModal: null,
      sessionStartModal: null,
      mergedPullRequestModal: null,
      taskDetailsLauncher: {
        taskEditor: null,
        openTaskDetails: () => {},
        taskDetailsSheetRef: { current: null },
        taskDetailsSheetProps: {
          allTasks: [],
          taskSessionsByTaskId: new Map(),
          historicalSessionsByTaskId: new Map(),
          activeTaskSessionContextByTaskId: new Map(),
        },
      },
    },
    terminalPanel: {
      scopeKey: taskId,
      isAvailable: false,
      tabs: [],
      mountedTabs: [],
      activeTabId: null,
      isVisible: false,
      isLoading: false,
      isCreating: false,
      transportError: null,
      platform: "darwin",
      platformError: null,
      focusRequest: 0,
      controller: null,
      onToggle: () => {},
      onHide: () => {},
      onSelectTab: () => {},
      onCreate: () => {},
      onRetryCreate: () => {},
      onReorderTab: () => {},
      onTitleChange: () => {},
      onClose: async () => ({ closed: true }),
      onLifecycle: () => {},
      onForgotten: () => {},
    },
  };
  return (
    <>
      <button type="button" onClick={() => preview.requestContextTransition(() => setTaskId("b"))}>
        Switch task
      </button>
      <AgentsPageLayout model={model} />
    </>
  );
}

for (const departure of [false, true]) {
  test(`main chat returns keyboard focus only to the same owner; departure=${departure}`, async () => {
    const modalSpy = spyOn(modals, "AgentsPageModalContent").mockImplementation(() => <></>);
    const h = createDialogPreviewHarness("src/file.ts", <MainChatPreview />);
    try {
      const link = await screen.findByRole("link", { name: "Open file" });
      link.focus();
      fireEvent.keyDown(link, { key: "Enter" });
      await screen.findByDisplayValue("Contents of /repo/a");
      const focus = spyOn(link, "focus");
      try {
        if (departure) {
          const changeTask = screen.getByRole("button", { name: "Switch task" });
          changeTask.focus();
          fireEvent.click(changeTask);
          expect(focus).not.toHaveBeenCalled();
          expect(document.activeElement).toBe(changeTask);
          expect(screen.queryByLabelText("Selected file preview")).toBeNull();
          await h.selectFile();
          expect(screen.getByDisplayValue("Contents of /repo/b")).toBeTruthy();
        } else {
          fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
          expect(screen.getByRole("link", { name: "Open file" })).toBe(link);
          expect(document.activeElement).toBe(link);
          expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        }
      } finally {
        focus.mockRestore();
      }
    } finally {
      h.dispose();
      modalSpy.mockRestore();
    }
  });
}

test("main chat remembers the invoking link when focus moves during worktree lookup", async () => {
  const modalSpy = spyOn(modals, "AgentsPageModalContent").mockImplementation(() => <></>);
  const h = createDialogPreviewHarness("src/file.ts", <MainChatPreview />);
  const deferred = Promise.withResolvers<string>();
  h.canonicalize.mockImplementationOnce(() => deferred.promise);
  try {
    const link = await screen.findByRole("link", { name: "Open file" });
    link.focus();
    await act(async () => fireEvent.keyDown(link, { key: "Enter" }));
    screen.getByRole("button", { name: "Switch task" }).focus();
    await act(async () => deferred.resolve("/repo/a"));
    await screen.findByDisplayValue("Contents of /repo/a");
    fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    expect(document.activeElement === link).toBe(true);
  } finally {
    h.dispose();
    modalSpy.mockRestore();
  }
});
