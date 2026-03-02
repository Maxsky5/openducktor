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

mock.module("@/components/ui/tooltip", async () => {
  const React = await import("react");
  return {
    TooltipProvider: ({ children }: { children: React.ReactNode }) =>
      createElement(React.Fragment, null, children),
    Tooltip: ({ children }: { children: React.ReactNode }) =>
      createElement(React.Fragment, null, children),
    TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
      createElement(React.Fragment, null, children),
    TooltipContent: ({ children }: { children: React.ReactNode }) =>
      createElement("div", null, children),
  };
});

type AgentStudioGitPanelComponent =
  typeof import("./agent-studio-git-panel")["AgentStudioGitPanel"];
type AgentStudioGitPanelModel = import("./agent-studio-git-panel").AgentStudioGitPanelModel;

let AgentStudioGitPanel: AgentStudioGitPanelComponent;

const baseModel = (
  overrides: Partial<AgentStudioGitPanelModel> = {},
): AgentStudioGitPanelModel => ({
  branch: "feature/task-11",
  worktreePath: "/tmp/worktree",
  targetBranch: "origin/main",
  diffScope: "target",
  commitsAheadBehind: { ahead: 2, behind: 1 },
  fileDiffs: [],
  fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
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
  ...overrides,
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const findByTestId = (
  root: TestRenderer.ReactTestInstance,
  testId: string,
): TestRenderer.ReactTestInstance => {
  return root.find((node) => node.props["data-testid"] === testId);
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
    expect(findByTestId(root, "agent-studio-git-push-button")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-commit-message-input")).toBeTruthy();
    expect(findByTestId(root, "agent-studio-git-commit-submit-button")).toBeTruthy();

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
    const messageInput = findByTestId(root, "agent-studio-git-commit-message-input");
    const submitButton = findByTestId(root, "agent-studio-git-commit-submit-button");

    expect(Boolean(submitButton.props.disabled)).toBe(true);

    await act(async () => {
      uncommittedButton.props.onClick();
      await flush();
    });
    expect(setDiffScope).toHaveBeenCalledWith("uncommitted");
    expect(Boolean(targetButton.props.disabled)).toBe(false);

    await act(async () => {
      targetButton.props.onClick();
      await flush();
    });
    expect(setDiffScope).toHaveBeenCalledTimes(1);
    expect(setDiffScope).toHaveBeenCalledWith("uncommitted");

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

  test("disables commit/push/rebase controls during detached branch and action in-flight", async () => {
    const commitAll = mock(async () => {});
    const pushBranch = mock(async () => {});
    const rebaseOntoTarget = mock(async () => {});

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            branch: null,
            commitAll,
            pushBranch,
            rebaseOntoTarget,
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
    const pushButton = findByTestId(root, "agent-studio-git-push-button");

    expect(Boolean(rebaseButton.props.disabled)).toBe(true);
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
            fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
            isCommitting: true,
            commitAll,
            pushBranch,
            rebaseOntoTarget,
          }),
        }),
      );
      await flush();
    });

    expect(Boolean(commitInput.props.disabled)).toBe(true);
    expect(Boolean(commitSubmit.props.disabled)).toBe(true);
    expect(Boolean(rebaseButton.props.disabled)).toBe(true);
    expect(Boolean(pushButton.props.disabled)).toBe(true);
    expect(Boolean(refreshButton.props.disabled)).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).update(
        createElement(AgentStudioGitPanel, {
          model: baseModel({
            branch: null,
            fileStatuses: [{ path: "src/a.ts", staged: false, status: "M" }],
            isCommitting: true,
            isPushing: true,
            isRebasing: true,
            commitAll,
            pushBranch,
            rebaseOntoTarget,
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
});
