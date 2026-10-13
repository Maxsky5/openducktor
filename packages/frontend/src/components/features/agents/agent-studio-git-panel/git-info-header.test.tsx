import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act, type ComponentProps, type ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/lib/query-provider";
import type { GitPanelTab } from "./constants";
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
  activeTab: "target",
  onTabChange: () => {},
  tabBadges: {},
  uncommittedFileCount: 0,
  isLoading: false,
  isRefreshing: false,
  refreshError: null,
  isCommitting: false,
  isChanging: false,
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
  onRefresh: () => {},
  ...overrides,
});

const header = (props: GitInfoHeaderTestProps): ReactElement => (
  <QueryProvider useIsolatedClient>
    <TooltipProvider>
      <GitInfoHeader {...props} />
    </TooltipProvider>
  </QueryProvider>
);

const renderGitInfoHeader = (props: GitInfoHeaderTestProps): ReturnType<typeof render> =>
  render(header(props));

/** The editable target chip. Its name holds the current target. */
const targetTrigger = (): HTMLElement =>
  screen.getByRole("button", { name: /^Target branch: .+\. Choose another target branch\.$/ });

const TARGET_DIALOG = { name: "Target branch:" } as const;

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

  test.each(["worktree", "repository"] as const)(
    "shows the branch and its target in one row and the Git actions in a second row in %s mode",
    (contextMode) => {
      rendered = renderGitInfoHeader(
        createGitInfoHeaderProps({
          contextMode,
          pullRequest,
          uncommittedFileCount: 3,
          commitsAheadBehind: { ahead: 2, behind: 1 },
        }),
      );

      const row = screen.getByTestId("agent-studio-git-branch-context-row");
      const lane = screen.getByTestId("agent-studio-git-action-row");
      expect(
        [...lane.querySelectorAll("button")].map(
          (button) => button.querySelector(".sr-only")?.textContent,
        ),
      ).toEqual(
        contextMode === "worktree"
          ? ["Refresh", "Rebase onto target", "Pull from upstream", "Push branch"]
          : ["Refresh", "Pull from upstream", "Push branch"],
      );
      expect(row.contains(lane)).toBe(false);
      const currentChip = screen.getByTitle("Current branch: feature/task-24");
      expect(currentChip).toBe(screen.getByTestId("agent-studio-git-current-branch-display-row"));
      expect(within(currentChip).getByText("Current branch:").className).toContain("sr-only");
      expect(within(currentChip).getByTestId("agent-studio-git-current-branch").textContent).toBe(
        "feature/task-24",
      );
      const targetChip = screen.getByTitle("Compare with: origin/main");
      expect(within(targetChip).getByTestId("agent-studio-git-target-branch").textContent).toBe(
        "origin/main",
      );
      const counts = screen.getByTestId("agent-studio-git-comparison-counts");
      expect([currentChip, targetChip, counts].every((element) => row.contains(element))).toBe(
        true,
      );
      expect(screen.queryByText("PR #42")).toBeNull();
      expect(screen.queryByText("3 files changed")).toBeNull();
      expect(screen.queryByTestId("agent-studio-git-open-in-actions")).toBeNull();
      expect(screen.getByTestId("agent-studio-git-diff-scope-target")).toBeTruthy();
    },
  );

  test("does not report an unknown branch as detached while Git state loads", () => {
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({ branch: null, branchKnown: false, isLoading: true }),
    );
    expect(screen.getByTestId("agent-studio-git-current-branch").textContent).toBe(
      "Reading branch...",
    );
  });

  test("shows static branch chips in repository mode", () => {
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({ contextMode: "repository", branch: "beta" }),
    );

    const row = screen.getByTestId("agent-studio-git-branch-context-row");
    const branch = screen.getByTestId("agent-studio-git-current-branch");
    const target = screen.getByTestId("agent-studio-git-target-branch");
    expect(branch.textContent).toBe("beta");
    expect(row.contains(target)).toBe(true);
    expect(target.textContent).toBe("origin/main");
    expect(screen.getByTestId("agent-studio-git-target-branch-display-row").contains(target)).toBe(
      true,
    );
    expect(screen.queryByTestId("agent-studio-git-target-branch-edit")).toBeNull();
    expect(within(row).queryByRole("button", { name: /target branch/i })).toBeNull();
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
    expect(row.contains(screen.getByRole("button", { name: "Switch repository branch" }))).toBe(
      true,
    );
    expect(row.contains(screen.getByTestId("agent-studio-git-target-branch"))).toBe(true);
    expect(screen.queryByTestId("agent-studio-git-current-branch")).toBeNull();
  });

  test("shows the resolved upstream branch while keeping the upstream rule in the menu", async () => {
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({
        targetBranchEditable: true,
        targetBranchSelectionValue: "@{upstream}",
        targetBranchOptions: [{ value: "@{upstream}", label: "Tracked upstream" }],
        onUpdateTargetBranch: async () => {},
      }),
    );
    expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toBe("origin/main");
    fireEvent.click(targetTrigger());
    expect(await screen.findByRole("option", { name: /Tracked upstream/ })).toBeTruthy();
    expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toBe("origin/main");
  });

  test("keeps the worktree branch chip when a repository branch control is available", () => {
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

  test("labels the commit counts against the comparison target", async () => {
    const props = createGitInfoHeaderProps({ commitsAheadBehind: { ahead: 2, behind: 1 } });
    rendered = renderGitInfoHeader(props);

    const counts = screen.getByRole("img", { name: "2 commits ahead of origin/main, 1 behind" });
    expect(counts).toBe(screen.getByTestId("agent-studio-git-comparison-counts"));
    expect(counts.getAttribute("title")).toBe("2 commits ahead of origin/main, 1 behind");
    expect(within(counts).getByTestId("agent-studio-git-target-ahead-count").textContent).toBe("2");
    expect(within(counts).getByTestId("agent-studio-git-target-behind-count").textContent).toBe(
      "1",
    );
    expect(screen.getByTestId("agent-studio-git-branch-context-row").contains(counts)).toBe(true);

    await act(async () => {
      rendered?.rerender(header({ ...props, commitsAheadBehind: { ahead: 1, behind: 0 } }));
    });
    expect(screen.getByRole("img", { name: "1 commit ahead of origin/main, 0 behind" })).toBe(
      screen.getByTestId("agent-studio-git-comparison-counts"),
    );

    for (const hidden of [
      { commitsAheadBehind: { ahead: 0, behind: 0 } },
      { comparisonPending: true },
      { comparisonUnavailableReason: "Choose a comparison target." },
    ] satisfies Partial<GitInfoHeaderTestProps>[]) {
      await act(async () => {
        rendered?.rerender(header({ ...props, ...hidden }));
      });
      expect(screen.queryByTestId("agent-studio-git-comparison-counts")).toBeNull();
    }
  });

  test("shows the Git views as one tab row and keeps Branch changes selectable without a comparison", async () => {
    const onTabChange = mock((_tab: GitPanelTab) => {});
    const props = createGitInfoHeaderProps({
      activeTab: "uncommitted",
      onTabChange,
      tabBadges: { uncommitted: <span data-testid="uncommitted-tab-badge">3</span> },
      diffPanelId: "git-panel",
    });
    rendered = renderGitInfoHeader(props);

    const tabs = within(screen.getByRole("tablist", { name: "Git views" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("data-testid"))).toEqual([
      "agent-studio-git-diff-scope-uncommitted",
      "agent-studio-git-diff-scope-target",
      "agent-studio-git-tab-history",
    ]);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Uncommitted changes3",
      "Branch changes",
      "History",
    ]);
    expect(tabs[0]?.contains(screen.getByTestId("uncommitted-tab-badge"))).toBe(true);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(tabs.map((tab) => tab.id)).toEqual([
      "git-panel-tab-uncommitted",
      "git-panel-tab-target",
      "git-panel-tab-history",
    ]);
    expect(tabs.every((tab) => tab.getAttribute("aria-controls") === "git-panel")).toBe(true);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "History" }), {
      button: 0,
      ctrlKey: false,
    });
    // Radix Tabs reports the press and the focus that follows it, so only the last value counts.
    expect(onTabChange).toHaveBeenLastCalledWith("history");

    await act(async () => {
      rendered?.rerender(header({ ...props, activeTab: "history" }));
    });
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
    ]);

    const reason = "Choose a comparison target to see branch changes.";
    await act(async () => {
      rendered?.rerender(header({ ...props, comparisonUnavailableReason: reason }));
    });
    const branchTab = screen.getByRole("tab", { name: "Branch changes" });
    expect(branchTab.hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("agent-studio-git-comparison-unavailable").textContent).toBe(reason);
    onTabChange.mockClear();
    fireEvent.mouseDown(branchTab, { button: 0, ctrlKey: false });
    expect(onTabChange).toHaveBeenLastCalledWith("target");
  });

  test("spins Refresh while Git state loads and blocks it only during a refresh or another action", async () => {
    const onRefresh = mock(() => {});
    const props = createGitInfoHeaderProps({ isLoading: true, onRefresh });
    rendered = renderGitInfoHeader(props);
    const refresh = (): HTMLElement => screen.getByTestId("agent-studio-git-refresh-button");

    expect(refresh().hasAttribute("disabled")).toBe(false);
    expect(refresh().getAttribute("aria-busy")).toBe("true");
    fireEvent.click(refresh());
    expect(onRefresh).toHaveBeenCalledTimes(1);

    for (const blocked of [
      { isRefreshing: true },
      { isChanging: true },
      { isPushing: true },
    ] satisfies Partial<GitInfoHeaderTestProps>[]) {
      await act(async () => {
        rendered?.rerender(header({ ...props, isLoading: false, ...blocked }));
      });
      expect(refresh().hasAttribute("disabled")).toBe(true);
    }
    expect(refresh().getAttribute("aria-busy")).toBeNull();

    await act(async () => {
      rendered?.rerender(
        header({ ...props, isLoading: false, refreshError: "Network is unreachable." }),
      );
    });
    expect(refresh().hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("agent-studio-git-refresh-error").textContent).toBe(
      "Refresh failed: Network is unreachable.",
    );
  });

  test.each(["worktree", "repository"] as const)(
    "opens target choices with one click in %s mode and closes when editing becomes unavailable",
    async (contextMode) => {
      const editableProps = createGitInfoHeaderProps({
        contextMode,
        targetBranchEditable: true,
        targetBranchOptions: [
          { value: "origin/main", label: "origin/main" },
          { value: "origin/release", label: "origin/release" },
        ],
        targetBranchSelectionValue: "origin/main",
        onUpdateTargetBranch: async () => {},
      });

      rendered = renderGitInfoHeader(editableProps);

      const trigger = screen.getByRole("button", {
        name: "Target branch: origin/main. Choose another target branch.",
      });
      expect(trigger).toBe(screen.getByTestId("agent-studio-git-target-branch-edit"));
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      await act(async () => {
        fireEvent.click(trigger);
      });
      expect(screen.getByRole("dialog", TARGET_DIALOG)).toBeTruthy();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(await screen.findByRole("option", { name: /origin\/release/ })).toBeTruthy();

      await act(async () => {
        rendered?.rerender(header({ ...editableProps, targetBranchEditable: false }));
      });

      expect(screen.queryByRole("dialog", TARGET_DIALOG)).toBeNull();
      expect(screen.queryByTestId("agent-studio-git-target-branch-edit")).toBeNull();
      expect(
        screen.getByTestId("agent-studio-git-target-branch-display-row").textContent,
      ).toContain("origin/main");

      await act(async () => {
        rendered?.rerender(header(editableProps));
      });

      expect(screen.queryByRole("dialog", TARGET_DIALOG)).toBeNull();
      expect(targetTrigger()).toBe(screen.getByTestId("agent-studio-git-target-branch-edit"));
      expect(targetTrigger().getAttribute("aria-expanded")).toBe("false");
    },
  );

  test("keeps branch-list retry reachable without permitting a failed list's choices", async () => {
    const retry = mock(async () => {});
    const update = mock(async () => {});
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({
        targetBranchEditable: true,
        targetBranchesError: "Check repository permissions.",
        retryTargetBranches: retry,
        targetBranchOptions: [{ value: "origin/main", label: "origin/main" }],
        targetBranchSelectionValue: "origin/main",
        onUpdateTargetBranch: update,
      }),
    );
    fireEvent.click(targetTrigger());
    const option = await screen.findByRole("option", { name: /origin\/main/ });
    expect(option.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(option);
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Check repository permissions.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry branches" }));
    });
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel target branch edit" }));
    expect(screen.queryByRole("dialog", TARGET_DIALOG)).toBeNull();
    expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toContain(
      "origin/main",
    );
  });

  test("keeps keyboard focus after a target change and drops errors after a return to the old target", async () => {
    const save = Promise.withResolvers<void>();
    const props = createGitInfoHeaderProps({
      targetBranchEditable: true,
      targetBranchOptions: [
        { value: "origin/main", label: "origin/main" },
        { value: "origin/release", label: "origin/release" },
      ],
      targetBranchSelectionValue: "origin/main",
      onUpdateTargetBranch: () => save.promise,
    });
    rendered = renderGitInfoHeader(props);
    try {
      fireEvent.click(targetTrigger());
      fireEvent.click(await screen.findByRole("option", { name: /origin\/release/ }));
      await act(async () => {
        rendered?.rerender(
          header({
            ...props,
            branch: null,
            targetBranch: "origin/release",
            targetBranchSelectionValue: "origin/release",
          }),
        );
      });
      await waitFor(
        () =>
          expect(
            document.activeElement === screen.getByTestId("agent-studio-git-target-branch-edit"),
          ).toBe(true),
        { timeout: 200 },
      );
      expect(screen.queryByRole("dialog", TARGET_DIALOG)).toBeNull();
      await act(async () => {
        rendered?.rerender(
          header({
            ...props,
            targetBranch: "origin/release",
            targetBranchSelectionValue: "origin/release",
          }),
        );
      });
      await act(async () => {
        rendered?.rerender(header(props));
      });
      await act(async () => {
        save.reject(new Error("Old selection failed."));
        await save.promise.catch(() => {});
      });
      fireEvent.click(targetTrigger());
      expect(screen.queryByText("Old selection failed.")).toBeNull();
      expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toContain(
        "origin/main",
      );
    } finally {
      save.resolve();
    }
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
      expect(screen.queryByText(/This choice applies only to this session/)).toBeNull();
      fireEvent.click(targetTrigger());
      fireEvent.click(await screen.findByRole("option", { name: /release/ }));
      expect(update).toHaveBeenCalledWith("refs/heads/release");
      expect(
        screen.getByTestId("agent-studio-git-target-branch-cancel").hasAttribute("disabled"),
      ).toBe(true);
      expect(targetTrigger().hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("status").textContent).toContain("Applying comparison...");
      expect(
        screen.getByRole("option", { name: /origin\/main/ }).getAttribute("aria-disabled"),
      ).toBe("true");
      expect(update).toHaveBeenCalledTimes(1);
      await act(async () => {
        failure.reject(new Error("Could not save the target. Try again."));
        await failure.promise.catch(() => {});
      });
      await waitFor(() =>
        expect(screen.getByText("Could not save the target. Try again.")).toBeTruthy(),
      );
      expect(screen.getByRole("option", { name: /release/ }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toBe("origin/main");
      expect(screen.getByText(/This choice applies only to this session/)).toBeTruthy();
      fireEvent.click(screen.getByTestId("agent-studio-git-target-branch-cancel"));
      expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toBe("origin/main");
    } finally {
      view.unmount();
      document.documentElement.classList.remove(theme);
    }
  },
);

test("a pending target save does not lock a new context or release its newer save", async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const update = mock(() => first.promise)
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const props = createGitInfoHeaderProps({
    targetBranchEditable: true,
    targetBranchOptions: [
      { value: "origin/main", label: "origin/main" },
      { value: "origin/release", label: "origin/release" },
    ],
    targetBranchSelectionValue: "origin/main",
    onUpdateTargetBranch: update,
  });
  const view = renderGitInfoHeader(props);
  try {
    fireEvent.click(targetTrigger());
    fireEvent.click(await screen.findByRole("option", { name: /origin\/release/ }));
    view.rerender(header({ ...props, branch: "other" }));
    fireEvent.click(targetTrigger());
    await screen.findByRole("option", { name: /origin\/release/ });
    fireEvent.click(screen.getByRole("button", { name: "Cancel target branch edit" }));
    view.rerender(header(props));
    fireEvent.click(targetTrigger());
    const option = await screen.findByRole("option", { name: /origin\/release/ });
    fireEvent.click(option);
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => {
      first.resolve();
      await first.promise;
    });
    expect(targetTrigger().hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Cancel target branch edit" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(option.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(option, { key: "Escape" });
    });
    expect(screen.getByRole("dialog", TARGET_DIALOG)).toBeTruthy();
    await act(async () => {
      second.resolve();
      await second.promise;
    });
    await waitFor(() => expect(screen.queryByRole("dialog", TARGET_DIALOG)).toBeNull());
  } finally {
    first.resolve();
    second.resolve();
    await act(async () => {
      await Promise.all([first.promise, second.promise]);
    });
    view.unmount();
  }
});
