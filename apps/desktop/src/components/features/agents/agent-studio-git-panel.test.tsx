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

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(AgentStudioGitPanel, { model: baseModel({ refresh, setDiffScope }) }),
      );
      await flush();
    });

    const root = renderer!.root;
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
      renderer!.unmount();
      await flush();
    });
  });

  test("enforces disabled safety states for rebase and commit controls", async () => {
    const commitAll = mock(async (_message: string) => {});

    let renderer: TestRenderer.ReactTestRenderer;
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

    const root = renderer!.root;
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
      renderer!.update(
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
      renderer!.update(
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
      findByTestId(root, "agent-studio-git-commit-submit-button").props.onClick();
      await flush();
    });
    expect(commitAll).toHaveBeenCalledWith("feat: commit all files");

    await act(async () => {
      renderer!.unmount();
      await flush();
    });
  });
});
