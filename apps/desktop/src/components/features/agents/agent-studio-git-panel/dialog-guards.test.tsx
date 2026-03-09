import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const TEST_RENDERER_DEPRECATION_WARNING = "react-test-renderer is deprecated";
const originalConsoleError = console.error;

mock.module("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => createElement("div", { "data-testid": "dialog-root", open, onOpenChange }, children),
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

type ForcePushDialogComponent = typeof import("./force-push-dialog")["ForcePushDialog"];
type RebaseConflictDialogComponent =
  typeof import("./rebase-conflict-dialog")["RebaseConflictDialog"];
type RebaseConflictActionsModel = import("./rebase-conflict-actions").RebaseConflictActionsModel;

let ForcePushDialog: ForcePushDialogComponent;
let RebaseConflictDialog: RebaseConflictDialogComponent;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const ensureRenderer = (
  renderer: TestRenderer.ReactTestRenderer | null,
): TestRenderer.ReactTestRenderer => {
  if (!renderer) {
    throw new Error("Dialog guard test renderer is not initialized");
  }

  return renderer;
};

const findByTestId = (
  root: TestRenderer.ReactTestInstance,
  testId: string,
): TestRenderer.ReactTestInstance => {
  const matches = root.findAll(
    (node) => node.props["data-testid"] === testId && typeof node.type === "string",
  );

  if (matches.length !== 1) {
    throw new Error(`Expected one host node for data-testid=${testId}, got ${matches.length}`);
  }

  const match = matches[0];
  if (!match) {
    throw new Error(`Missing host node for data-testid=${testId}`);
  }

  return match;
};

describe("Git panel dialog guards", () => {
  beforeEach(async () => {
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].includes(TEST_RENDERER_DEPRECATION_WARNING)) {
        return;
      }
      originalConsoleError(...args);
    };

    ({ ForcePushDialog } = await import("./force-push-dialog"));
    ({ RebaseConflictDialog } = await import("./rebase-conflict-dialog"));
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("keeps the force-push dialog open while a push is in flight", async () => {
    const cancel = mock(() => {});
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(ForcePushDialog, {
          pendingForcePush: {
            remote: "origin",
            branch: "feature/task-11",
            output: "non-fast-forward",
          },
          isPushing: true,
          onCancel: cancel,
          onConfirm: () => {},
        }),
      );
      await flush();
    });

    const dialogRoot = findByTestId(ensureRenderer(renderer).root, "dialog-root");
    dialogRoot.props.onOpenChange(false);

    expect(cancel).toHaveBeenCalledTimes(0);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("blocks implicit rebase-conflict dialog dismissal while an action is in flight", async () => {
    const onOpenChange = mock((_open: boolean) => {});
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    const actions: RebaseConflictActionsModel = {
      isDisabled: true,
      abort: {
        isPending: true,
        label: "Aborting...",
        onClick: () => {},
      },
      askBuilder: {
        isPending: false,
        label: "Ask Builder to resolve",
        onClick: () => {},
      },
    };

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(RebaseConflictDialog, {
          conflict: {
            operation: "rebase",
            currentBranch: "feature/task-11",
            targetBranch: "origin/main",
            conflictedFiles: ["AGENTS.md"],
            output: "CONFLICT (content): Merge conflict in AGENTS.md",
            workingDir: "/tmp/worktree",
          },
          open: true,
          onOpenChange,
          actions,
        }),
      );
      await flush();
    });

    const root = ensureRenderer(renderer).root;
    const dialogRoot = findByTestId(root, "dialog-root");
    dialogRoot.props.onOpenChange(false);

    expect(onOpenChange).toHaveBeenCalledTimes(0);

    const codeNodes = root.findAll((node) => node.type === "code");
    expect(codeNodes.length).toBe(1);
    expect(codeNodes[0]?.children.join("")).toBe("origin/main");

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });
});
