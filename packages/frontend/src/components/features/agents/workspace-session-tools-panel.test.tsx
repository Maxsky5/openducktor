import { expect, mock, test } from "bun:test";
import type {
  GitComparisonTarget,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
  WorkspaceFileTree,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  WorkspaceSessionToolsPanel,
  type WorkspaceToolsTabId,
} from "./workspace-session-tools-panel";

const targetReference = "origin/main";

function worktreeStatus(
  targetBranch: string,
  diffScope: "target" | "uncommitted" = "uncommitted",
): GitWorktreeStatus {
  return {
    currentBranch: { name: "feature", detached: false },
    fileStatuses: [{ path: "draft.txt", status: "M", staged: false }],
    fileDiffs: [],
    targetAheadBehind: { ahead: 0, behind: 0 },
    upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
    snapshot: {
      effectiveWorkingDir: "/repo",
      targetBranch,
      diffScope,
      observedAtMs: 1,
      hashVersion: 1,
      statusHash: "0123456789abcdef",
      diffHash: "fedcba9876543210",
    },
  };
}

function worktreeSummary(targetBranch: string): GitWorktreeStatusSummary {
  const status = worktreeStatus(targetBranch);
  return {
    currentBranch: status.currentBranch,
    fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
    targetAheadBehind: status.targetAheadBehind,
    upstreamAheadBehind: status.upstreamAheadBehind,
    snapshot: status.snapshot,
  };
}

function PanelHarness() {
  const [activeTabId, setActiveTabId] = useState<WorkspaceToolsTabId>("git");
  return (
    <WorkspaceSessionToolsPanel
      repoPath="/repo"
      workingDirectory="/repo"
      contextMode="repository"
      target={{ branch: "@{upstream}" }}
      targetError={null}
      activeTabId={activeTabId}
      onActiveTabChange={setActiveTabId}
      selectedFile={null}
      onSelectFile={() => {}}
      onRefreshReady={() => {}}
    />
  );
}

test("refresh recovers local Git and file reads when the comparison target disappears", async () => {
  let targetAvailable = true;
  const comparison = mock(async (): Promise<GitComparisonTarget> =>
    targetAvailable
      ? { kind: "available", reference: targetReference }
      : { kind: "unavailable", reason: "Tracked upstream no longer exists." },
  );
  const statusTargets: string[] = [];
  const fileTreeTargets: Array<string | undefined> = [];
  const gitGetWorktreeStatus = mock(
    async (_repoPath: string, targetBranch: string, diffScope?: "target" | "uncommitted") => {
      statusTargets.push(targetBranch);
      if (!targetAvailable && targetBranch !== "HEAD") {
        throw new Error("Git status used the removed target");
      }
      return worktreeStatus(targetBranch, diffScope);
    },
  );
  const gitGetWorktreeStatusSummary = mock(async (_repoPath: string, targetBranch: string) => {
    if (!targetAvailable && targetBranch !== "HEAD") {
      throw new Error("Git summary used the removed target");
    }
    return worktreeSummary(targetBranch);
  });
  const filesystemListTree = mock(
    async (input: { rootPath: string; targetBranch?: string }): Promise<WorkspaceFileTree> => {
      fileTreeTargets.push(input.targetBranch);
      if (!targetAvailable && input.targetBranch) {
        throw new Error("File tree used the removed target");
      }
      return {
        rootPath: input.rootPath,
        entries: [
          {
            path: "draft.txt",
            kind: "file",
            size: 1,
            mtimeMs: 1,
            gitStatus: "modified",
          },
        ],
      };
    },
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitGetWorktreeStatus,
        gitGetWorktreeStatusSummary,
        filesystemListTree,
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(statusTargets).toContain(targetReference));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "File explorer" }), { button: 0 });
    await waitFor(() => expect(fileTreeTargets).toContain(targetReference));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Git" }), { button: 0 });

    const comparisonReads = comparison.mock.calls.length;
    const staleStatusReads = statusTargets.filter((target) => target === targetReference).length;
    const staleFileTreeReads = fileTreeTargets.filter(
      (target) => target === targetReference,
    ).length;
    const neutralStatusReads = statusTargets.filter((target) => target === "HEAD").length;
    targetAvailable = false;
    const refreshButton = screen.getByTestId("agent-studio-git-refresh-button");
    await waitFor(() => expect(refreshButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(refreshButton);

    await waitFor(() => expect(comparison.mock.calls.length).toBeGreaterThan(comparisonReads));
    await screen.findByText("Tracked upstream no longer exists.");
    await waitFor(() =>
      expect(statusTargets.filter((target) => target === "HEAD").length).toBeGreaterThan(
        neutralStatusReads,
      ),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "File explorer" }), { button: 0 });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<WorkspaceFileTree>(filesystemQueryKeys.tree("/repo", null))
          ?.entries,
      ).toHaveLength(1),
    );
    expect(fileTreeTargets).toContain(undefined);
    expect(statusTargets.filter((target) => target === targetReference)).toHaveLength(
      staleStatusReads,
    );
    expect(fileTreeTargets.filter((target) => target === targetReference)).toHaveLength(
      staleFileTreeReads,
    );
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});
