import { afterEach, expect, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { Folder } from "lucide-react";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { QueryProvider } from "@/lib/query-provider";
import {
  createBuildToolsSnapshotFixture,
  createGitActionsFixture,
} from "@/pages/agents/shell/agents-page-build-tools.test-support";
import { readInlineCommentDraftsFromStorage } from "@/state/inline-comment-draft-storage";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  toInlineCommentDraftOwnerKey,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import { WorkspaceSessionGitTools } from "./workspace-session-git-tools";

afterEach(resetInlineCommentDraftStoreForTests);

for (const contextMode of ["repository", "worktree"] as const) {
  test.each(["uncommitted", "target"] as const)(
    `validates restored ${contextMode} %s comments while File explorer is active`,
    async (diffScope) => {
      resetInlineCommentDraftStoreForTests();
      const values = new Map<string, string>();
      const storage = {
        get length() {
          return values.size;
        },
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      };
      const commentOwner = {
        kind: "workspace_session",
        workspaceId: "workspace",
        sessionId: "session",
      } as const;
      const ownerKey = toInlineCommentDraftOwnerKey(commentOwner);
      if (ownerKey === null) throw new Error("Expected a workspace comment owner.");
      const setStorage = () => {
        setInlineCommentDraftStorageForTests(storage);
        setInlineCommentDraftScheduleTaskForTests(() => () => {});
      };
      setStorage();
      useInlineCommentDraftStore.getState().addDraft(ownerKey, {
        filePath: "src/missing.ts",
        diffScope,
        startLine: 1,
        endLine: 1,
        side: "new",
        text: "Restored comment",
        codeContext: [],
      });
      useInlineCommentDraftStore.getState().flush();
      resetInlineCommentDraftStoreForTests();
      setStorage();
      useInlineCommentDraftStore.getState().hydrate(ownerKey);
      expect(useInlineCommentDraftStore.getState().getDraftCount(ownerKey)).toBe(1);

      const diffData = createBuildToolsSnapshotFixture().diffData;
      const view = render(
        <WorkspaceSessionGitTools
          commentOwner={commentOwner}
          devServerOwner={commentOwner}
          actions={createGitActionsFixture(null)}
          repoPath="/repo"
          workingDirectory={contextMode === "repository" ? "/repo" : "/repo/worktree"}
          contextMode={contextMode}
          branchReady={true}
          resolvedTarget="origin/main"
          unavailableReason={null}
          isFetchingTarget={false}
          refresh={async () => {}}
          diffData={{ ...diffData, loadedScopesByScope: { uncommitted: true, target: true } }}
          tools={{
            activeTabId: "file_explorer",
            onActiveTabChange: () => {},
            tabListLabel: "Workspace tools",
            testIdPrefix: "workspace-tools",
            headerActions: null,
            tabs: [
              {
                id: "file_explorer",
                label: "File explorer",
                icon: Folder,
                content: <div>Files</div>,
              },
            ],
          }}
        />,
        {
          wrapper: ({ children }) => (
            <QueryProvider useIsolatedClient>
              <ThemeProvider>
                <SettingsModalProvider>{children}</SettingsModalProvider>
              </ThemeProvider>
            </QueryProvider>
          ),
        },
      );
      try {
        expect(screen.getByText("Files")).toBeTruthy();
        expect(screen.queryByTestId("agent-studio-git-pull-button")).toBeNull();
        await waitFor(() =>
          expect(useInlineCommentDraftStore.getState().getDraftCount(ownerKey)).toBe(0),
        );
        expect(readInlineCommentDraftsFromStorage({ storage, ownerKey }).status).toBe("empty");
      } finally {
        view.unmount();
      }
    },
  );
}
