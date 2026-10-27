import { expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { type ComponentProps, type PropsWithChildren, Profiler, isValidElement, memo } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { AgentChatForkButton } from "@/components/features/agents/agent-chat/agent-chat-fork-actions";
import { AgentChatForkActionsContext } from "@/components/features/agents/agent-chat/agent-chat-fork-context";
import { QueryProvider } from "@/test-utils/query-provider";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { forkWorkspaceSession } from "@openducktor/frontend-core/sessions/session-forks";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { WorkspaceSessionForkDialog } from "./workspace-session-fork-dialog";
import { useWorkspaceSessionFork } from "./use-workspace-session-fork";

const source: WorkspaceSession = {
  id: "source",
  runtimeKind: "codex",
  externalSessionId: "native-source",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  manualTitle: "Source",
  targetBranch: null,
  generatedTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};

const dialogProps = (dialog: ReturnType<typeof useWorkspaceSessionFork>["dialog"]) => {
  if (!isValidElement<ComponentProps<typeof WorkspaceSessionForkDialog>>(dialog))
    throw new Error("Expected the fork dialog");
  return dialog.props;
};

test("keeps historical fork buttons idle for record updates and publishes changes to fork controls", async () => {
  const completion = Promise.withResolvers<never>();
  const failure = new Error("The runtime refused this fork.");
  const connection = createTestClientConnection({
    client: { workspaceSessionFork: () => completion.promise },
  });
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
  const point = { messageId: "reply" };
  let commits = 0;
  let fork!: ReturnType<typeof useWorkspaceSessionFork>;
  const HistoricalReply = memo(() => (
    <Profiler id="historical-reply" onRender={() => commits++}>
      <AgentChatForkButton point={point} />
    </Profiler>
  ));
  const Chat = ({
    record,
    disabledReason,
  }: {
    record: WorkspaceSession;
    disabledReason: string | null;
  }) => {
    fork = useWorkspaceSessionFork({
      workspace: { ...workspace },
      record,
      visible: true,
      disabledReason,
    });
    return (
      <AgentChatForkActionsContext value={fork.actions}>
        <HistoricalReply />
      </AgentChatForkActionsContext>
    );
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryProvider connection={connection}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryProvider>
  );
  const view = render(<Chat record={source} disabledReason={null} />, { wrapper });
  let pendingRequest: Promise<unknown> | undefined;
  try {
    const initialCommits = commits;
    view.rerender(
      <Chat
        record={{ ...source, manualTitle: "Updated title", updatedAt: 2 }}
        disabledReason={null}
      />,
    );
    expect(commits).toBe(initialCommits);

    view.rerender(<Chat record={source} disabledReason="Start Codex in Settings, then retry." />);
    expect(
      view.getByRole("button", { name: "Fork from this reply" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(view.getByLabelText("Start Codex in Settings, then retry.").tabIndex).toBe(0);

    const changedSource = { ...source, externalSessionId: "native-other" };
    view.rerender(<Chat record={changedSource} disabledReason={null} />);
    fireEvent.click(view.getByRole("button", { name: "Fork from this reply" }));
    expect(dialogProps(fork.dialog).source.externalSessionId).toBe("native-other");
    act(() => dialogProps(fork.dialog).onClose());

    act(() => {
      pendingRequest = forkWorkspaceSession(
        connection.queryClient,
        createAgentSessionsStore("/repo"),
        workspace.repoPath,
        { runtimeKind: "codex", workingDirectory: "/repo", externalSessionId: "native-other" },
        {
          workspaceId: workspace.workspaceId,
          sessionId: source.id,
          forkPoint: point,
          destination: { kind: "same_folder" },
        },
      ).catch((cause: unknown) => expect(cause).toBe(failure));
    });
    expect(view.getByLabelText("Forking chat…").tabIndex).toBe(0);
    expect(
      view.getByRole("button", { name: "Fork from this reply" }).hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => {
      completion.reject(failure);
      await pendingRequest;
    });
    expect(
      view.getByRole("button", { name: "Fork from this reply" }).hasAttribute("disabled"),
    ).toBe(false);

    view.rerender(<Chat record={{ ...changedSource, archivedAt: 3 }} disabledReason={null} />);
    expect(view.queryByRole("button", { name: "Fork from this reply" })).toBeNull();
  } finally {
    if (pendingRequest) {
      completion.reject(failure);
      await pendingRequest;
    }
    view.unmount();
    connection.queryClient.clear();
  }
});

test("closes the committed workspace fork dialog before navigation lets the child composer take focus", () => {
  const store = createAgentSessionsStore("/repo");
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryProvider>
      <AgentSessionsContext value={store}>
        <MemoryRouter initialEntries={["/sessions?session=source"]}>{children}</MemoryRouter>
      </AgentSessionsContext>
    </QueryProvider>
  );
  const view = renderHook(
    () => {
      const location = useLocation();
      const fork = useWorkspaceSessionFork({
        workspace: { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" },
        record: source,
        visible: true,
        disabledReason: null,
      });
      return { fork, address: `${location.pathname}${location.search}` };
    },
    { wrapper },
  );
  try {
    act(() => {
      view.result.current.fork.actions?.onFork({ messageId: "reply" });
    });
    act(() => {
      dialogProps(view.result.current.fork.dialog).onForked({
        ...source,
        id: "child",
        externalSessionId: "native-child",
      });
    });
    expect(dialogProps(view.result.current.fork.dialog).open).toBe(false);
    expect(view.result.current.address).toBe("/sessions?session=source");
    const closeFocus = new Event("close", { cancelable: true });
    act(() => {
      dialogProps(view.result.current.fork.dialog).onCloseAutoFocus?.(closeFocus);
    });
    expect(closeFocus.defaultPrevented).toBe(true);
    expect(view.result.current.address).toBe(
      "/sessions?workspace=workspace&kind=workspace&session=child",
    );
  } finally {
    view.unmount();
  }
});
