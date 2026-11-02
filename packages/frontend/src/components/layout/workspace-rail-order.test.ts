import { describe, expect, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { createWorkspaceRecordFixture } from "@/test-utils/shared-test-fixtures";
import { useWorkspaceRailOrder } from "./workspace-rail-order";

const workspaceList = (...workspaceIds: string[]): WorkspaceRecord[] =>
  workspaceIds.map((workspaceId) =>
    createWorkspaceRecordFixture({
      workspaceId,
      isActive: workspaceId === workspaceIds[0],
    }),
  );

const renderOrder = (initialWorkspaces: WorkspaceRecord[]) =>
  renderHook(
    ({ workspaces }: { workspaces: WorkspaceRecord[] }) => useWorkspaceRailOrder(workspaces),
    { initialProps: { workspaces: initialWorkspaces } },
  );

type WorkspaceRailOrderView = ReturnType<typeof renderOrder>;

const dropWorkspace = (
  view: WorkspaceRailOrderView,
  draggedWorkspaceId: string,
  overWorkspaceId: string,
): string[] | null => {
  let committedWorkspaceIds: string[] | null = null;
  act(() => {
    view.result.current.commitDropOrder(draggedWorkspaceId, overWorkspaceId, (workspaceIds) => {
      committedWorkspaceIds = workspaceIds;
    });
  });
  return committedWorkspaceIds;
};

describe("useWorkspaceRailOrder", () => {
  test("applies and commits the drop order before the workspace store updates", () => {
    const view = renderOrder(workspaceList("alpha", "beta", "gamma"));

    expect(dropWorkspace(view, "alpha", "gamma")).toEqual(["beta", "gamma", "alpha"]);
    expect(view.result.current.workspaceIds).toEqual(["beta", "gamma", "alpha"]);
  });

  test("keeps the drop order until the workspace store sends a new list", () => {
    const initialWorkspaces = workspaceList("alpha", "beta", "gamma");
    const view = renderOrder(initialWorkspaces);

    dropWorkspace(view, "alpha", "gamma");
    view.rerender({ workspaces: initialWorkspaces });
    expect(view.result.current.workspaceIds).toEqual(["beta", "gamma", "alpha"]);

    const replacement = workspaceList("alpha", "beta", "gamma").map((workspace) =>
      workspace.workspaceId === "beta"
        ? { ...workspace, workspaceName: "Beta Updated" }
        : workspace,
    );
    view.rerender({ workspaces: replacement });
    expect(view.result.current.workspaceIds).toEqual(["alpha", "beta", "gamma"]);
    expect(
      view.result.current.workspaces.find((workspace) => workspace.workspaceId === "beta")
        ?.workspaceName,
    ).toBe("Beta Updated");
  });

  test("ignores a drop on a workspace that is not in the list", () => {
    const view = renderOrder(workspaceList("alpha", "beta"));

    expect(dropWorkspace(view, "alpha", "missing")).toBeNull();
    expect(view.result.current.workspaceIds).toEqual(["alpha", "beta"]);
  });

  test("ignores a drop on the dragged workspace", () => {
    const view = renderOrder(workspaceList("alpha", "beta"));

    expect(dropWorkspace(view, "alpha", "alpha")).toBeNull();
    expect(view.result.current.workspaceIds).toEqual(["alpha", "beta"]);
  });
});
