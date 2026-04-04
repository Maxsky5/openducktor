import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

enableReactActEnvironment();

const omitDialogDomProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const {
    closeButton: _closeButton,
    onEscapeKeyDown: _onEscapeKeyDown,
    onPointerDownOutside: _onPointerDownOutside,
    onOpenChange: _onOpenChange,
    ...domProps
  } = props;

  return domProps;
};

const pickRepositoryDirectoryMock = mock(async (): Promise<string | null> => "/repo");
const addWorkspaceMock = mock(async (_repoPath: string): Promise<void> => {});
const selectWorkspaceMock = mock(async (_repoPath: string): Promise<void> => {});

describe("OpenRepositoryModal", () => {
  let OpenRepositoryModal: (props: {
    open: boolean;
    canClose: boolean;
    onOpenChange: () => void;
  }) => ReactNode;

  beforeEach(async () => {
    mock.module("@/lib/repo-directory", () => ({
      pickRepositoryDirectory: pickRepositoryDirectoryMock,
    }));

    const stateModule = {
      AppStateProvider: ({ children }: { children: ReactNode }) => children,
      useAgentState: () => {
        throw new Error("useAgentState is not used in this test");
      },
      useAgentOperations: () => {
        throw new Error("useAgentOperations is not used in this test");
      },
      useAgentSessions: () => {
        throw new Error("useAgentSessions is not used in this test");
      },
      useAgentSessionSummaries: () => {
        throw new Error("useAgentSessionSummaries is not used in this test");
      },
      useAgentSession: () => {
        throw new Error("useAgentSession is not used in this test");
      },
      useChecksState: () => {
        throw new Error("useChecksState is not used in this test");
      },
      useSpecState: () => {
        throw new Error("useSpecState is not used in this test");
      },
      useTasksState: () => {
        throw new Error("useTasksState is not used in this test");
      },
      useWorkspaceState: () => ({
        activeRepo: null,
        workspaces: [],
        addWorkspace: addWorkspaceMock,
        selectWorkspace: selectWorkspaceMock,
        isSwitchingWorkspace: false,
      }),
    };

    mock.module("@/state/app-state-provider", () => stateModule);

    mock.module("@/components/ui/button", () => ({
      Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("button", { type: "button", ...props }, children),
    }));

    mock.module("@/components/ui/dialog", () => ({
      Dialog: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogBody: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogDescription: ({
        children,
        ...props
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => createElement("p", omitDialogDomProps(props), children),
      DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("div", omitDialogDomProps(props), children),
      DialogTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
        createElement("h2", omitDialogDomProps(props), children),
    }));

    ({ OpenRepositoryModal } = await import("./open-repository-modal"));
  });

  afterAll(async () => {
    await restoreMockedModules([
      ["@/lib/repo-directory", () => import("@/lib/repo-directory")],
      ["@/state/app-state-provider", () => import("@/state/app-state-provider")],
      ["@/components/ui/button", () => import("@/components/ui/button")],
      ["@/components/ui/dialog", () => import("@/components/ui/dialog")],
    ]);
  });

  test("renders string host errors from repository add failures", async () => {
    pickRepositoryDirectoryMock.mockImplementation(async () => "/repo");
    addWorkspaceMock.mockImplementation(async () => {
      throw "bd not found in PATH";
    });

    const { container, unmount } = render(
      createElement(OpenRepositoryModal, {
        open: true,
        canClose: false,
        onOpenChange: () => {},
      }),
    );

    const primaryButton = container.querySelector("button");
    if (!primaryButton) {
      throw new Error("Primary button not found");
    }

    fireEvent.click(primaryButton);

    await waitFor(() => {
      expect(screen.getByText(/bd not found in path/i)).toBeTruthy();
    });

    unmount();
  });
});
