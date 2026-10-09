import { expect, mock, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import type { HostClient } from "@openducktor/host-client";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import { ChatFileLinkProvider } from "@/components/features/agents/agent-chat/agent-chat-file-link-provider";
import { AgentChatMarkdownRenderer } from "@/components/features/agents/agent-chat/agent-chat-markdown-renderer";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, getShellBridge } from "@/lib/shell-bridge";
import { currentBranchQueryOptions, worktreeBranchQueryOptions } from "@/state/queries/git";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { useWorkspaceSessionBranch } from "./use-workspace-session-branch";
import {
  WorkspaceSessionFilePreview,
  type WorkspaceSessionFilePreviewHandle,
} from "./workspace-session-file-preview";

for (const isWorktree of [false, true]) {
  for (const access of ["local", "workspace"] as const) {
    test(`${isWorktree ? "worktree" : "repository"} branch failures only block workspace file previews: ${access}`, async () => {
      const previousBridge = getShellBridge();
      const client = createQueryClient();
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
      configureShellBridge(
        createShellBridgeFixture({
          client: {
            gitGetCurrentBranch: async () => {
              throw new Error("Git directory is unavailable");
            },
            filesystemResolvePath: async (path) => path,
            gitCanonicalizePath: async (path) => path.replace("/tmp/", "/private/tmp/"),
            filesystemReadTextFile: read,
          },
        }),
      );
      function Preview() {
        const ref = useRef<WorkspaceSessionFilePreviewHandle>(null);
        const branch = useWorkspaceSessionBranch({
          repoPath: "/repo",
          workingDirectory,
          isWorktree,
          isSwitchingBranch: false,
          activeBranch: null,
        });
        return (
          <>
            <ChatFileLinkProvider
              owner={{
                kind: "workspace",
                repoPath: "/repo",
                workingDirectory,
                ownerKey: "session",
                onSelectFile: (file) => ref.current?.onSelectFile(file),
              }}
            >
              <AgentChatMarkdownRenderer
                markdown={access === "local" ? "[image](/tmp/screenshot.png)" : "[file](file.ts)"}
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
          <QueryClientProvider client={client}>
            <WorkspacePreviewTransitionGuardProvider>
              <Preview />
            </WorkspacePreviewTransitionGuardProvider>
          </QueryClientProvider>,
        );
        await act(async () => fireEvent.click(view!.getByRole("link")));
        if (access === "local") {
          const image = await view.findByRole("img");
          expect(image.getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
          expect(read).toHaveBeenCalledWith({
            rootPath: "/private/tmp",
            relativePath: "screenshot.png",
            access: "local",
          });
          expect(view.queryByRole("button", { name: "Retry branch" })).toBeNull();
          fireEvent.click(view.getByRole("button", { name: "Close file preview" }));
          await waitFor(() => expect(view!.queryByRole("img")).toBeNull());
          expect(onSelectionChange.mock.calls.at(-1)).toEqual([null]);
        } else {
          expect((await view.findByRole("alert")).textContent).toContain(
            "Git directory is unavailable",
          );
          expect(view.getByRole("button", { name: "Retry branch" })).toBeTruthy();
          expect(read).not.toHaveBeenCalled();
          expect(view.queryByRole("img")).toBeNull();
        }
      } finally {
        view?.unmount();
        client.clear();
        configureShellBridge(previousBridge);
      }
    });
  }
}
