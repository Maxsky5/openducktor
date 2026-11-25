import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import type { HostClient } from "@openducktor/host-client";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import { ChatFileLinkProvider } from "@/components/features/agents/agent-chat/agent-chat-file-link-provider";
import { AgentChatMarkdownRenderer } from "@/components/features/agents/agent-chat/agent-chat-markdown-renderer";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  currentBranchQueryOptions,
  worktreeBranchQueryOptions,
} from "@openducktor/frontend-core/queries/git";
import { useWorkspaceSessionBranch } from "@openducktor/frontend-core/git/workspace-session/use-workspace-session-branch";
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
