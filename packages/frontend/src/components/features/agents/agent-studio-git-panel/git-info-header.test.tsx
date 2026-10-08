import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, type ComponentProps } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/lib/query-provider";
import { GitInfoHeader } from "./git-info-header";

enableReactActEnvironment();

const pullRequest: PullRequest = {
  providerId: "github",
  number: 42,
  url: "https://github.com/maxsky5/openducktor/pull/42",
  state: "open",
  createdAt: "2026-04-12T10:00:00.000Z",
  updatedAt: "2026-04-12T10:00:00.000Z",
};

type GitInfoHeaderTestProps = ComponentProps<typeof GitInfoHeader>;

const createGitInfoHeaderProps = (
  overrides: Partial<GitInfoHeaderTestProps> = {},
): GitInfoHeaderTestProps => ({
  contextMode: "worktree",
  pullRequest: null,
  branch: "feature/task-24",
  targetBranch: "origin/main",
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  diffScope: "target",
  uncommittedFileCount: 0,
  isLoading: false,
  isCommitting: false,
  isPushing: false,
  isRebasing: false,
  isDetectingPullRequest: false,
  isGitActionsLocked: false,
  gitActionsLockReason: null,
  showLockReasonBanner: false,
  pushError: null,
  rebaseError: null,
  targetBranchOptions: [],
  targetBranchSelectionValue: "",
  pushBranch: async () => {},
  rebaseOntoTarget: async () => {},
  pullFromUpstream: async () => {},
  setDiffScope: () => {},
  onRefresh: () => {},
  ...overrides,
});

const renderGitInfoHeader = (props: GitInfoHeaderTestProps): ReturnType<typeof render> => {
  return render(
    <QueryProvider useIsolatedClient>
      <TooltipProvider>
        <GitInfoHeader {...props} />
      </TooltipProvider>
    </QueryProvider>,
  );
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

  test("keeps git context controls without rendering a duplicate PR badge", () => {
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({
        pullRequest,
        uncommittedFileCount: 3,
      }),
    );

    expect(screen.queryByText("PR #42")).toBeNull();
    expect(screen.queryByText("3 files changed")).toBeNull();
    expect(screen.queryByTestId("agent-studio-git-open-in-actions")).toBeNull();
    expect(screen.getByTestId("agent-studio-git-diff-scope-target")).toBeTruthy();
  });

  test("shows a repository branch in one compact row", () => {
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({ contextMode: "repository", branch: "beta" }),
    );

    const row = screen.getByTestId("agent-studio-git-branch-context-row");
    const label = screen.getByText("Repository branch");
    const branch = screen.getByTestId("agent-studio-git-current-branch");
    expect(label.parentElement).toBe(branch.parentElement);
    expect(row.classList.contains("grid")).toBe(false);
    expect(branch.textContent).toBe("beta");
    expect(screen.queryByTestId("agent-studio-git-target-branch-display-row")).toBeNull();
  });

  test("replaces the repository branch label with the repository branch control", () => {
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({
        contextMode: "repository",
        branch: "beta",
        repositoryBranchControl: <button type="button">Switch repository branch</button>,
      }),
    );

    const row = screen.getByTestId("agent-studio-git-branch-context-row");
    expect(row.textContent).toBe("Switch repository branch");
    expect(screen.queryByTestId("agent-studio-git-current-branch")).toBeNull();
  });

  test("keeps the worktree branch rows when a repository branch control is available", () => {
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({
        repositoryBranchControl: <button type="button">Switch repository branch</button>,
      }),
    );

    expect(screen.queryByRole("button", { name: "Switch repository branch" })).toBeNull();
    expect(screen.getByTestId("agent-studio-git-current-branch").textContent).toBe(
      "feature/task-24",
    );
  });

  test("disables Pull Request detection and shows the provider health error", () => {
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({
        onDetectPullRequest: () => {},
        detectPullRequestDisabledReason: "Sign in to GitHub CLI.",
      }),
    );

    const button = screen.getByTestId("agent-studio-git-detect-pr-button");
    const error = screen.getByText("Sign in to GitHub CLI.");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe(error.id);
  });

  test("closes the target branch editor when editing becomes unavailable", async () => {
    const editableProps = createGitInfoHeaderProps({
      targetBranchOptions: [
        { value: "origin/main", label: "origin/main" },
        { value: "origin/release", label: "origin/release" },
      ],
      targetBranchSelectionValue: "origin/main",
      onUpdateTargetBranch: async () => {},
    });

    rendered = renderGitInfoHeader(editableProps);

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-target-branch-edit"));
    });

    expect(screen.getByTestId("agent-studio-git-target-branch-editor")).toBeTruthy();

    await act(async () => {
      rendered?.rerender(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <GitInfoHeader {...editableProps} targetBranchEditable={false} />
          </TooltipProvider>
        </QueryProvider>,
      );
    });

    expect(screen.queryByTestId("agent-studio-git-target-branch-editor")).toBeNull();

    await act(async () => {
      rendered?.rerender(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <GitInfoHeader {...editableProps} />
          </TooltipProvider>
        </QueryProvider>,
      );
    });

    expect(screen.queryByTestId("agent-studio-git-target-branch-editor")).toBeNull();
    expect(screen.getByTestId("agent-studio-git-target-branch-display-row")).toBeTruthy();
  });
});

test.each(["light", "dark"] as const)(
  "workspace comparison editor retains a failed choice in %s theme",
  async (theme) => {
    document.documentElement.classList.add(theme);
    const failure = Promise.withResolvers<void>();
    const update = mock(() => failure.promise);
    const view = renderGitInfoHeader(
      createGitInfoHeaderProps({
        contextMode: "repository",
        targetBranchEditable: true,
        targetBranchHelpText:
          "This choice applies only to this session. It resets on app reload or successful archive.",
        targetBranchOptions: [
          { value: "refs/remotes/origin/main", label: "origin/main" },
          { value: "refs/heads/release", label: "release", secondaryLabel: "local" },
        ],
        targetBranchSelectionValue: "refs/remotes/origin/main",
        onUpdateTargetBranch: update,
      }),
    );
    try {
      fireEvent.click(screen.getByTestId("agent-studio-git-target-branch-edit"));
      fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
      fireEvent.click(await screen.findByRole("option", { name: /release/ }));
      expect(update).toHaveBeenCalledWith("refs/heads/release");
      expect(
        screen.getByTestId("agent-studio-git-target-branch-cancel").hasAttribute("disabled"),
      ).toBe(true);
      await act(async () => {
        failure.reject(new Error("Could not save the target. Try again."));
        await failure.promise.catch(() => {});
      });
      await waitFor(() =>
        expect(screen.getByText("Could not save the target. Try again.")).toBeTruthy(),
      );
      expect(screen.getByRole("button", { name: "Target branch" }).textContent).toContain(
        "release",
      );
      expect(screen.getByText(/This choice applies only to this session/)).toBeTruthy();
      fireEvent.click(screen.getByTestId("agent-studio-git-target-branch-cancel"));
      expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toBe("origin/main");
    } finally {
      view.unmount();
      document.documentElement.classList.remove(theme);
    }
  },
);
