import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

const selectWorkspaceMock = mock(async (_workspaceId: string): Promise<void> => {});
const reorderWorkspacesMock = mock(async (_workspaceIds: string[]): Promise<void> => {});

type WorkspaceStateMock = {
  workspaces: WorkspaceRecord[];
  selectWorkspace: typeof selectWorkspaceMock;
  reorderWorkspaces: typeof reorderWorkspacesMock;
  isSwitchingWorkspace: boolean;
};

const workspaceRecord = (
  workspaceId: string,
  options: Partial<WorkspaceRecord> = {},
): WorkspaceRecord => ({
  workspaceId,
  workspaceName: options.workspaceName ?? workspaceId.toUpperCase(),
  repoPath: options.repoPath ?? `/${workspaceId}`,
  iconDataUrl: options.iconDataUrl,
  isActive: options.isActive ?? false,
  hasConfig: options.hasConfig ?? true,
  configuredWorktreeBasePath: options.configuredWorktreeBasePath ?? null,
  defaultWorktreeBasePath: options.defaultWorktreeBasePath ?? null,
  effectiveWorktreeBasePath: options.effectiveWorktreeBasePath ?? null,
});

let workspaceState: WorkspaceStateMock;
let WorkspaceRail: typeof import("./workspace-rail").WorkspaceRail;

const setElementRect = (element: HTMLElement, rect: Omit<DOMRect, "toJSON">): void => {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      toJSON: () => ({}),
    }),
  });
};

const dragWithMouse = async (
  element: HTMLElement,
  start: { clientX: number; clientY: number },
  moves: Array<{ clientX: number; clientY: number }>,
): Promise<void> => {
  await act(async () => {
    fireEvent.mouseDown(element, {
      button: 0,
      buttons: 1,
      ...start,
    });

    for (const move of moves) {
      fireEvent.mouseMove(document, {
        buttons: 1,
        ...move,
      });
    }
  });
};

const finishMouseDrag = async (position: { clientX: number; clientY: number }): Promise<void> => {
  await act(async () => {
    fireEvent.mouseUp(document, {
      button: 0,
      ...position,
    });
  });
};

const withMouseSensorFallback = async (run: () => Promise<void>): Promise<void> => {
  const originalPointerEvent = globalThis.PointerEvent;
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: undefined,
  });

  try {
    await run();
  } finally {
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      value: originalPointerEvent,
    });
  }
};

describe("WorkspaceRail", () => {
  beforeEach(async () => {
    workspaceState = {
      workspaces: [],
      selectWorkspace: selectWorkspaceMock,
      reorderWorkspaces: reorderWorkspacesMock,
      isSwitchingWorkspace: false,
    };
    selectWorkspaceMock.mockClear();
    reorderWorkspacesMock.mockClear();

    mock.module("@/state", () => ({
      useWorkspaceState: () => workspaceState,
    }));

    ({ WorkspaceRail } = await import("./workspace-rail"));
  });

  afterEach(async () => {
    await restoreMockedModules([["@/state", () => import("@/state")]]);
  });

  test("renders icon and initials variants with hidden-scrollbar overflow", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        iconDataUrl: "data:image/png;base64,AAAA",
        isActive: true,
      }),
      workspaceRecord("open-ducktor", {
        workspaceName: "Open Ducktor",
      }),
    ];

    const html = renderToStaticMarkup(<WorkspaceRail onOpenRepositoryModal={() => {}} />);

    expect(html).toContain("hide-scrollbar");
    expect(html).toContain('aria-label="Alpha Repo"');
    expect(html).toContain('aria-label="Open Ducktor"');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain(">OD<");
  });

  test("switches inactive workspaces and exposes the open-repository button", async () => {
    const openRepositoryModal = mock(() => {});
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        isActive: true,
      }),
      workspaceRecord("beta", {
        workspaceName: "Beta Repo",
      }),
    ];

    render(<WorkspaceRail onOpenRepositoryModal={openRepositoryModal} />);

    fireEvent.click(screen.getByRole("button", { name: "Beta Repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Alpha Repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));

    expect(selectWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(selectWorkspaceMock).toHaveBeenCalledWith("beta");
    expect(openRepositoryModal).toHaveBeenCalledTimes(1);
  });

  test("reorders workspaces vertically without making a duplicate switch", async () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo", isActive: true }),
      workspaceRecord("beta", { workspaceName: "Beta Repo" }),
    ];

    await withMouseSensorFallback(async () => {
      render(<WorkspaceRail onOpenRepositoryModal={() => {}} />);

      const alphaButton = screen.getByRole("button", { name: "Alpha Repo" });
      const betaButton = screen.getByRole("button", { name: "Beta Repo" });
      const alphaShell = alphaButton.parentElement;
      const betaShell = betaButton.parentElement;
      if (!alphaShell || !betaShell) {
        throw new Error("Workspace drag shell not found");
      }

      setElementRect(alphaShell, {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 40,
        bottom: 40,
        width: 40,
        height: 40,
      });
      setElementRect(betaShell, {
        x: 0,
        y: 48,
        left: 0,
        top: 48,
        right: 40,
        bottom: 88,
        width: 40,
        height: 40,
      });

      await dragWithMouse(betaShell, { clientX: 20, clientY: 68 }, [
        { clientX: 20, clientY: 48 },
        { clientX: 20, clientY: 16 },
      ]);
      await finishMouseDrag({ clientX: 20, clientY: 16 });

      expect(reorderWorkspacesMock).toHaveBeenCalledWith(["beta", "alpha"]);
      expect(selectWorkspaceMock).not.toHaveBeenCalled();
    });
  });
});
