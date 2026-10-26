import { describe, expect, mock, test } from "bun:test";
import type { GitFileDiff, GitHistoryPage, GitHistoryPageRequest } from "@openducktor/contracts";
import {
  fireEvent,
  type RenderResult,
  render as renderWithoutProviders,
  screen,
  waitFor,
} from "@testing-library/react";
import { act, createElement } from "react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { GitChangeIntent, GitCommitMode } from "@openducktor/frontend-core/git/contracts";
import { QueryProvider } from "@/test-utils/query-provider";
import { isApplePlatform } from "@/lib/device-platform";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { AgentStudioGitPanel, type AgentStudioGitPanelModel } from "./agent-studio-git-panel";
import {
  baseModel,
  ensureRenderer,
  flush,
  type PanelModelInput,
  render,
  renderAgentStudioGitPanelElement,
  setupAgentStudioGitPanelTests,
  toFileDiff,
} from "./agent-studio-git-panel.test-support";

enableReactActEnvironment();

type DomTestNode = {
  readonly element: Element;
  readonly type: string;
  readonly props: {
    className?: string;
    title?: string | null;
    disabled?: boolean;
    value?: string;
    onClick: (event?: { stopPropagation?: () => void }) => void;
    onChange: (event: { currentTarget?: { value?: string }; target?: { value?: string } }) => void;
  };
  readonly children: string[];
  findAll: (predicate: (node: DomTestNode) => boolean) => DomTestNode[];
};

const wrapElement = (element: Element): DomTestNode => ({
  element,
  type: element.tagName.toLowerCase(),
  get props() {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Expected an HTML element fixture.");
    }
    const htmlElement = element;
    const reactPropsKey = Object.keys(htmlElement).find((key) => key.startsWith("__reactProps$"));
    const reactProps = reactPropsKey
      ? Object.getOwnPropertyDescriptor(htmlElement, reactPropsKey)?.value
      : null;
    const canBeDisabled =
      htmlElement instanceof HTMLButtonElement ||
      htmlElement instanceof HTMLInputElement ||
      htmlElement instanceof HTMLTextAreaElement;
    const hasValue =
      htmlElement instanceof HTMLInputElement || htmlElement instanceof HTMLTextAreaElement;
    const value = hasValue ? htmlElement.value : "";
    return {
      className: htmlElement.className,
      title: htmlElement.getAttribute("title"),
      disabled: canBeDisabled ? htmlElement.disabled : false,
      value,
      onClick: (event: { stopPropagation?: () => void } = {}) => {
        if (reactProps?.onClick) {
          reactProps.onClick(event);
          return;
        }
        fireEvent.click(htmlElement, event ?? {});
      },
      onChange: (event: { currentTarget?: { value?: string }; target?: { value?: string } }) => {
        const nextValue = event.currentTarget?.value ?? event.target?.value ?? "";
        if (reactProps?.onChange) {
          reactProps.onChange({
            currentTarget: { value: nextValue },
            target: { value: nextValue },
          });
          return;
        }
        fireEvent.change(htmlElement, { target: { value: nextValue } });
      },
    };
  },
  get children() {
    return Array.from(element.childNodes).reduce<string[]>((children, child) => {
      const textContent = child.textContent ?? "";
      if (textContent.length > 0) {
        children.push(textContent);
      }
      return children;
    }, []);
  },
  findAll: (predicate) =>
    Array.from(element.querySelectorAll("*")).reduce<DomTestNode[]>((nodes, node) => {
      const wrappedNode = wrapElement(node);
      if (predicate(wrappedNode)) {
        nodes.push(wrappedNode);
      }
      return nodes;
    }, []),
});

const wrapRoot = (rendered: RenderResult): DomTestNode =>
  ({
    ...wrapElement(rendered.baseElement),
    findAll: (predicate) =>
      Array.from(rendered.baseElement.querySelectorAll("*")).reduce<DomTestNode[]>(
        (nodes, node) => {
          const wrappedNode = wrapElement(node);
          if (predicate(wrappedNode)) {
            nodes.push(wrappedNode);
          }
          return nodes;
        },
        [],
      ),
  }) satisfies DomTestNode;

const findByTestId = (root: DomTestNode, testId: string): DomTestNode => {
  const effectiveMatches = Array.from(
    root.element.querySelectorAll(`[data-testid="${testId}"]`),
  ).map((node) => wrapElement(node));
  if (effectiveMatches.length !== 1) {
    throw new Error(
      `Expected exactly one host element for data-testid=${testId}, got ${effectiveMatches.length}`,
    );
  }
  const match = effectiveMatches[0];
  if (!match) {
    throw new Error(`Missing host element for data-testid=${testId}`);
  }
  return match;
};

const countByTestId = (root: DomTestNode, testId: string): number =>
  root.element.querySelectorAll(`[data-testid="${testId}"]`).length;

const findDiffScopeTabs = (root: DomTestNode, value: "target" | "uncommitted"): DomTestNode =>
  findByTestId(
    root,
    value === "target"
      ? "agent-studio-git-diff-scope-target"
      : "agent-studio-git-diff-scope-uncommitted",
  );

const getRoot = (renderer: RenderResult | null): DomTestNode => wrapRoot(ensureRenderer(renderer));

const hasVisibleText = (root: DomTestNode, text: string): boolean =>
  getNodeText(root).includes(text);

const getNodeText = (node: DomTestNode): string => node.children.join("");

const findButtonByText = (root: DomTestNode, text: string): DomTestNode => {
  const matches = root.findAll(
    (node) => node.type === "button" && getNodeText(node).includes(text),
  );
  if (matches.length === 0) {
    throw new Error(`No button found containing text: ${text}`);
  }
  if (matches.length > 1) {
    throw new Error(`Expected one button for text: ${text}, found ${matches.length}`);
  }
  const match = matches.at(0);
  if (!match) {
    throw new Error(`No button found containing text: ${text}`);
  }
  return match;
};

describe("AgentStudioGitPanel", () => {
  setupAgentStudioGitPanelTests();

  test("keeps refresh failures in the affected view", async () => {
    const error = "Could not read the selected file.";
    const refresh = mock(async () => {
      throw new Error(error);
    });
    render(createElement(AgentStudioGitPanel, { model: baseModel({ refresh, error }) }));

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
      await flush();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(error)).toBeDefined();
    expect(screen.getByTestId("agent-studio-git-refresh-button")).toBeDefined();
  });

  test("renders branch context labels and git action controls", async () => {
    const refresh = mock(async () => {});
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: baseModel({ refresh }) }));
      await flush();
    });

    const root = getRoot(renderer);
    expect(findByTestId(root, "agent-studio-git-current-branch").children.join("")).toContain(
      "feature/task-11",
    );
    expect(findByTestId(root, "agent-studio-git-target-branch").children.join("")).toContain(
      "origin/main",
    );

    expect(findByTestId(root, "agent-studio-git-refresh-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-rebase-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-pull-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-push-button")).toBeTruthy();
    expect(countByTestId(root, "agent-studio-git-target-status-row")).toBe(0);
    const targetAheadCount = findByTestId(root, "agent-studio-git-target-ahead-count");
    expect(targetAheadCount.children.join("")).toBe("2");
    expect(countByTestId(root, "agent-studio-git-commit-message-input")).toBe(0);
    expect(countByTestId(root, "agent-studio-git-commit-submit-button")).toBe(0);
    expect(
      findByTestId(root, "agent-studio-git-diff-scope-uncommitted").children.join(""),
    ).toContain("Uncommitted changes");
    expect(findByTestId(root, "agent-studio-git-diff-scope-target").children.join("")).toContain(
      "Branch changes",
    );
    expect(hasVisibleText(root, "/tmp/worktree")).toBe(false);

    await act(async () => {
      findByTestId(root, "agent-studio-git-refresh-button").props.onClick();
      fireEvent.mouseDown(findDiffScopeTabs(root, "uncommitted").element, { button: 0 });
      await flush();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("agent-studio-git-diff-scope-uncommitted").getAttribute("aria-selected"),
    ).toBe("true");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("keeps loaded empty state visible while refreshing in the background", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            fileDiffs: [],
            fileStatuses: [],
            uncommittedFileCount: 0,
            isLoading: true,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(hasVisibleText(root, "No changes detected")).toBe(true);
    expect(hasVisibleText(root, "Scanning for changes...")).toBe(false);
    expect(findByTestId(root, "agent-studio-git-refresh-button").element.innerHTML).toContain(
      "animate-spin",
    );

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows an invalid task target branch banner without falling back to a repo target label", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            targetBranch: "Invalid task target branch",
            error:
              "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
            isGitActionsLocked: true,
            gitActionsLockReason:
              "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
            showLockReasonBanner: true,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(findByTestId(root, "agent-studio-git-target-branch").children.join("")).toContain(
      "Invalid task target branch",
    );
    expect(hasVisibleText(root, "Invalid openducktor.targetBranch metadata")).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("enters target branch edit mode and saves the selected branch", async () => {
    const updateTargetBranch = mock(async () => undefined);
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            targetBranchOptions: [
              {
                value: "refs/remotes/origin/main",
                label: "origin/main",
              },
              {
                value: "refs/remotes/origin/beta",
                label: "origin/beta",
              },
            ],
            targetBranchSelectionValue: "refs/remotes/origin/main",
            onUpdateTargetBranch: updateTargetBranch,
          }),
        }),
      );
      await flush();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-branch-selector"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-branch-selector"));
      await flush();
    });
    expect(updateTargetBranch).toHaveBeenCalledWith("refs/remotes/origin/beta");
    expect(screen.queryByTestId("agent-studio-git-target-branch-editor")).toBeNull();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("does not render a pull request link badge inside the Git tab", async () => {
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            pullRequest: {
              providerId: "github",
              number: 110,
              url: "https://github.com/openai/openducktor/pull/110",
              state: "open",
              createdAt: "2026-03-12T12:24:09Z",
              updatedAt: "2026-03-12T12:24:09Z",
              lastSyncedAt: undefined,
              mergedAt: undefined,
              closedAt: undefined,
            },
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    const prLinks = root.findAll(
      (node) => node.type === "button" && getNodeText(node).includes("PR #110"),
    );
    expect(prLinks.length).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("renders and triggers the detect PR button when the action is available", async () => {
    const onDetectPullRequest = mock(async () => {});
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            onDetectPullRequest,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    const detectButton = findByTestId(root, "agent-studio-git-detect-pr-button");
    expect(getNodeText(detectButton)).toContain("Detect PR");

    await act(async () => {
      detectButton.props.onClick();
      await flush();
    });

    expect(onDetectPullRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("omits the detect PR button when no detection action is provided", async () => {
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: baseModel() }));
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-detect-pr-button")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("omits the detect PR button when a pull request is already linked", async () => {
    const onDetectPullRequest = mock(async () => {});
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            onDetectPullRequest,
            pullRequest: {
              providerId: "github",
              number: 110,
              url: "https://github.com/openai/openducktor/pull/110",
              state: "open",
              createdAt: "2026-03-12T12:24:09Z",
              updatedAt: "2026-03-12T12:24:09Z",
              lastSyncedAt: undefined,
              mergedAt: undefined,
              closedAt: undefined,
            },
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-detect-pr-button")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows the repository comparison without a target edit or rebase action", async () => {
    const refresh = mock(async () => {});
    const pushBranch = mock(async () => {});
    const pullFromUpstream = mock(async () => {});
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            contextMode: "repository",
            diffScope: "uncommitted",
            refresh,
            pushBranch,
            pullFromUpstream,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(hasVisibleText(root, "Repository context")).toBe(false);
    expect(countByTestId(root, "agent-studio-git-current-branch")).toBe(1);
    expect(countByTestId(root, "agent-studio-git-target-branch")).toBe(1);
    expect(screen.queryByRole("button", { name: "Edit target branch" })).toBeNull();
    expect(countByTestId(root, "agent-studio-git-target-ahead-count")).toBe(1);
    expect(countByTestId(root, "agent-studio-git-rebase-button")).toBe(0);
    expect(findByTestId(root, "agent-studio-git-pull-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-push-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-commit-message-input")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-diff-scope-target").children.join("")).toContain(
      "Branch changes",
    );

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("keeps an explicit comparison independent from untracked upstream state", async () => {
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            contextMode: "repository",
            diffScope: "target",
            upstreamAheadBehind: { ahead: 0, behind: 0 },
            upstreamStatus: "untracked",
            fileDiffs: [],
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(hasVisibleText(root, "No changes against origin/main")).toBe(true);
    expect(Boolean(findByTestId(root, "agent-studio-git-pull-button").props.disabled)).toBe(true);
    expect(Boolean(findByTestId(root, "agent-studio-git-push-button").props.disabled)).toBe(false);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("enforces disabled safety states for rebase and commit controls", async () => {
    const commit = mock(async (_mode: GitCommitMode, _message: string) => true);
    const stagedFile = {
      fileStatuses: [{ path: "src/a.ts", staged: true, status: "modified" }],
      fileDiffs: [toFileDiff("src/a.ts")],
    };

    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            branch: null,
            diffScope: "uncommitted",
            fileStatuses: [],
            commit,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(Boolean(findByTestId(root, "agent-studio-git-rebase-button").props.disabled)).toBe(true);
    expect(
      Boolean(findByTestId(root, "agent-studio-git-commit-submit-button").props.disabled),
    ).toBe(true);

    await act(async () => {
      findByTestId(root, "agent-studio-git-commit-message-input").props.onChange({
        currentTarget: { value: "   " },
      });
      await flush();
    });
    expect(
      Boolean(findByTestId(root, "agent-studio-git-commit-submit-button").props.disabled),
    ).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(
          baseModel({ ...stagedFile, isPushing: true, diffScope: "uncommitted", commit }),
        ),
      );
      await flush();
    });
    expect(Boolean(findByTestId(root, "agent-studio-git-rebase-button").props.disabled)).toBe(true);
    await act(async () => {
      findByTestId(root, "agent-studio-git-commit-message-input").props.onChange({
        currentTarget: { value: "feat: commit staged files" },
      });
      await flush();
    });
    expect(
      Boolean(findByTestId(root, "agent-studio-git-commit-submit-button").props.disabled),
    ).toBe(true);
    expect(getNodeText(findByTestId(root, "agent-studio-git-commit-hint"))).toBe(
      "Wait for the push to finish.",
    );

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(
          baseModel({ ...stagedFile, diffScope: "uncommitted", commit }),
        ),
      );
      await flush();
    });
    expect(
      Boolean(findByTestId(root, "agent-studio-git-commit-submit-button").props.disabled),
    ).toBe(false);

    await act(async () => {
      findByTestId(root, "agent-studio-git-commit-submit-button").props.onClick();
      await flush();
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("staged", "feat: commit staged files");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("switches diff scope and validates the commit message", async () => {
    const commit = mock(async (_mode: GitCommitMode, _message: string) => true);
    const refresh = mock(async () => {});
    const modelFor = (diffScope: "target" | "uncommitted") =>
      baseModel({
        diffScope,
        commit,
        refresh,
        fileStatuses: [{ path: "src/a.ts", staged: true, status: "modified" }],
        fileDiffs: [toFileDiff("src/a.ts")],
        commitError: "",
      });

    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: modelFor("target") }));
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-commit-message-input")).toBe(0);
    expect(countByTestId(root, "agent-studio-git-commit-submit-button")).toBe(0);

    await act(async () => {
      fireEvent.mouseDown(findDiffScopeTabs(root, "uncommitted").element, { button: 0 });
      await flush();
    });
    expect(
      screen.getByTestId("agent-studio-git-diff-scope-uncommitted").getAttribute("aria-selected"),
    ).toBe("true");
    expect(countByTestId(root, "agent-studio-git-commit-message-input")).toBe(1);

    await act(async () => {
      ensureRenderer(renderer).rerender(renderAgentStudioGitPanelElement(modelFor("uncommitted")));
      await flush();
    });

    const messageInput = findByTestId(root, "agent-studio-git-commit-message-input");
    const submitButton = findByTestId(root, "agent-studio-git-commit-submit-button");

    expect(Boolean(submitButton.props.disabled)).toBe(true);

    await act(async () => {
      messageInput.props.onChange({ currentTarget: { value: "   " } });
      await flush();
    });
    expect(Boolean(submitButton.props.disabled)).toBe(true);

    await act(async () => {
      messageInput.props.onChange({ currentTarget: { value: "  chore: tidy git flow  " } });
      await flush();
    });
    const messageInputAfterTyping = findByTestId(root, "agent-studio-git-commit-message-input");
    expect(messageInputAfterTyping.props.value).toBe("  chore: tidy git flow  ");

    const submitButtonAfterTyping = findByTestId(root, "agent-studio-git-commit-submit-button");
    expect(Boolean(submitButtonAfterTyping.props.disabled)).toBe(false);

    await act(async () => {
      submitButtonAfterTyping.props.onClick();
      await flush();
    });
    expect(commit).toHaveBeenCalledWith("staged", "  chore: tidy git flow  ");
    const commitInputAfterSubmit = findByTestId(root, "agent-studio-git-commit-message-input");
    expect(commitInputAfterSubmit.props.value).toBe("");
    expect(
      Boolean(findByTestId(root, "agent-studio-git-commit-submit-button").props.disabled),
    ).toBe(true);

    await act(async () => {
      fireEvent.mouseDown(findDiffScopeTabs(root, "target").element, { button: 0 });
      await flush();
    });
    expect(
      screen.getByTestId("agent-studio-git-diff-scope-target").getAttribute("aria-selected"),
    ).toBe("true");
    expect(countByTestId(root, "agent-studio-git-commit-message-input")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("keeps Branch changes selected while its comparison loads, fails, and recovers", async () => {
    const model = (overrides: PanelModelInput) =>
      baseModel({
        diffScope: "uncommitted",
        comparisonReference: null,
        fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
        ...overrides,
      });
    const branchTab = () => screen.getByTestId("agent-studio-git-diff-scope-target");
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: model({
            comparisonPending: true,
            loadedScopesByScope: { target: false, uncommitted: true },
          }),
        }),
      );
      await flush();
    });

    await act(async () => {
      fireEvent.mouseDown(branchTab(), { button: 0 });
      await flush();
    });
    expect(branchTab().getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Checking changes against origin/main...")).toBeTruthy();

    const reason = "Comparison branch origin/main is unavailable.";
    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(
          model({ comparisonPending: false, comparisonUnavailableReason: reason, error: reason }),
        ),
      );
      await flush();
    });
    expect(branchTab().getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Branch changes are unavailable")).toBeTruthy();

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(
          model({
            comparisonPending: false,
            comparisonReference: "origin/main",
            fileDiffs: [toFileDiff("src/a.ts")],
          }),
        ),
      );
      await flush();
    });
    expect(branchTab().getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("Branch changes are unavailable")).toBeNull();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("expands and collapses a diff entry without mutating selected-file state", async () => {
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            fileDiffs: [
              {
                file: "src/a.ts",
                type: "modified",
                additions: 2,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    const diffButton = findButtonByText(root, "a.ts");

    await act(async () => {
      diffButton.props.onClick();
      await flush();
    });
    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(1);

    await act(async () => {
      diffButton.props.onClick();
      await flush();
    });
    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(1);
    expect(findByTestId(root, "mock-pierre-diff-viewer").element.closest(".hidden")).not.toBeNull();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("handles rapid consecutive file toggles without stale expansion state", async () => {
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            fileDiffs: [
              {
                file: "src/a.ts",
                type: "modified",
                additions: 2,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    const diffButton = findButtonByText(root, "a.ts");

    await act(async () => {
      diffButton.props.onClick();
      diffButton.props.onClick();
      await flush();
    });

    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("disables commit/push/rebase controls during detached branch and action in-flight", async () => {
    const commit = mock(async (_mode: GitCommitMode, _message: string) => true);
    const pushBranch = mock(async () => {});
    const rebaseOntoTarget = mock(async () => {});
    const pullFromUpstream = mock(async () => {});
    const detachedModel = (overrides: Partial<AgentStudioGitPanelModel> = {}) =>
      baseModel({
        branch: null,
        diffScope: "uncommitted",
        commit,
        pushBranch,
        rebaseOntoTarget,
        pullFromUpstream,
        fileStatuses: [{ path: "src/a.ts", staged: true, status: "modified" }],
        fileDiffs: [toFileDiff("src/a.ts")],
        ...overrides,
      });

    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: detachedModel() }));
      await flush();
    });

    const root = getRoot(renderer);
    const refreshButton = findByTestId(root, "agent-studio-git-refresh-button");
    const commitInput = findByTestId(root, "agent-studio-git-commit-message-input");
    const commitSubmit = findByTestId(root, "agent-studio-git-commit-submit-button");
    const rebaseButton = findByTestId(root, "agent-studio-git-rebase-button");
    const pullButton = findByTestId(root, "agent-studio-git-pull-button");
    const pushButton = findByTestId(root, "agent-studio-git-push-button");

    expect(Boolean(rebaseButton.props.disabled)).toBe(true);
    expect(Boolean(pullButton.props.disabled)).toBe(true);
    expect(Boolean(pushButton.props.disabled)).toBe(true);
    expect(Boolean(refreshButton.props.disabled)).toBe(false);

    await act(async () => {
      commitInput.props.onChange({ currentTarget: { value: "fix: handle detached head" } });
      await flush();
    });
    await act(async () => {
      commitSubmit.props.onClick();
      await flush();
    });
    expect(commit).toHaveBeenCalledWith("staged", "fix: handle detached head");

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(
          detachedModel({ isCommitting: true, committingMode: "staged" }),
        ),
      );
      await flush();
    });

    expect(Boolean(commitInput.props.disabled)).toBe(true);
    expect(Boolean(commitSubmit.props.disabled)).toBe(true);
    expect(screen.getByTestId("agent-studio-git-commit-status").textContent).toBe(
      "Committing staged changes",
    );

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(
          detachedModel({ isCommitting: true, committingMode: "all" }),
        ),
      );
      await flush();
    });
    expect(screen.getByTestId("agent-studio-git-commit-status").textContent).toBe(
      "Committing all changes",
    );
    expect(Boolean(commitSubmit.props.disabled)).toBe(true);
    expect(Boolean(rebaseButton.props.disabled)).toBe(true);
    expect(Boolean(pullButton.props.disabled)).toBe(true);
    expect(Boolean(pushButton.props.disabled)).toBe(true);
    expect(Boolean(refreshButton.props.disabled)).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement(
          detachedModel({
            isCommitting: true,
            committingMode: "staged",
            isPushing: true,
            isRebasing: true,
          }),
        ),
      );
      await flush();
    });

    expect(Boolean(refreshButton.props.disabled)).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("disables push when the branch is already up to date with upstream", async () => {
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            fileStatuses: [],
            uncommittedFileCount: 0,
            upstreamAheadBehind: { ahead: 0, behind: 0 },
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    const pushButton = findByTestId(root, "agent-studio-git-push-button");
    expect(Boolean(pushButton.props.disabled)).toBe(true);
    expect(hasVisibleText(root, "Branch is up to date with upstream")).toBe(true);
    expect(countByTestId(root, "agent-studio-git-ahead-count")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("uses a loader icon while pushing", async () => {
    let renderer: RenderResult | null = null;

    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            isPushing: true,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    const pushButton = findByTestId(root, "agent-studio-git-push-button");
    expect(pushButton.element.querySelector("svg")).toBeTruthy();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows upstream behind count and keeps normal push available", async () => {
    const pushBranch = mock(async () => {});
    const pullFromUpstream = mock(async () => {});

    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            upstreamAheadBehind: { ahead: 4, behind: 3 },
            fileStatuses: [],
            pushBranch,
            pullFromUpstream,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(
      findByTestId(root, "agent-studio-git-upstream-behind-count").children.join(""),
    ).toContain("3");
    expect(
      hasVisibleText(root, "Pull with rebase (3 behind; 4 local commits will be rewritten)"),
    ).toBe(true);
    expect(hasVisibleText(root, "Push branch (3 behind; confirmation may be required)")).toBe(true);
    expect(Boolean(findByTestId(root, "agent-studio-git-push-button").props.disabled)).toBe(false);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("disables pull with uncommitted changes and explains why", async () => {
    const pullFromUpstream = mock(async () => {});

    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            upstreamAheadBehind: { ahead: 0, behind: 2 },
            fileStatuses: [{ path: "src/dirty.ts", staged: false, status: "M" }],
            pullFromUpstream,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(findByTestId(root, "agent-studio-git-pull-tooltip-trigger")).toBeTruthy();
    const pullButton = findByTestId(root, "agent-studio-git-pull-button");
    const pushButton = findByTestId(root, "agent-studio-git-push-button");
    expect(Boolean(pullButton.props.disabled)).toBe(true);
    expect(pullButton.props.className).toContain("disabled:pointer-events-auto");
    expect(pullButton.props.className).toContain("disabled:cursor-not-allowed");
    expect(Boolean(pushButton.props.disabled)).toBe(false);
    expect(hasVisibleText(root, "Commit or stash changes before pulling")).toBe(true);
    expect(hasVisibleText(root, "Push branch (2 behind; confirmation may be required)")).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("disables rebase with uncommitted changes and explains why", async () => {
    const rebaseOntoTarget = mock(async () => {});

    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            commitsAheadBehind: { ahead: 0, behind: 2 },
            fileStatuses: [{ path: "src/dirty.ts", staged: false, status: "M" }],
            rebaseOntoTarget,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    const rebaseButton = findByTestId(root, "agent-studio-git-rebase-button");
    expect(Boolean(rebaseButton.props.disabled)).toBe(true);
    expect(rebaseButton.props.className).toContain("disabled:pointer-events-auto");
    expect(rebaseButton.props.className).toContain("disabled:cursor-not-allowed");
    expect(hasVisibleText(root, "Commit or stash changes before rebasing")).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("hides the generic lock banner when the conflict strip is already visible", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            isGitActionsLocked: true,
            gitActionsLockReason: "Git actions are disabled while the Builder session is working.",
            askBuilderToResolveGitConflict: async () => {},
            gitConflict: {
              operation: "rebase",
              currentBranch: "feature/task-11",
              targetBranch: "origin/main",
              conflictedFiles: ["src/main.ts", "src/routes.ts"],
              output: "CONFLICT (content): Merge conflict in src/main.ts",
              workingDir: "/tmp/worktree",
            },
            pendingForcePush: {
              remote: "origin",
              branch: "feature/task-11",
              output: "non-fast-forward",
              repoPath: "/repo",
              workingDir: "/tmp/worktree",
            },
            pendingPullRebase: {
              branch: "feature/task-11",
              localAhead: 2,
              upstreamBehind: 1,
            },
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-lock-reason")).toBe(0);
    expect(findByTestId(root, "agent-studio-git-conflict-strip")).toBeTruthy();
    const conflictCountBadge = findByTestId(root, "agent-studio-git-conflict-count-badge");
    expect(getNodeText(conflictCountBadge)).toContain("2 conflicted files");
    expect(String(conflictCountBadge.props.className)).toContain("bg-warning-surface");
    expect(String(conflictCountBadge.props.className)).toContain("border-warning-border");
    expect(findByTestId(root, "agent-studio-git-view-conflict-details-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-abort-conflict-strip-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-ask-builder-conflict-strip-button")).toBeTruthy();
    expect(countByTestId(root, "agent-studio-git-conflict-modal")).toBe(0);
    expect(findByTestId(root, "agent-studio-git-force-push-modal")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-confirm-force-push-button")).toBeTruthy();
    expect(getNodeText(findByTestId(root, "agent-studio-git-force-push-safety-note"))).toContain(
      "--force-with-lease",
    );
    expect(getNodeText(findByTestId(root, "agent-studio-git-force-push-safety-note"))).toContain(
      "fails instead of overwriting their work",
    );
    expect(getNodeText(findByTestId(root, "agent-studio-git-force-push-safety-note"))).toContain(
      "--force",
    );
    expect(findByTestId(root, "agent-studio-git-pull-rebase-modal")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-confirm-pull-rebase-button")).toBeTruthy();
    expect(getNodeText(findByTestId(root, "agent-studio-git-pull-rebase-safety-note"))).toContain(
      "This will replay 2 local commits on top of 1 upstream commit",
    );

    await act(async () => {
      findByTestId(root, "agent-studio-git-view-conflict-details-button").props.onClick();
      await flush();
    });

    expect(findByTestId(root, "agent-studio-git-conflict-modal")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-abort-conflict-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-ask-builder-conflict-button")).toBeTruthy();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("hides the generic lock banner when builder locking is tooltip-only", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            isGitActionsLocked: true,
            showLockReasonBanner: false,
            gitActionsLockReason: "Git actions are disabled while the Builder session is working.",
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-lock-reason")).toBe(0);
    expect(hasVisibleText(root, "Builder session is working")).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("renders the generic lock banner when explicitly requested", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            isGitActionsLocked: true,
            showLockReasonBanner: true,
            gitActionsLockReason: "Git actions are temporarily disabled.",
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(getNodeText(findByTestId(root, "agent-studio-git-lock-reason"))).toContain(
      "temporarily disabled",
    );

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("renders persisted pull-rebase conflicts in the strip without auto-opening the modal", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            gitConflict: {
              operation: "pull_rebase",
              currentBranch: "feature/task-11",
              targetBranch: "tracked upstream branch",
              conflictedFiles: ["AGENTS.md"],
              output: "CONFLICT (content): Merge conflict in AGENTS.md",
              workingDir: "/tmp/worktree",
            },
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(getNodeText(findByTestId(root, "agent-studio-git-conflict-strip"))).toContain(
      "Pull with rebase in progress",
    );
    expect(countByTestId(root, "agent-studio-git-conflict-modal")).toBe(0);
    expect(hasVisibleText(root, "tracked upstream branch")).toBe(true);

    await act(async () => {
      findByTestId(root, "agent-studio-git-view-conflict-details-button").props.onClick();
      await flush();
    });

    expect(getNodeText(findByTestId(root, "agent-studio-git-conflict-modal"))).toContain(
      "Pull with rebase conflict detected",
    );

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("keeps abort available without Builder actions in a workspace conflict", async () => {
    const abort = mock(async () => {});
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            abortGitConflict: abort,
            gitConflict: {
              operation: "pull_rebase",
              currentBranch: "feature/workspace",
              targetBranch: "tracked upstream branch",
              conflictedFiles: ["AGENTS.md"],
              output: "CONFLICT (content): Merge conflict in AGENTS.md",
              workingDir: "/tmp/worktree",
            },
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-ask-builder-conflict-strip-button")).toBe(0);
    expect(
      Boolean(findByTestId(root, "agent-studio-git-abort-conflict-strip-button").props.disabled),
    ).toBe(false);
    await act(async () => {
      findByTestId(root, "agent-studio-git-abort-conflict-strip-button").props.onClick();
      findByTestId(root, "agent-studio-git-view-conflict-details-button").props.onClick();
      await flush();
    });

    const dialog = findByTestId(root, "agent-studio-git-conflict-modal");
    expect(countByTestId(root, "agent-studio-git-ask-builder-conflict-button")).toBe(0);
    expect(getNodeText(dialog)).not.toContain("Builder");
    expect(getNodeText(dialog)).toContain("Abort the git operation.");
    expect(
      Boolean(findByTestId(root, "agent-studio-git-abort-conflict-button").props.disabled),
    ).toBe(false);
    await act(async () => {
      findByTestId(root, "agent-studio-git-abort-conflict-button").props.onClick();
      await flush();
    });
    expect(abort).toHaveBeenCalledTimes(2);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("auto-opens the conflict modal only when the controller emits a fresh conflict-open signal", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: baseModel() }));
      await flush();
    });

    const persistedConflictModel = baseModel({
      gitConflict: {
        operation: "rebase",
        currentBranch: "feature/task-11",
        targetBranch: "origin/main",
        conflictedFiles: ["AGENTS.md"],
        output: "CONFLICT (content): Merge conflict in AGENTS.md",
        workingDir: "/tmp/worktree",
      },
    });

    await act(async () => {
      ensureRenderer(renderer).rerender(renderAgentStudioGitPanelElement(persistedConflictModel));
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-conflict-modal")).toBe(0);

    const actionConflictModel = baseModel({
      gitConflictAutoOpenNonce: 1,
      gitConflict: {
        operation: "rebase",
        currentBranch: "feature/task-11",
        targetBranch: "origin/main",
        conflictedFiles: ["AGENTS.md"],
        output: "CONFLICT (content): Merge conflict in AGENTS.md",
        workingDir: "/tmp/worktree",
      },
    });

    await act(async () => {
      ensureRenderer(renderer).rerender(renderAgentStudioGitPanelElement(actionConflictModel));
      await flush();
    });

    expect(findByTestId(root, "agent-studio-git-conflict-modal")).toBeTruthy();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows abort loading state and disables both conflict actions while abort is pending", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: baseModel() }));
      await flush();
    });

    const abortPendingModel = baseModel({
      askBuilderToResolveGitConflict: async () => {},
      isHandlingGitConflict: true,
      gitConflictAction: "abort",
      gitConflictAutoOpenNonce: 1,
      gitConflict: {
        operation: "rebase",
        currentBranch: "feature/task-11",
        targetBranch: "origin/main",
        conflictedFiles: ["AGENTS.md"],
        output: "CONFLICT (content): Merge conflict in AGENTS.md",
        workingDir: "/tmp/worktree",
      },
    });

    await act(async () => {
      ensureRenderer(renderer).rerender(renderAgentStudioGitPanelElement(abortPendingModel));
      await flush();
    });

    const root = getRoot(renderer);
    expect(getNodeText(findByTestId(root, "agent-studio-git-abort-conflict-button"))).toContain(
      "Aborting...",
    );
    expect(
      Boolean(findByTestId(root, "agent-studio-git-abort-conflict-button").props.disabled),
    ).toBe(true);
    expect(
      Boolean(findByTestId(root, "agent-studio-git-ask-builder-conflict-button").props.disabled),
    ).toBe(true);
    expect(
      getNodeText(findByTestId(root, "agent-studio-git-abort-conflict-strip-button")),
    ).toContain("Aborting...");
    expect(
      Boolean(
        findByTestId(root, "agent-studio-git-ask-builder-conflict-strip-button").props.disabled,
      ),
    ).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows ask-builder loading state and disables both conflict actions while request is pending", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: baseModel() }));
      await flush();
    });

    const askBuilderPendingModel = baseModel({
      askBuilderToResolveGitConflict: async () => {},
      isHandlingGitConflict: true,
      gitConflictAction: "ask_builder",
      gitConflictAutoOpenNonce: 1,
      gitConflict: {
        operation: "rebase",
        currentBranch: "feature/task-11",
        targetBranch: "origin/main",
        conflictedFiles: ["AGENTS.md"],
        output: "CONFLICT (content): Merge conflict in AGENTS.md",
        workingDir: "/tmp/worktree",
      },
    });

    await act(async () => {
      ensureRenderer(renderer).rerender(renderAgentStudioGitPanelElement(askBuilderPendingModel));
      await flush();
    });

    const root = getRoot(renderer);
    expect(
      getNodeText(findByTestId(root, "agent-studio-git-ask-builder-conflict-button")),
    ).toContain("Sending to Builder...");
    expect(
      Boolean(findByTestId(root, "agent-studio-git-abort-conflict-button").props.disabled),
    ).toBe(true);
    expect(
      Boolean(findByTestId(root, "agent-studio-git-ask-builder-conflict-button").props.disabled),
    ).toBe(true);
    expect(
      getNodeText(findByTestId(root, "agent-studio-git-ask-builder-conflict-strip-button")),
    ).toContain("Sending to Builder...");
    expect(
      Boolean(findByTestId(root, "agent-studio-git-abort-conflict-strip-button").props.disabled),
    ).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("closes the conflict modal before sending the ask-builder action", async () => {
    const askBuilder = mock(async () => {});
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model: baseModel() }));
      await flush();
    });

    const conflictModel = baseModel({
      askBuilderToResolveGitConflict: askBuilder,
      gitConflictAutoOpenNonce: 1,
      gitConflict: {
        operation: "rebase",
        currentBranch: "feature/task-11",
        targetBranch: "origin/main",
        conflictedFiles: ["AGENTS.md"],
        output: "CONFLICT (content): Merge conflict in AGENTS.md",
        workingDir: "/tmp/worktree",
      },
    });

    await act(async () => {
      ensureRenderer(renderer).rerender(renderAgentStudioGitPanelElement(conflictModel));
      await flush();
    });

    const root = getRoot(renderer);
    expect(findByTestId(root, "agent-studio-git-conflict-modal")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-ask-builder-conflict-strip-button")).toBeTruthy();
    expect(getNodeText(findByTestId(root, "agent-studio-git-conflict-modal"))).toContain(
      "send the conflict to Builder",
    );

    await act(async () => {
      findByTestId(root, "agent-studio-git-ask-builder-conflict-button").props.onClick();
      await flush();
    });

    expect(askBuilder).toHaveBeenCalledTimes(1);
    expect(
      getRoot(renderer).element.querySelector(
        '[data-testid="agent-studio-git-conflict-modal"][data-state="open"]',
      ),
    ).toBeNull();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows conflicted files in their own group before the local groups", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            fileDiffs: [toFileDiff("AGENTS.md"), toFileDiff("README.md")],
            fileStatuses: [
              { path: "AGENTS.md", staged: false, status: "unmerged" },
              { path: "README.md", staged: false, status: "modified" },
            ],
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    const conflicted = findByTestId(root, "agent-studio-git-group-conflicted");
    const unstaged = findByTestId(root, "agent-studio-git-group-unstaged");
    expect(
      conflicted.element.compareDocumentPosition(unstaged.element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(getNodeText(findByTestId(root, "agent-studio-git-conflicted-count"))).toBe("1");
    expect(getNodeText(conflicted)).toContain("AGENTS.md");
    expect(getNodeText(conflicted)).not.toContain("README.md");
    expect(countByTestId(conflicted, "agent-studio-git-file-conflict-indicator")).toBe(1);
    expect(countByTestId(conflicted, "agent-studio-git-stage-file-button")).toBe(0);
    expect(countByTestId(conflicted, "agent-studio-git-discard-file-button")).toBe(0);
    expect(getNodeText(unstaged)).toContain("README.md");
    expect(countByTestId(unstaged, "agent-studio-git-file-conflict-indicator")).toBe(0);
    expect(countByTestId(unstaged, "agent-studio-git-file-conflict-slot")).toBe(0);
    expect(getNodeText(findByTestId(root, "agent-studio-git-commit-hint"))).toBe(
      "Resolve the conflicted files before you commit.",
    );

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("renders expanded file diff rows and mounts mocked diff viewer", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "target",
            fileDiffs: [
              {
                file: "src/main.ts",
                type: "modified",
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
            fileStatuses: [
              {
                path: "src/main.ts",
                staged: false,
                status: "M",
              },
            ],
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-file-conflict-slot")).toBe(0);
    const fileRowButton = findButtonByText(root, "main.ts");

    expect(getNodeText(root)).toContain("+1");
    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(0);

    await act(async () => {
      fileRowButton.props.onClick();
      await flush();
    });

    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(1);

    await act(async () => {
      findButtonByText(root, "main.ts").props.onClick();
      await flush();
    });

    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(1);
    expect(findByTestId(root, "mock-pierre-diff-viewer").element.closest(".hidden")).not.toBeNull();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("stages and discards a file from its row without toggling the diff", async () => {
    const changeSelection = mock((_intent: GitChangeIntent) => {});
    const model = baseModel({
      diffScope: "uncommitted",
      changeSelection,
      fileDiffs: [toFileDiff("src/main.ts")],
      fileStatuses: [{ path: "src/main.ts", staged: false, status: "modified" }],
    });
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model }));
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-unstage-file-button")).toBe(0);
    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(0);

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-stage-file-button"));
      fireEvent.click(screen.getByTestId("agent-studio-git-discard-file-button"));
      await flush();
    });

    expect(changeSelection.mock.calls).toEqual([
      [
        {
          action: "stage",
          group: "unstaged",
          selection: { kind: "file", filePath: "src/main.ts" },
        },
      ],
      [
        {
          action: "discard",
          group: "unstaged",
          selection: { kind: "file", filePath: "src/main.ts" },
        },
      ],
    ]);
    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(0);

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-target"), { button: 0 });
      await flush();
    });

    expect(countByTestId(root, "agent-studio-git-file-toggle-button")).toBe(1);
    expect(countByTestId(root, "agent-studio-git-stage-file-button")).toBe(0);
    expect(countByTestId(root, "agent-studio-git-discard-file-button")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("disables Discard for a submodule and keeps Stage", async () => {
    const changeSelection = mock((_intent: GitChangeIntent) => {});
    const submodule: GitFileDiff = {
      file: "vendor/lib",
      type: "submodule",
      additions: 1,
      deletions: 1,
      diff: "diff --git a/vendor/lib b/vendor/lib\nindex aaa..bbb 160000\n--- a/vendor/lib\n+++ b/vendor/lib\n@@ -1 +1 @@\n-Subproject commit aaa\n+Subproject commit bbb\n",
    };
    await act(async () => {
      render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            changeSelection,
            fileDiffs: [submodule],
            fileStatuses: [{ path: "vendor/lib", staged: false, status: "modified" }],
          }),
        }),
      );
      await flush();
    });

    const discard = screen.getByTestId("agent-studio-git-discard-file-button");
    expect(discard.hasAttribute("disabled")).toBe(true);
    expect(discard.getAttribute("title")).toContain("vendor/lib is a submodule.");
    await act(async () => {
      fireEvent.click(discard);
      fireEvent.click(screen.getByTestId("agent-studio-git-stage-file-button"));
      await flush();
    });
    expect(changeSelection.mock.calls).toEqual([
      [{ action: "stage", group: "unstaged", selection: { kind: "file", filePath: "vendor/lib" } }],
    ]);
  });

  test("disables file and group change actions with the change blocker reason", async () => {
    const changeSelection = mock((_intent: GitChangeIntent) => {});
    const reason = "Wait for the Git change to finish.";
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            changeSelection,
            changeDisabledReason: reason,
            fileDiffs: [toFileDiff("src/main.ts")],
            fileStatuses: [{ path: "src/main.ts", staged: false, status: "modified" }],
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    for (const testId of [
      "agent-studio-git-stage-file-button",
      "agent-studio-git-discard-file-button",
      "agent-studio-git-stage-all-button",
    ]) {
      const button = findByTestId(root, testId);
      expect(button.props.disabled).toBe(true);
      expect(button.props.title).toBe(reason);
    }
    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-stage-all-button"));
      await flush();
    });
    expect(changeSelection).not.toHaveBeenCalled();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows basename-first file paths with the full path in the tooltip", async () => {
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            fileDiffs: [
              {
                file: "packages/frontend/src/components/features/agents/agent-studio-git-panel/file-diff-entry.tsx",
                type: "modified",
                additions: 3,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
            fileStatuses: [
              {
                path: "packages/frontend/src/components/features/agents/agent-studio-git-panel/file-diff-entry.tsx",
                staged: false,
                status: "modified",
              },
            ],
          }),
        }),
      );
      await flush();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "List view" }));
      await flush();
    });

    const root = getRoot(renderer);
    const headerNode = findByTestId(root, "agent-studio-git-list-header");
    const pathNode = findByTestId(root, "agent-studio-git-file-path");

    expect(headerNode.props.className).toContain("min-w-0");
    expect(pathNode.props.title).toBe(
      "packages/frontend/src/components/features/agents/agent-studio-git-panel/file-diff-entry.tsx",
    );
    expect(pathNode.props.className).toContain("flex-col");
    expect(pathNode.props.className).toContain("overflow-hidden");
    expect(getNodeText(pathNode)).toContain("file-diff-entry.tsx");
    expect(getNodeText(pathNode)).toContain(
      "packages/frontend/src/components/features/agents/agent-studio-git-panel",
    );

    const fileNameNode = pathNode.findAll(
      (node) => node.type === "span" && node.children.includes("file-diff-entry.tsx"),
    )[0];
    const dirNameNode = pathNode.findAll(
      (node) =>
        node.type === "span" &&
        node.children.includes(
          "packages/frontend/src/components/features/agents/agent-studio-git-panel",
        ),
    )[0];

    expect(fileNameNode?.props.className).toContain("block truncate");
    expect(dirNameNode?.props.className).toContain("block truncate");

    const statsNode = findByTestId(root, "agent-studio-git-file-stats");
    expect(statsNode.props.className).toContain("shrink-0");
    expect(statsNode.props.className).not.toContain("border-l");
    expect(getNodeText(statsNode)).toContain("+3");
    expect(getNodeText(statsNode)).toContain("-1");
    expect(getNodeText(statsNode)).not.toContain("M");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows three tabs and opens History without changing the diff scope", async () => {
    const currentTip = "a".repeat(40);
    const targetTip = "b".repeat(40);
    const historyPage: GitHistoryPage = {
      outcome: "page",
      comparison: {
        currentTip,
        targetTip,
        boundaryOids: ["c".repeat(40)],
        aheadBehind: { ahead: 2, behind: 1 },
      },
      commits: [],
      nextOffset: null,
    };
    const readHistory = mock(async (_request: GitHistoryPageRequest) => historyPage);
    // GitHistoryView reads through the host of its connection.
    const connection = createTestClientConnection({ client: { gitGetHistoryPage: readHistory } });
    let renderer: RenderResult | null = null;
    try {
      await act(async () => {
        renderer = renderWithoutProviders(
          createElement(
            QueryProvider,
            { connection },
            createElement(AgentStudioGitPanel, {
              model: baseModel({
                diffScope: "uncommitted",
                repoPath: "/repo",
                comparisonReference: "origin/main",
                checkout: { name: "feature/task-11", detached: false },
              }),
            }),
          ),
        );
        await flush();
      });

      expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("data-testid"))).toEqual([
        "agent-studio-git-diff-scope-uncommitted",
        "agent-studio-git-diff-scope-target",
        "agent-studio-git-tab-history",
      ]);
      const historyTab = screen.getByTestId("agent-studio-git-tab-history");
      expect(historyTab.textContent).toBe("History");

      await act(async () => {
        fireEvent.mouseDown(historyTab, { button: 0 });
        await flush();
      });
      await waitFor(() => screen.getByTestId("agent-studio-git-history"));

      expect(historyTab.getAttribute("aria-selected")).toBe("true");
      expect(readHistory).toHaveBeenCalledWith({
        repoPath: "/repo",
        workingDir: "/tmp/worktree",
        targetReference: "origin/main",
        expectedBranch: { name: "feature/task-11", detached: false },
      });
      expect(screen.queryByTestId("agent-studio-git-commit-form")).toBeNull();

      await act(async () => {
        fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-uncommitted"), {
          button: 0,
        });
        await flush();
      });
      expect(screen.queryByTestId("agent-studio-git-history")).toBeNull();
      expect(screen.getByTestId("agent-studio-git-commit-form")).toBeDefined();
    } finally {
      await act(async () => {
        ensureRenderer(renderer).unmount();
        await flush();
      });
      await connection.dispose();
    }
  });

  test("commits staged changes with Enter and every change with Cmd or Ctrl and Enter", async () => {
    const commit = mock(async (_mode: GitCommitMode, _message: string) => true);
    await act(async () => {
      render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            commit,
            fileStatuses: [
              { path: "src/staged.ts", staged: true, status: "modified" },
              { path: "src/unstaged.ts", staged: false, status: "modified" },
            ],
            fileDiffs: [toFileDiff("src/staged.ts"), toFileDiff("src/unstaged.ts")],
          }),
        }),
      );
      await flush();
    });
    const input = () => screen.getByTestId("agent-studio-git-commit-message-input");
    const modifier = isApplePlatform() ? "⌘" : "Ctrl";
    expect(screen.getByTestId("agent-studio-git-commit-hint").textContent).toBe(
      `Enter commits 1 staged file. ${modifier}+Enter stages and commits all 2 changed files.`,
    );
    expect(input().getAttribute("placeholder")).toBe(
      `Commit message (${modifier}+Enter commits all)`,
    );

    await act(async () => {
      fireEvent.change(input(), { target: { value: "feat: staged only" } });
      await flush();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-commit-submit-button"));
      await flush();
    });
    expect(commit).toHaveBeenLastCalledWith("staged", "feat: staged only");
    expect(input()).toHaveProperty("value", "");

    await act(async () => {
      fireEvent.change(input(), { target: { value: "feat: from the keyboard" } });
      await flush();
    });
    await act(async () => {
      fireEvent.keyDown(input(), { key: "Enter" });
      await flush();
    });
    expect(commit).toHaveBeenLastCalledWith("staged", "feat: from the keyboard");

    for (const modifierKey of [{ metaKey: true }, { ctrlKey: true }]) {
      await act(async () => {
        fireEvent.change(input(), { target: { value: "feat: everything" } });
        await flush();
      });
      await act(async () => {
        fireEvent.keyDown(input(), { key: "Enter", ...modifierKey });
        await flush();
      });
      expect(commit).toHaveBeenLastCalledWith("all", "feat: everything");
      expect(input()).toHaveProperty("value", "");
    }
    expect(commit).toHaveBeenCalledTimes(4);
  });

  test("does not commit on Enter while an input method composes text", async () => {
    const commit = mock(async (_mode: GitCommitMode, _message: string) => true);
    await act(async () => {
      render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            commit,
            fileStatuses: [{ path: "src/staged.ts", staged: true, status: "modified" }],
            fileDiffs: [toFileDiff("src/staged.ts")],
          }),
        }),
      );
      await flush();
    });
    const input = screen.getByTestId("agent-studio-git-commit-message-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "feat: 日本" } });
      fireEvent.keyDown(input, { key: "Enter", isComposing: true });
      await flush();
    });
    expect(commit).not.toHaveBeenCalled();
    expect(input).toHaveProperty("value", "feat: 日本");
  });

  test("blocks both commit modes while a conflicted file remains beside a staged file", async () => {
    const commit = mock(async (_mode: GitCommitMode, _message: string) => true);
    await act(async () => {
      render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            commit,
            fileStatuses: [
              { path: "src/resolved.ts", staged: true, status: "modified" },
              { path: "src/conflict.ts", staged: false, status: "unmerged" },
            ],
            fileDiffs: [toFileDiff("src/resolved.ts"), toFileDiff("src/conflict.ts")],
          }),
        }),
      );
      await flush();
    });
    const input = screen.getByTestId("agent-studio-git-commit-message-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "fix: resolve the merge" } });
      await flush();
    });

    expect(
      screen.getByTestId("agent-studio-git-commit-submit-button").hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
      await flush();
    });
    expect(commit).not.toHaveBeenCalled();
  });

  test("explains a disabled Commit when nothing is staged and keeps Cmd or Ctrl and Enter available", async () => {
    const commit = mock(async (_mode: GitCommitMode, _message: string) => true);
    await act(async () => {
      render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            commit,
            fileStatuses: [{ path: "src/unstaged.ts", staged: false, status: "modified" }],
            fileDiffs: [toFileDiff("src/unstaged.ts")],
          }),
        }),
      );
      await flush();
    });
    const input = screen.getByTestId("agent-studio-git-commit-message-input");

    await act(async () => {
      fireEvent.change(input, { target: { value: "feat: unstaged work" } });
      await flush();
    });
    expect(
      screen.getByTestId("agent-studio-git-commit-submit-button").hasAttribute("disabled"),
    ).toBe(true);
    const modifier = isApplePlatform() ? "⌘" : "Ctrl";
    expect(screen.getByTestId("agent-studio-git-commit-hint").textContent).toBe(
      `Nothing is staged. ${modifier}+Enter stages and commits all 1 changed file.`,
    );
    // The tooltip of the disabled button tells how to commit.
    fireEvent.pointerMove(screen.getByTestId("agent-studio-git-commit-submit-button"), {
      pointerType: "mouse",
    });
    await waitFor(() =>
      expect(
        screen.getAllByText(
          `Nothing is staged. Stage files, or press ${modifier}+Enter to commit all changes.`,
        ).length,
      ).toBeGreaterThan(0),
    );

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await flush();
    });
    expect(commit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
      await flush();
    });
    expect(commit).toHaveBeenCalledWith("all", "feat: unstaged work");
  });

  test("keeps the commit draft across a tab change and a remount", async () => {
    const model = baseModel({
      diffScope: "uncommitted",
      fileStatuses: [{ path: "src/staged.ts", staged: true, status: "modified" }],
      fileDiffs: [toFileDiff("src/staged.ts")],
    });
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model }));
      await flush();
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("agent-studio-git-commit-message-input"), {
        target: { value: "wip: keep this draft" },
      });
      await flush();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-target"), { button: 0 });
      await flush();
    });
    expect(screen.queryByTestId("agent-studio-git-commit-message-input")).toBeNull();
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-uncommitted"), {
        button: 0,
      });
      await flush();
    });
    expect(screen.getByTestId("agent-studio-git-commit-message-input")).toHaveProperty(
      "value",
      "wip: keep this draft",
    );

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model }));
      await flush();
    });
    expect(screen.getByTestId("agent-studio-git-commit-message-input")).toHaveProperty(
      "value",
      "wip: keep this draft",
    );

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement({ ...model, worktreePath: "/tmp/other-worktree" }),
      );
      await flush();
    });
    expect(screen.getByTestId("agent-studio-git-commit-message-input")).toHaveProperty("value", "");
  });

  test("clears only the submitted draft after a commit", async () => {
    const results: Array<(committed: boolean) => void> = [];
    const commit = mock(
      (_mode: GitCommitMode, _message: string) =>
        new Promise<boolean>((resolve) => {
          results.push(resolve);
        }),
    );
    await act(async () => {
      render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            commit,
            fileStatuses: [{ path: "src/staged.ts", staged: true, status: "modified" }],
            fileDiffs: [toFileDiff("src/staged.ts")],
          }),
        }),
      );
      await flush();
    });
    const input = () => screen.getByTestId("agent-studio-git-commit-message-input");
    const type = async (value: string) => {
      await act(async () => {
        fireEvent.change(input(), { target: { value } });
        await flush();
      });
    };

    await type("fix: first");
    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-commit-submit-button"));
      await flush();
    });
    await type("fix: typed while the commit ran");
    await act(async () => {
      results[0]?.(true);
      await flush();
    });
    expect(input()).toHaveProperty("value", "fix: typed while the commit ran");

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-commit-submit-button"));
      await flush();
    });
    await act(async () => {
      results[1]?.(false);
      await flush();
    });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(input()).toHaveProperty("value", "fix: typed while the commit ran");
  });

  test("describes the deletion of an untracked file in the discard dialog", async () => {
    const confirmDiscard = mock(async () => {});
    const cancelDiscard = mock(() => {});
    await act(async () => {
      render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            pendingDiscard: {
              group: "unstaged",
              selection: { kind: "file", filePath: "notes/todo.txt" },
              isUntrackedFile: true,
            },
            confirmDiscard,
            cancelDiscard,
          }),
        }),
      );
      await flush();
    });

    const dialog = screen.getByTestId("agent-studio-git-discard-modal");
    expect(screen.getByRole("heading", { name: "Delete untracked file?" })).toBeDefined();
    expect(dialog.textContent).toContain(
      "This deletes the untracked file notes/todo.txt. You cannot undo this.",
    );
    const summary = screen.getByTestId("agent-studio-git-discard-summary");
    expect(Array.from(summary.querySelectorAll("dd"), (node) => node.textContent)).toEqual([
      "notes/todo.txt",
      "Unstaged",
      "Whole file",
    ]);
    const confirm = screen.getByTestId("agent-studio-git-confirm-discard-button");
    expect(confirm.textContent).toBe("Delete file");

    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(screen.getByTestId("agent-studio-git-cancel-discard-button"));
      await flush();
    });
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(cancelDiscard).toHaveBeenCalled();
  });

  test("describes a staged chunk discard in the discard dialog", async () => {
    await act(async () => {
      render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            pendingDiscard: {
              group: "staged",
              selection: { kind: "hunk", filePath: "src/a.ts", hunkIndex: 1 },
              isUntrackedFile: false,
            },
            confirmDiscard: async () => {},
            cancelDiscard: () => {},
          }),
        }),
      );
      await flush();
    });

    const dialog = screen.getByTestId("agent-studio-git-discard-modal");
    expect(screen.getByRole("heading", { name: "Discard staged changes?" })).toBeDefined();
    expect(dialog.textContent).toContain(
      "This removes the selected staged chunk of src/a.ts from the next commit and from the working file. Unrelated unstaged edits stay.",
    );
    const summary = screen.getByTestId("agent-studio-git-discard-summary");
    expect(Array.from(summary.querySelectorAll("dd"), (node) => node.textContent)).toEqual([
      "src/a.ts",
      "Staged",
      "Chunk 2",
    ]);
    expect(screen.getByTestId("agent-studio-git-confirm-discard-button").textContent).toBe(
      "Discard chunk",
    );
  });

  test("shows a refresh failure notice and spins refresh while a refresh runs", async () => {
    const model = baseModel({ refreshError: "git fetch failed.", isRefreshing: true });
    let renderer: RenderResult | null = null;
    await act(async () => {
      renderer = render(createElement(AgentStudioGitPanel, { model }));
      await flush();
    });

    expect(screen.getByTestId("agent-studio-git-refresh-error").textContent).toBe(
      "Refresh failed: git fetch failed.",
    );
    const refreshButton = screen.getByTestId("agent-studio-git-refresh-button");
    expect(refreshButton.innerHTML).toContain("animate-spin");
    expect(refreshButton.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).rerender(
        renderAgentStudioGitPanelElement({ ...model, refreshError: null, isRefreshing: false }),
      );
      await flush();
    });
    expect(screen.queryByTestId("agent-studio-git-refresh-error")).toBeNull();
    expect(screen.getByTestId("agent-studio-git-refresh-button").innerHTML).not.toContain(
      "animate-spin",
    );
    expect(screen.getByTestId("agent-studio-git-refresh-button").hasAttribute("disabled")).toBe(
      false,
    );
  });

  test("shows a failed Git change above the lists", async () => {
    await act(async () => {
      render(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            changeError: "Stage failed: the index is locked.",
          }),
        }),
      );
      await flush();
    });

    const notice = screen.getByTestId("agent-studio-git-change-error");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toBe("Stage failed: the index is locked.");
  });
});

test("disables a discard confirmation until a pending push completes", async () => {
  const confirm = mock(async () => {});
  const model = baseModel({
    pendingDiscard: {
      group: "unstaged",
      selection: { kind: "file", filePath: "src/main.ts" },
      isUntrackedFile: false,
    },
    isPushing: true,
    confirmDiscard: confirm,
    cancelDiscard: () => {},
  });
  const view = render(renderAgentStudioGitPanelElement(model));
  try {
    const button = screen.getByTestId("agent-studio-git-confirm-discard-button");
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => {
      view.rerender(renderAgentStudioGitPanelElement({ ...model, isPushing: false }));
    });
    const ready = screen.getByTestId("agent-studio-git-confirm-discard-button");
    expect(ready.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      fireEvent.click(ready);
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      view.unmount();
    });
  }
});
