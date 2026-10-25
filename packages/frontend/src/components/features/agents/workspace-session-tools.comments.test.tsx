import { expect, mock, test } from "bun:test";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { readInlineCommentDraftsFromStorage } from "@openducktor/frontend-core/drafts/inline-comment-draft-storage";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { toInlineCommentDraftOwnerKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { createMemoryClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { toLocalChanges } from "@openducktor/frontend-core/test-support/local-changes-fixture";
import { workspaceSessionGitSource } from "@/test-utils/workspace-session-git-source";
import { useWorkspaceSessionTools } from "./use-workspace-session-tools";

const commentOwner = {
  kind: "workspace_session",
  workspaceId: "workspace",
  sessionId: "session",
} as const;

function ToolsOwner({
  isVisible,
  contextMode,
  workingDirectory,
}: {
  isVisible: boolean;
  contextMode: "repository" | "worktree";
  workingDirectory: string;
}) {
  const { filesContent } = useWorkspaceSessionTools({
    isVisible,
    repoPath: "/repo",
    workspaceSession: { workspaceId: commentOwner.workspaceId, sessionId: commentOwner.sessionId },
    contextMode,
    git: workspaceSessionGitSource({
      workingDirectory,
      branchKey: "feature",
      currentBranch: { name: "feature", detached: false },
      branchReady: true,
      target: { branch: "main", remote: "origin" },
      savedTarget: { branch: "main", remote: "origin" },
      targetError: null,
      retryTarget: async () => {},
      readBranch: async () => "feature",
    }),
    applyTarget: async () => {},
    isFilesActive: isVisible,
    selectedFile: null,
    onSelectFile: () => {},
  });
  return isVisible ? filesContent : null;
}

const stopDraftTimers = () => () => {};

for (const contextMode of ["repository", "worktree"] as const) {
  test.each(
    (["uncommitted", "target"] as const).flatMap((diffScope) =>
      (["open", "closed"] as const).map((tools) => ({ diffScope, tools })),
    ),
  )(
    `validates restored ${contextMode} $diffScope comments after a full read with tools $tools`,
    async ({ diffScope, tools }) => {
      const storage = createMemoryClientStorage();
      const ownerKey = toInlineCommentDraftOwnerKey(commentOwner);
      if (ownerKey === null) throw new Error("Expected a workspace comment owner.");
      // An earlier app session saved the comments.
      const earlierSession = createTestClientConnection({ storage, scheduleTask: stopDraftTimers });
      for (const filePath of ["src/missing.ts", "src/present.ts"]) {
        earlierSession.drafts.inlineComments.getState().addDraft(ownerKey, {
          filePath,
          diffScope,
          startLine: 1,
          endLine: 1,
          side: "new",
          text: "Restored comment",
          codeContext: [],
        });
      }
      earlierSession.drafts.inlineComments.getState().flush();
      await earlierSession.dispose();
      const workingDirectory = contextMode === "repository" ? "/repo" : "/repo/worktree";
      const status = (scope: "uncommitted" | "target"): GitWorktreeStatus => ({
        currentBranch: { name: "feature", detached: false },
        fileStatuses: [{ path: "src/present.ts", status: "M", staged: false }],
        fileDiffs: [
          { file: "src/present.ts", type: "modified", additions: 1, deletions: 0, diff: "" },
        ],
        targetAheadBehind: { ahead: 0, behind: 0 },
        upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
        snapshot: {
          effectiveWorkingDir: workingDirectory,
          targetBranch: "origin/main",
          diffScope: scope,
          observedAtMs: 1,
          hashVersion: 1,
          statusHash: "0123456789abcdef",
          diffHash: "fedcba9876543210",
        },
      });
      const completed = createDeferred<GitWorktreeStatus>();
      const read = mock(async (_repo: string, _target: string, scope: "uncommitted" | "target") =>
        scope === diffScope ? completed.promise : status(scope),
      );
      const connection = createTestClientConnection({
        storage,
        scheduleTask: stopDraftTimers,
        client: {
          gitGetComparisonTarget: async () => ({ kind: "available", reference: "origin/main" }),
          gitGetWorktreeStatus: read,
          // Local changes use the uncommitted status fixture, so `read` records both scopes.
          gitGetLocalChanges: async (repo) =>
            toLocalChanges(await read(repo, "HEAD", "uncommitted")),
        },
      });
      const comments = connection.drafts.inlineComments;
      comments.getState().hydrate(ownerKey);
      const queryClient = connection.queryClient;
      queryClient.setQueryData(
        settingsSnapshotQueryOptions().queryKey,
        createSettingsSnapshotFixture(),
      );
      const panel = (isVisible: boolean) => (
        <ClientConnectionProvider connection={connection}>
          <ThemeProvider>
            <SettingsModalProvider>
              <ToolsOwner {...{ isVisible, contextMode, workingDirectory }} />
            </SettingsModalProvider>
          </ThemeProvider>
        </ClientConnectionProvider>
      );
      const view = render(panel(true));
      try {
        await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(0));
        await waitFor(() =>
          expect(read.mock.calls.some((call) => call[2] === diffScope)).toBe(true),
        );
        expect(comments.getState().getDraftCount(ownerKey)).toBe(2);
        expect(screen.queryByTestId("agent-studio-git-pull-button")).toBeNull();
        if (tools === "closed") {
          view.rerender(panel(false));
          expect(screen.queryByRole("tablist", { name: "Workspace session tools" })).toBeNull();
        }
        const reads = read.mock.calls.length;
        await act(async () => completed.resolve(status(diffScope)));
        await waitFor(() =>
          expect(
            comments
              .getState()
              .getPendingDrafts(ownerKey)
              .map((draft) => draft.filePath),
          ).toEqual(["src/present.ts"]),
        );
        expect(read.mock.calls.length).toBe(reads);
        const saved = readInlineCommentDraftsFromStorage({ storage, ownerKey });
        if (saved.status !== "restored") throw new Error("Expected the valid comment in storage.");
        expect(saved.comments.map((draft) => draft.filePath)).toEqual(["src/present.ts"]);
      } finally {
        completed.resolve(status(diffScope));
        await act(async () => {
          view.unmount();
          await connection.dispose();
        });
      }
    },
  );
}
