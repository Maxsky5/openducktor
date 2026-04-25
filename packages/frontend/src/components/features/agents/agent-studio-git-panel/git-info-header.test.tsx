import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PullRequest, SystemOpenInToolInfo } from "@openducktor/contracts";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/lib/query-provider";
import { host } from "@/state/operations/host";
import { GitInfoHeader } from "./git-info-header";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const pullRequest: PullRequest = {
  providerId: "github",
  number: 42,
  url: "https://github.com/maxsky5/openducktor/pull/42",
  state: "open",
  createdAt: "2026-04-12T10:00:00.000Z",
  updatedAt: "2026-04-12T10:00:00.000Z",
};

describe("GitInfoHeader", () => {
  let rendered: ReturnType<typeof render> | null = null;

  afterEach(async () => {
    if (rendered) {
      await act(async () => {
        rendered?.unmount();
      });
      rendered = null;
    }
  });

  test("replaces the duplicate changed-files badge with the Open In trigger while keeping the PR badge", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
        ] satisfies SystemOpenInToolInfo[],
    );

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <GitInfoHeader
              contextMode="worktree"
              pullRequest={pullRequest}
              openInTargetPath="/tmp/worktrees/task-24"
              openInDisabledReason={null}
              branch="feature/task-24"
              targetBranch="origin/main"
              commitsAheadBehind={null}
              upstreamAheadBehind={null}
              upstreamStatus="tracking"
              diffScope="target"
              uncommittedFileCount={3}
              isLoading={false}
              isCommitting={false}
              isPushing={false}
              isRebasing={false}
              isDetectingPullRequest={false}
              isGitActionsLocked={false}
              gitActionsLockReason={null}
              showLockReasonBanner={false}
              pushError={null}
              rebaseError={null}
              pushBranch={async () => {}}
              rebaseOntoTarget={async () => {}}
              pullFromUpstream={async () => {}}
              setDiffScope={() => {}}
              onRefresh={() => {}}
              openDirectoryInTool={async () => {}}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await screen.findByTestId("agent-studio-git-open-in-icon-finder");

      expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
        "Finder",
      );
      expect(screen.queryByTestId("agent-studio-git-open-in-trigger")).toBeNull();
      expect(screen.getByText("PR #42")).toBeTruthy();
      expect(screen.queryByText("3 files changed")).toBeNull();
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });
});
