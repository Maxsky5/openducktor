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
    branch: "feature/task-11",
    worktreePath: "/tmp/worktree",
    targetBranch: "origin/main",
    diffScope: "target",
    commitsAheadBehind: { ahead: 2, behind: 1 },
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
    commitAll: async () => {},
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
      findByTestId(root, "agent-studio-git-diff-scope-uncommitted").props.onClick();
      await flush();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setDiffScope).toHaveBeenCalledWith("uncommitted");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("enforces disabled safety states for rebase and commit controls", async () => {
    const commitAll = mock(async (_message: string) => {});

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
    const commitAll = mock(async (_message: string) => {});
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
    const targetButton = findByTestId(root, "agent-studio-git-diff-scope-target");
    const uncommittedButton = findByTestId(root, "agent-studio-git-diff-scope-uncommitted");
    expect(countByTestId(root, "agent-studio-git-commit-message-input")).toBe(0);
    expect(countByTestId(root, "agent-studio-git-commit-submit-button")).toBe(0);

    await act(async () => {
      uncommittedButton.props.onClick();
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
      targetButton.props.onClick();
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
    const commitAll = mock(async () => {});
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

  test("shows upstream behind count in pull action and blocks push while behind", async () => {
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
    expect(hasVisibleText(root, "Pull (3 behind)")).toBe(true);
    expect(hasVisibleText(root, "Pull before pushing")).toBe(true);
    expect(Boolean(findByTestId(root, "agent-studio-git-push-button").props.disabled)).toBe(true);

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
    expect(Boolean(pushButton.props.disabled)).toBe(true);
    expect(pushButton.props.className).toContain("disabled:pointer-events-auto");
    expect(pushButton.props.className).toContain("disabled:cursor-not-allowed");
    expect(hasVisibleText(root, "Commit or stash changes before pulling")).toBe(true);
    expect(hasVisibleText(root, "Commit or stash changes, then pull before pushing")).toBe(true);

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
    const fileRowButton = findButtonByText(root, "src/main.ts");

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
      findButtonByText(root, "src/main.ts").props.onClick();
      await flush();
    });

    expect(countByTestId(root, "mock-pierre-diff-viewer")).toBe(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });
});
