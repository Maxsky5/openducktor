import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const TEST_RENDERER_DEPRECATION_WARNING = "react-test-renderer is deprecated";
const originalConsoleError = console.error;

mock.module("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
  Tooltip: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
}));

mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open === false ? null : createElement("div", null, children),
  DialogContent: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
    createElement("div", props, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
}));

mock.module("@/components/features/agents/pierre-diff-viewer", () => ({
  PierreDiffPreloader: () => null,
  PierreDiffViewer: () => createElement("div", { "data-testid": "mock-pierre-diff-viewer" }),
}));

type AgentStudioGitPanelComponent =
  typeof import("./agent-studio-git-panel")["AgentStudioGitPanel"];
type AgentStudioGitPanelModel = import("./agent-studio-git-panel").AgentStudioGitPanelModel;

let AgentStudioGitPanel: AgentStudioGitPanelComponent;

const baseModel = (overrides: Partial<AgentStudioGitPanelModel> = {}): AgentStudioGitPanelModel => {
  const model: AgentStudioGitPanelModel = {
    contextMode: "worktree",
    branch: "feature/task-11",
    worktreePath: "/tmp/worktree",
    targetBranch: "origin/main",
    diffScope: "target",
    commitsAheadBehind: { ahead: 2, behind: 1 },
    upstreamAheadBehind: { ahead: 1, behind: 0 },
    upstreamStatus: "tracking",
    fileDiffs: [],
    fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
    uncommittedFileCount: 1,
    isLoading: false,
    error: null,
    refresh: () => {},
    selectedFile: null,
    setSelectedFile: () => {},
    setDiffScope: () => {},
    isCommitting: false,
    isPushing: false,
    isRebasing: false,
    commitError: null,
    pushError: null,
    rebaseError: null,
    commitAll: async () => true,
    pushBranch: async () => {},
    rebaseOntoTarget: async () => {},
    pullFromUpstream: async () => {},
    ...overrides,
  };

  if (overrides.uncommittedFileCount === undefined) {
    model.uncommittedFileCount = model.fileStatuses.length;
  }

  return model;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const findByTestId = (
  root: TestRenderer.ReactTestInstance,
  testId: string,
): TestRenderer.ReactTestInstance => {
  const matches = root.findAll(
    (node) => node.props["data-testid"] === testId && typeof node.type === "string",
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one host element for data-testid=${testId}, got ${matches.length}`,
    );
  }
  const match = matches[0];
  if (!match) {
    throw new Error(`Missing host element for data-testid=${testId}`);
  }
  return match;
};

const countByTestId = (root: TestRenderer.ReactTestInstance, testId: string): number =>
  root.findAll((node) => node.props["data-testid"] === testId && typeof node.type === "string")
    .length;

const findDiffScopeTabs = (
  root: TestRenderer.ReactTestInstance,
  value: "target" | "uncommitted",
): TestRenderer.ReactTestInstance => {
  const matches = root.findAll(
    (node) => node.props["data-slot"] === "tabs" && node.props.value === value,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one diff scope tabs root for value=${value}, got ${matches.length}`,
    );
  }
  const match = matches[0];
  if (!match) {
    throw new Error(`Missing diff scope tabs root for value=${value}`);
  }
  return match;
};

const ensureRenderer = (
  renderer: TestRenderer.ReactTestRenderer | null,
): TestRenderer.ReactTestRenderer => {
  if (!renderer) {
    throw new Error("AgentStudioGitPanel renderer is not initialized");
  }
  return renderer;
};

const getRoot = (
  renderer: TestRenderer.ReactTestRenderer | null,
): TestRenderer.ReactTestInstance => {
  return ensureRenderer(renderer).root;
};

const hasVisibleText = (root: TestRenderer.ReactTestInstance, text: string): boolean => {
  return (
    root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.children.some((child) => typeof child === "string" && child.includes(text)),
    ).length > 0
  );
};

const getNodeText = (node: TestRenderer.ReactTestInstance): string => {
  return (node.children as unknown[])
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (child != null && typeof child === "object" && "children" in child) {
        return getNodeText(child as TestRenderer.ReactTestInstance);
      }
      return "";
    })
    .join("");
};

const findButtonByText = (
  root: TestRenderer.ReactTestInstance,
  text: string,
): TestRenderer.ReactTestInstance => {
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
  beforeAll(async () => {
    ({ AgentStudioGitPanel } = await import("./agent-studio-git-panel"));
  });

  beforeEach(() => {
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].includes(TEST_RENDERER_DEPRECATION_WARNING)) {
        return;
      }
      originalConsoleError(...args);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("renders branch context labels and git action controls", async () => {
    const refresh = mock(() => {});
    const setDiffScope = mock((_scope: "target" | "uncommitted") => {});
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, { model: baseModel({ refresh, setDiffScope }) }),
      );
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
    expect(targetAheadCount.props.className).toContain("text-emerald-600");
    expect(targetAheadCount.props.className).toContain("dark:text-emerald-400");
    expect(countByTestId(root, "agent-studio-git-commit-message-input")).toBe(0);
    expect(countByTestId(root, "agent-studio-git-commit-submit-button")).toBe(0);
    expect(
      findByTestId(root, "agent-studio-git-diff-scope-uncommitted").children.join(""),
    ).toContain("Uncommitted changes");
    expect(findByTestId(root, "agent-studio-git-diff-scope-target").children.join("")).toContain(
      "Compare to target",
    );
    expect(hasVisibleText(root, "/tmp/worktree")).toBe(false);

    await act(async () => {
      findByTestId(root, "agent-studio-git-refresh-button").props.onClick();
      findDiffScopeTabs(root, "target").props.onValueChange("uncommitted");
      await flush();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setDiffScope).toHaveBeenCalledWith("uncommitted");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("renders a pull request link badge when the selected task has a linked PR", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
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
    expect(prLinks.length).toBe(1);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("renders and triggers the detect PR button when the action is available", async () => {
    const onDetectPullRequest = mock(async () => {});
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
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
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(createElement(AgentStudioGitPanel, { model: baseModel() }));
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
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
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

  test("renders repository mode without target branch or rebase action", async () => {
    const refresh = mock(() => {});
    const setDiffScope = mock((_scope: "target" | "uncommitted") => {});
    const commitAll = mock(async (_message: string) => true);
    const pushBranch = mock(async () => {});
    const pullFromUpstream = mock(async () => {});
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            contextMode: "repository",
            diffScope: "uncommitted",
            refresh,
            setDiffScope,
            commitAll,
            pushBranch,
            pullFromUpstream,
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(hasVisibleText(root, "Repository context")).toBe(true);
    expect(hasVisibleText(root, "Repository branch")).toBe(true);
    expect(countByTestId(root, "agent-studio-git-target-branch")).toBe(0);
    expect(countByTestId(root, "agent-studio-git-target-ahead-count")).toBe(0);
    expect(countByTestId(root, "agent-studio-git-rebase-button")).toBe(0);
    expect(findByTestId(root, "agent-studio-git-pull-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-push-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-commit-message-input")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-diff-scope-target").children.join("")).toContain(
      "Compare to upstream",
    );

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows a clear no-upstream message in repository compare mode", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
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
    expect(hasVisibleText(root, "No upstream branch yet")).toBe(true);
    expect(
      hasVisibleText(
        root,
        "This branch is not tracking an upstream branch yet. Push it first to create one, then compare against it here.",
      ),
    ).toBe(true);
    expect(Boolean(findByTestId(root, "agent-studio-git-pull-button").props.disabled)).toBe(true);
    expect(Boolean(findByTestId(root, "agent-studio-git-push-button").props.disabled)).toBe(false);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("enforces disabled safety states for rebase and commit controls", async () => {
    const commitAll = mock(async (_message: string) => true);

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            branch: null,
            diffScope: "uncommitted",
            fileStatuses: [],
            commitAll,
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
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
            isPushing: true,
            diffScope: "uncommitted",
            commitAll,
          }),
        }),
      );
      await flush();
    });
    expect(Boolean(findByTestId(root, "agent-studio-git-rebase-button").props.disabled)).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
            diffScope: "uncommitted",
            commitAll,
          }),
        }),
      );
      findByTestId(root, "agent-studio-git-commit-message-input").props.onChange({
        currentTarget: { value: "feat: commit all files" },
      });
      await flush();
    });
    expect(
      Boolean(findByTestId(root, "agent-studio-git-commit-submit-button").props.disabled),
    ).toBe(false);

    await act(async () => {
      await findByTestId(root, "agent-studio-git-commit-submit-button").props.onClick();
      await flush();
    });
    expect(commitAll).toHaveBeenCalledWith("feat: commit all files");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("switches diff scope and validates commit-all message input", async () => {
    const setDiffScope = mock((_scope: "target" | "uncommitted") => {});
    const commitAll = mock(async (_message: string) => true);
    const refresh = mock(() => {});

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "target",
            setDiffScope,
            commitAll,
            refresh,
            fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
            commitError: "",
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    expect(countByTestId(root, "agent-studio-git-commit-message-input")).toBe(0);
    expect(countByTestId(root, "agent-studio-git-commit-submit-button")).toBe(0);

    await act(async () => {
      findDiffScopeTabs(root, "target").props.onValueChange("uncommitted");
      await flush();
    });
    expect(setDiffScope).toHaveBeenCalledTimes(1);
    expect(setDiffScope).toHaveBeenCalledWith("uncommitted");

    await act(async () => {
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            setDiffScope,
            commitAll,
            refresh,
            fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
            commitError: "",
          }),
        }),
      );
      await flush();
    });

    const messageInput = findByTestId(root, "agent-studio-git-commit-message-input");
    const submitButton = findByTestId(root, "agent-studio-git-commit-submit-button");

    expect(Boolean(submitButton.props.disabled)).toBe(true);

    await act(async () => {
      findDiffScopeTabs(root, "uncommitted").props.onValueChange("target");
      await flush();
    });
    expect(setDiffScope).toHaveBeenCalledTimes(2);
    expect(setDiffScope).toHaveBeenLastCalledWith("target");

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
    expect(commitAll).toHaveBeenCalledWith("  chore: tidy git flow  ");
    const commitInputAfterSubmit = findByTestId(root, "agent-studio-git-commit-message-input");
    expect(commitInputAfterSubmit.props.value).toBe("");
    expect(
      Boolean(findByTestId(root, "agent-studio-git-commit-submit-button").props.disabled),
    ).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("notifies selected-file changes when a diff entry is expanded or collapsed", async () => {
    const setSelectedFile = mock((_path: string | null) => {});
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
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
            setSelectedFile,
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
    expect(setSelectedFile).toHaveBeenNthCalledWith(1, "src/a.ts");

    await act(async () => {
      diffButton.props.onClick();
      await flush();
    });
    expect(setSelectedFile).toHaveBeenNthCalledWith(2, null);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("handles rapid consecutive file toggles without stale expansion state", async () => {
    const setSelectedFile = mock((_path: string | null) => {});
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
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
            setSelectedFile,
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

    expect(setSelectedFile).toHaveBeenNthCalledWith(1, "src/a.ts");
    expect(setSelectedFile).toHaveBeenNthCalledWith(2, null);
    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("disables commit/push/rebase controls during detached branch and action in-flight", async () => {
    const commitAll = mock(async () => true);
    const pushBranch = mock(async () => {});
    const rebaseOntoTarget = mock(async () => {});
    const pullFromUpstream = mock(async () => {});

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            branch: null,
            diffScope: "uncommitted",
            commitAll,
            pushBranch,
            rebaseOntoTarget,
            pullFromUpstream,
            fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
          }),
        }),
      );
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
    expect(Boolean(Boolean(refreshButton.props.disabled))).toBe(false);

    await act(async () => {
      commitInput.props.onChange({ currentTarget: { value: "fix: handle detached head" } });
      await flush();
    });
    await act(async () => {
      commitSubmit.props.onClick();
      await flush();
    });
    expect(commitAll).toHaveBeenCalledWith("fix: handle detached head");

    await act(async () => {
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            branch: null,
            diffScope: "uncommitted",
            fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
            isCommitting: true,
            commitAll,
            pushBranch,
            rebaseOntoTarget,
            pullFromUpstream,
          }),
        }),
      );
      await flush();
    });

    expect(Boolean(commitInput.props.disabled)).toBe(true);
    expect(Boolean(commitSubmit.props.disabled)).toBe(true);
    expect(Boolean(rebaseButton.props.disabled)).toBe(true);
    expect(Boolean(pullButton.props.disabled)).toBe(true);
    expect(Boolean(pushButton.props.disabled)).toBe(true);
    expect(Boolean(refreshButton.props.disabled)).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            branch: null,
            diffScope: "uncommitted",
            fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
            isCommitting: true,
            isPushing: true,
            isRebasing: true,
            commitAll,
            pushBranch,
            rebaseOntoTarget,
            pullFromUpstream,
          }),
        }),
      );
      await flush();
    });

    expect(Boolean(refreshButton.props.disabled)).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows upstream behind count and keeps normal push available", async () => {
    const pushBranch = mock(async () => {});
    const pullFromUpstream = mock(async () => {});

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
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

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
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

  test("hides the generic lock banner when the conflict strip is already visible", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            isGitActionsLocked: true,
            gitActionsLockReason: "Git actions are disabled while the Builder session is working.",
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
    expect(String(conflictCountBadge.props.className)).toContain("amber");
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
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
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
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
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
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
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

  test("auto-opens the conflict modal only when the controller emits a fresh conflict-open signal", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(AgentStudioGitPanel, { model: baseModel() }));
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
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, { model: persistedConflictModel }),
      );
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
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, { model: actionConflictModel }),
      );
      await flush();
    });

    expect(findByTestId(root, "agent-studio-git-conflict-modal")).toBeTruthy();

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows abort loading state and disables both conflict actions while abort is pending", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(AgentStudioGitPanel, { model: baseModel() }));
      await flush();
    });

    const abortPendingModel = baseModel({
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
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, { model: abortPendingModel }),
      );
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
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(AgentStudioGitPanel, { model: baseModel() }));
      await flush();
    });

    const askBuilderPendingModel = baseModel({
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
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, { model: askBuilderPendingModel }),
      );
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
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(createElement(AgentStudioGitPanel, { model: baseModel() }));
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
      ensureRenderer(renderer).update(createElement(AgentStudioGitPanel, { model: conflictModel }));
      await flush();
    });

    const root = getRoot(renderer);
    expect(findByTestId(root, "agent-studio-git-conflict-modal")).toBeTruthy();

    await act(async () => {
      findByTestId(root, "agent-studio-git-ask-builder-conflict-button").props.onClick();
      await flush();
    });

    expect(askBuilder).toHaveBeenCalledTimes(1);
    expect(countByTestId(getRoot(renderer), "agent-studio-git-conflict-modal")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("marks conflicted files in the uncommitted changes list", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            fileDiffs: [
              {
                file: "AGENTS.md",
                type: "modified",
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
              {
                file: "README.md",
                type: "modified",
                additions: 1,
                deletions: 0,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
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
    expect(countByTestId(root, "agent-studio-git-file-conflict-indicator")).toBe(1);
    expect(countByTestId(root, "agent-studio-git-file-conflict-slot")).toBe(1);
    expect(getNodeText(findButtonByText(root, "AGENTS.md"))).not.toContain("M");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("renders expanded file diff rows and mounts mocked diff viewer", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
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

    const rootText = getNodeText(root);
    expect(rootText).toContain("1 changed file");
    expect(rootText).toContain("+1");
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

    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows basename-first file paths with the full path in the tooltip", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            diffScope: "uncommitted",
            fileDiffs: [
              {
                file: "apps/desktop/src/components/features/agents/agent-studio-git-panel/file-diff-entry.tsx",
                type: "modified",
                additions: 3,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
            fileStatuses: [
              {
                path: "apps/desktop/src/components/features/agents/agent-studio-git-panel/file-diff-entry.tsx",
                staged: false,
                status: "modified",
              },
            ],
          }),
        }),
      );
      await flush();
    });

    const root = getRoot(renderer);
    const headerNode = findByTestId(root, "agent-studio-git-list-header");
    const pathNode = findByTestId(root, "agent-studio-git-file-path");

    expect(headerNode.props.className).toContain("flex-wrap");
    expect(headerNode.props.className).toContain("min-w-0");
    expect(pathNode.props.title).toBe(
      "apps/desktop/src/components/features/agents/agent-studio-git-panel/file-diff-entry.tsx",
    );
    expect(pathNode.props.className).toContain("flex-col");
    expect(pathNode.props.className).toContain("overflow-hidden");
    expect(getNodeText(pathNode)).toContain("file-diff-entry.tsx");
    expect(getNodeText(pathNode)).toContain(
      "apps/desktop/src/components/features/agents/agent-studio-git-panel",
    );

    const fileNameNode = pathNode.findAll(
      (node) => typeof node.type === "string" && node.children.includes("file-diff-entry.tsx"),
    )[0];
    const dirNameNode = pathNode.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.children.includes(
          "apps/desktop/src/components/features/agents/agent-studio-git-panel",
        ),
    )[0];

    expect(fileNameNode?.props.className).toContain("block truncate");
    expect(dirNameNode?.props.className).toContain("block truncate");

    const statsNode = findByTestId(root, "agent-studio-git-file-stats");
    expect(statsNode.props.className).toContain("min-w-[4.75rem]");
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
});
