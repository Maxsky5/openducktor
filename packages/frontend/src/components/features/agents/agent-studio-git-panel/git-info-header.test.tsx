import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, type ComponentProps, type ReactElement } from "react";
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

const header = (props: GitInfoHeaderTestProps): ReactElement => (
  <QueryProvider useIsolatedClient>
    <TooltipProvider>
      <GitInfoHeader {...props} />
    </TooltipProvider>
  </QueryProvider>
);

const renderGitInfoHeader = (props: GitInfoHeaderTestProps): ReturnType<typeof render> =>
  render(header(props));

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
    "keeps the task action lane in %s mode",
    (contextMode) => {
      rendered = renderGitInfoHeader(
        createGitInfoHeaderProps({
          contextMode,
          pullRequest,
          uncommittedFileCount: 3,
        }),
      );

      const lane = screen.getByTestId("agent-studio-git-action-row");
      const buttons = [...lane.querySelectorAll("button")];
      expect(buttons.map((button) => button.querySelector(".sr-only")?.textContent)).toEqual(
        contextMode === "worktree"
          ? ["Refresh", "Rebase onto target", "Pull from upstream", "Push branch"]
          : ["Refresh", "Pull from upstream", "Push branch"],
      );
      expect(screen.getByText("Current branch")).toBeTruthy();
      expect(screen.getByText("Target branch")).toBeTruthy();
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
    expect(screen.getByTestId("agent-studio-git-current-branch").textContent).not.toBe(
      "Detached HEAD",
    );
  });

  test("shows the task branch cards in repository mode", () => {
    rendered = renderGitInfoHeader(
      createGitInfoHeaderProps({ contextMode: "repository", branch: "beta" }),
    );

    const row = screen.getByTestId("agent-studio-git-branch-context-row");
    const branch = screen.getByTestId("agent-studio-git-current-branch");
    expect(branch.textContent).toBe("beta");
    expect(row.contains(screen.getByTestId("agent-studio-git-target-branch"))).toBe(true);
    expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toBe("origin/main");
    expect(screen.queryByRole("button", { name: "Edit target branch" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Edit target branch" }));
    fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
    expect(await screen.findByRole("option", { name: /Tracked upstream/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Target branch" }).textContent).toContain(
      "Tracked upstream",
    );
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

  test("opens the target editor and closes when editing becomes unavailable", async () => {
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
      fireEvent.click(screen.getByRole("button", { name: "Edit target branch" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Target branch" }));

    expect(screen.getByTestId("agent-studio-git-target-branch-editor")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Target branch" })).toBeTruthy();
    expect(await screen.findByRole("option", { name: /origin\/release/ })).toBeTruthy();

    await act(async () => {
      rendered?.rerender(header({ ...editableProps, targetBranchEditable: false }));
    });

    expect(screen.queryByTestId("agent-studio-git-target-branch-editor")).toBeNull();

    await act(async () => {
      rendered?.rerender(header(editableProps));
    });

    expect(screen.queryByTestId("agent-studio-git-target-branch-editor")).toBeNull();
    expect(screen.getByTestId("agent-studio-git-target-branch-display-row")).toBeTruthy();
  });

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
    fireEvent.click(screen.getByRole("button", { name: "Edit target branch" }));
    fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
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
    expect(screen.queryByTestId("agent-studio-git-target-branch-editor")).toBeNull();
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
      fireEvent.click(screen.getByRole("button", { name: "Edit target branch" }));
      fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
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
            document.activeElement === screen.getByRole("button", { name: "Edit target branch" }),
          ).toBe(true),
        { timeout: 200 },
      );
      expect(screen.queryByTestId("agent-studio-git-target-branch-editor")).toBeNull();
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
      fireEvent.click(screen.getByRole("button", { name: "Edit target branch" }));
      fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
      expect(screen.queryByText("Old selection failed.")).toBeNull();
      expect(screen.getByRole("button", { name: "Target branch" }).textContent).toContain(
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
      fireEvent.click(screen.getByRole("button", { name: "Edit target branch" }));
      fireEvent.click(screen.getByRole("button", { name: "Target branch" }));
      fireEvent.click(await screen.findByRole("option", { name: /release/ }));
      expect(update).toHaveBeenCalledWith("refs/heads/release");
      expect(
        screen.getByTestId("agent-studio-git-target-branch-cancel").hasAttribute("disabled"),
      ).toBe(true);
      expect(screen.getByRole("button", { name: "Target branch" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByRole("status").textContent).toContain("Applying comparison...");
      expect(screen.queryByRole("option", { name: /origin\/main/ })).toBeNull();
      expect(update).toHaveBeenCalledTimes(1);
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
