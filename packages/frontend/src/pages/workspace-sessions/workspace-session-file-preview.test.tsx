import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import type { HostClient } from "@openducktor/host-client";
import {
  taskExecutionSelectedFileKey,
  type TaskExecutionSelectedFile,
} from "@/components/features/agents/task-execution-file-explorer-model";
import { ChatFileLinkProvider } from "@/components/features/agents/agent-chat/agent-chat-file-link-provider";
import { AgentChatMarkdownRenderer } from "@/components/features/agents/agent-chat/agent-chat-markdown-renderer";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  currentBranchQueryOptions,
  worktreeBranchQueryOptions,
} from "@openducktor/frontend-core/queries/git";
import { useWorkspaceSessionBranch } from "@openducktor/frontend-core/git/workspace-session/use-workspace-session-branch";
import { useArchiveWorkspaceSession } from "@openducktor/frontend-core/workspace-sessions/use-archive-workspace-session";
import { HostChannelRequestError, hostChannelInvokeError } from "@openducktor/host-client/channel";
import { windowReturnVisibility } from "@/lib/window-return-visibility";
import {
  WorkspaceSessionFilePreview,
  type WorkspaceSessionFilePreviewHandle,
} from "./workspace-session-file-preview";

for (const isWorktree of [false, true]) {
  test(`${isWorktree ? "worktree" : "repository"} branch failures block workspace files and allow local previews`, async () => {
    const workingDirectory = isWorktree ? "/repo/worktree" : "/repo";
    const read = mock<HostClient["filesystemReadTextFile"]>(async () => ({
      kind: "image" as const,
      rootPath: "/private/tmp",
      relativePath: "screenshot.png",
      mime: "image/png" as const,
      base64: "aW1hZ2U=",
      revision: "image-revision",
      size: 5,
      mtimeMs: 1,
    }));
    const onSelectionChange = mock<(file: TaskExecutionSelectedFile | null) => void>(() => {});
    const connection = createTestClientConnection({
      client: {
        gitGetCurrentBranch: async () => {
          throw new Error("Git directory is unavailable");
        },
        filesystemResolvePath: async (path) => path,
        gitCanonicalizePath: async (path) => path.replace("/tmp/", "/private/tmp/"),
        filesystemReadTextFile: read,
      },
    });
    const client = connection.queryClient;
    function Preview() {
      const ref = useRef<WorkspaceSessionFilePreviewHandle>(null);
      const branch = useWorkspaceSessionBranch({
        repoPath: "/repo",
        workingDirectory,
        isWorktree,
        isSwitchingBranch: false,
        activeBranch: null,
        visibility: windowReturnVisibility,
      });
      return (
        <>
          <ChatFileLinkProvider
            owner={{
              kind: "workspace",
              workspaceId: "workspace-1",
              repoPath: "/repo",
              workingDirectory,
              ownerKey: "session",
              onSelectFile: (file) => ref.current?.onSelectFile(file),
            }}
          >
            <AgentChatMarkdownRenderer
              markdown={"[Outside image](/tmp/screenshot.png)\n\n[Workspace file](file.ts)"}
            />
          </ChatFileLinkProvider>
          <WorkspaceSessionFilePreview
            ref={ref}
            initialFile={null}
            onSelectionChange={onSelectionChange}
            onSafeToLeave={undefined}
            isWorktree={isWorktree}
            branch={branch}
            hasRootBranch={false}
            onFileSaved={() => {}}
            workspaceSession={{ workspaceId: "workspace", sessionId: "session" }}
          />
        </>
      );
    }
    let view: ReturnType<typeof render> | undefined;
    try {
      const rootOptions = currentBranchQueryOptions("/repo");
      const worktreeOptions = worktreeBranchQueryOptions("/repo", workingDirectory);
      const key = isWorktree ? worktreeOptions.queryKey : rootOptions.queryKey;
      if (isWorktree) await client.fetchQuery(worktreeOptions).catch(() => undefined);
      else await client.fetchQuery(rootOptions).catch(() => undefined);
      expect(client.getQueryState(key)?.status).toBe("error");
      expect(client.getQueryData(key)).toBeUndefined();
      view = render(
        <ClientConnectionProvider connection={connection}>
          <WorkspacePreviewTransitionGuardProvider>
            <Preview />
          </WorkspacePreviewTransitionGuardProvider>
        </ClientConnectionProvider>,
      );
      await act(async () => fireEvent.click(view!.getByRole("link", { name: "Outside image" })));
      const image = await view.findByRole("img", {}, { timeout: 500 });
      expect(image.getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
      expect(read.mock.calls).toEqual([
        [{ rootPath: "/private/tmp", relativePath: "screenshot.png", scope: { kind: "local" } }],
      ]);
      expect(view.queryAllByRole("button", { name: "Retry branch" }).length).toBe(0);
      fireEvent.click(view.getByRole("button", { name: "Close file preview" }));
      await waitFor(() => expect(image.isConnected).toBe(false), { timeout: 500 });
      expect(onSelectionChange.mock.calls.at(-1)).toEqual([null]);

      await act(async () => fireEvent.click(view!.getByRole("link", { name: "Workspace file" })));
      expect(view.queryByRole("alert")?.textContent).toContain("Git directory is unavailable");
      expect(view.getByRole("button", { name: "Retry branch" })).toBeTruthy();
      expect(read).toHaveBeenCalledTimes(1);
      expect(view.queryAllByRole("img").length).toBe(0);
    } finally {
      view?.unmount();
      await connection.dispose();
    }
  });
}

test("archive recovery preserves other drafts and can retry when the worktree is gone", async () => {
  const workspace = { workspaceId: "workspace", repoPath: "/repo" };
  const sessionId = "chat";
  const branchName = "chat-branch";
  const file = { rootPath: "/worktrees/chat", relativePath: "first.md" };
  const other = { ...file, relativePath: "second.md" };
  const read = (path: typeof file) => ({
    ...path,
    kind: "text" as const,
    contents: "on disk",
    size: 7,
    mtimeMs: null,
    revision: "original",
  });
  const failArchives: Array<(cause: Error) => void> = [];
  let worktreeRemoved = false;
  const connection = createTestClientConnection({
    client: {
      gitGetCurrentBranch: async () => {
        if (worktreeRemoved) throw new Error("The worktree is gone.");
        return { name: branchName, detached: false };
      },
      filesystemReadTextFile: async ({ rootPath, relativePath }) =>
        read({ rootPath, relativePath }),
      workspaceSessionArchive: () =>
        new Promise((_resolve, reject) => {
          failArchives.push(reject);
        }),
    },
  });
  function Chat() {
    const { run } = useWorkspacePreviewTransitionGuard();
    const ref = useRef<WorkspaceSessionFilePreviewHandle>(null);
    const archive = useArchiveWorkspaceSession(workspace.workspaceId, sessionId);
    const branch = useWorkspaceSessionBranch({
      repoPath: workspace.repoPath,
      workingDirectory: file.rootPath,
      isWorktree: true,
      isSwitchingBranch: false,
      activeBranch: null,
      visibility: windowReturnVisibility,
    });
    return (
      <>
        <button onClick={() => ref.current?.onSelectFile(file)}>Open first</button>
        <button onClick={() => ref.current?.onSelectFile(other)}>Open second</button>
        <button
          onClick={() =>
            run(
              (draft) =>
                archive.submit(
                  {
                    ...workspace,
                    sessionId,
                    confirmStop: true,
                    removeWorktree: true,
                    worktreeConfirmation: { workingDirectory: file.rootPath, branchName },
                  },
                  { workspaceLabel: "Workspace", targetLabel: "Chat" },
                  draft,
                ),
              undefined,
              { kind: "archive_chat", waitForSuccess: true },
            )
          }
        >
          Archive session
        </button>
        <WorkspaceSessionFilePreview
          ref={ref}
          initialFile={file}
          onSelectionChange={() => {}}
          onSafeToLeave={undefined}
          isWorktree
          branch={branch}
          hasRootBranch={false}
          onFileSaved={() => {}}
          workspaceSession={{ workspaceId: workspace.workspaceId, sessionId }}
        />
      </>
    );
  }
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <WorkspacePreviewTransitionGuardProvider>
        <Chat />
      </WorkspacePreviewTransitionGuardProvider>
    </ClientConnectionProvider>,
  );
  const source = async () => {
    const markdown = await view.findByRole("button", { name: "Markdown" });
    await act(async () => fireEvent.click(markdown));
    return view.findByRole("textbox", { name: "Markdown source" });
  };
  const discard = async () => {
    const dialog = await view.findByRole("dialog", { name: "Discard unsaved changes?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
  };
  const fail = () => {
    const failArchive = failArchives.shift();
    if (!failArchive) throw new Error("Expected an archive request");
    failArchive(
      hostChannelInvokeError(
        new HostChannelRequestError({
          kind: "host",
          response: { message: "Could not stop the chat terminal." },
        }),
      ),
    );
  };
  try {
    const editor = await source();
    expect(editor).toHaveProperty("value", "on disk");
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Archive session" })));
    const retainedOther = {
      fileId: taskExecutionSelectedFileKey(other),
      baseline: read(other),
      branch: `branch:${branchName}`,
      contents: "other retained draft",
    };
    const retainedText = "typed while archive runs";
    act(() => {
      fireEvent.change(editor, { target: { value: retainedText } });
      connection.backgroundOperations.replaceArchiveDraft(
        workspace.workspaceId,
        sessionId,
        null,
        retainedOther,
      );
    });
    await act(async () => fail());

    fireEvent.click(view.getByRole("button", { name: "Close file preview" }));
    await discard();
    expect(view.queryByRole("textbox", { name: "Markdown source" })).toBeNull();
    expect(connection.backgroundOperations.getSnapshot()).toMatchObject([
      { phase: "failed", archiveDraftFileIds: [retainedOther.fileId] },
    ]);
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Open first" })));
    expect(await source()).toHaveProperty("value", "on disk");

    await act(async () => fireEvent.click(view.getByRole("button", { name: "Open second" })));
    await view.findByRole("status", { name: "Unsaved changes" });
    expect(await source()).toHaveProperty("value", retainedOther.contents);
    fireEvent.click(view.getByRole("button", { name: "Archive session" }));
    await act(async () => {
      await discard();
    });
    await act(async () => fail());
    expect(view.getByRole("textbox", { name: "Markdown source" })).toHaveProperty(
      "value",
      retainedOther.contents,
    );
    expect(
      connection.backgroundOperations.getArchiveDraft(
        workspace.workspaceId,
        sessionId,
        retainedOther.fileId,
      ),
    ).toBe(retainedOther);

    worktreeRemoved = true;
    await act(async () => {
      await connection.queryClient.resetQueries({
        queryKey: worktreeBranchQueryOptions(workspace.repoPath, file.rootPath).queryKey,
      });
    });
    await view.findByText(/The worktree is gone/);
    fireEvent.click(view.getByRole("button", { name: "Archive session" }));
    await act(async () => discard());
    expect(failArchives).toHaveLength(1);
    await act(async () => fail());
  } finally {
    view.unmount();
    await connection.dispose();
  }
}, 5000);
