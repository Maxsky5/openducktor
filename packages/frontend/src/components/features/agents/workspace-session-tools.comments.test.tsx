import { afterEach, expect, mock, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { readInlineCommentDraftsFromStorage } from "@/state/inline-comment-draft-storage";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  toInlineCommentDraftOwnerKey,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
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
    workspaceId: commentOwner.workspaceId,
    sessionId: commentOwner.sessionId,
    workingDirectory,
    contextMode,
    branchKey: "feature",
    currentBranch: { name: "feature", detached: false },
    branchReady: true,
    target: { branch: "main", remote: "origin" },
    targetError: null,
    applyTarget: async () => {},
    retryTarget: async () => {},
    readBranch: async () => "feature",
    isFilesActive: isVisible,
    selectedFile: null,
    onSelectFile: () => {},
  });
  return isVisible ? filesContent : null;
}

afterEach(resetInlineCommentDraftStoreForTests);

for (const contextMode of ["repository", "worktree"] as const) {
  test.each(
    (["uncommitted", "target"] as const).flatMap((diffScope) =>
      (["open", "closed"] as const).map((tools) => ({ diffScope, tools })),
    ),
  )(
    `validates restored ${contextMode} $diffScope comments after a full read with tools $tools`,
    async ({ diffScope, tools }) => {
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
      const ownerKey = toInlineCommentDraftOwnerKey(commentOwner);
      if (ownerKey === null) throw new Error("Expected a workspace comment owner.");
      const setStorage = () => {
        setInlineCommentDraftStorageForTests(storage);
        setInlineCommentDraftScheduleTaskForTests(() => () => {});
      };
      setStorage();
      for (const filePath of ["src/missing.ts", "src/present.ts"]) {
        useInlineCommentDraftStore.getState().addDraft(ownerKey, {
          filePath,
          diffScope,
          startLine: 1,
          endLine: 1,
          side: "new",
          text: "Restored comment",
          codeContext: [],
        });
      }
      useInlineCommentDraftStore.getState().flush();
      resetInlineCommentDraftStoreForTests();
      setStorage();
      useInlineCommentDraftStore.getState().hydrate(ownerKey);
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
      configureShellBridge(
        createShellBridgeFixture({
          client: {
            gitGetComparisonTarget: async () => ({ kind: "available", reference: "origin/main" }),
            gitGetWorktreeStatus: read,
            gitGetWorktreeStatusSummary: async (_repo, _target, scope = "uncommitted") => {
              const full = status(scope);
              return {
                currentBranch: full.currentBranch,
                fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
                targetAheadBehind: full.targetAheadBehind,
                upstreamAheadBehind: full.upstreamAheadBehind,
                snapshot: full.snapshot,
              };
            },
          },
        }),
      );
      const queryClient = createQueryClient();
      queryClient.setQueryData(
        settingsSnapshotQueryOptions().queryKey,
        createSettingsSnapshotFixture(),
      );
      const panel = (isVisible: boolean) => (
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <SettingsModalProvider>
              <ToolsOwner {...{ isVisible, contextMode, workingDirectory }} />
            </SettingsModalProvider>
          </ThemeProvider>
        </QueryClientProvider>
      );
      const view = render(panel(true));
      try {
        await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(0));
        await waitFor(() =>
          expect(read.mock.calls.some((call) => call[2] === diffScope)).toBe(true),
        );
        expect(useInlineCommentDraftStore.getState().getDraftCount(ownerKey)).toBe(2);
        expect(screen.queryByTestId("agent-studio-git-pull-button")).toBeNull();
        if (tools === "closed") {
          view.rerender(panel(false));
          expect(screen.queryByRole("tablist", { name: "Workspace session tools" })).toBeNull();
        }
        const reads = read.mock.calls.length;
        await act(async () => completed.resolve(status(diffScope)));
        await waitFor(() =>
          expect(
            useInlineCommentDraftStore
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
          await queryClient.cancelQueries();
          queryClient.clear();
        });
        configureShellBridge(createUnavailableShellBridge());
      }
    },
  );
}
