import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import {
  ActiveWorkspaceContext,
  type ActiveWorkspaceContextValue,
  useActiveWorkspaceContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createWorkspaceRecordFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren, type ReactElement, useMemo, useState } from "react";
import { useMobileWorkspaces, WorkspaceSelectionProvider } from "./workspace-selection";

const workspaces = [
  createWorkspaceRecordFixture({ workspaceId: "a", workspaceName: "A", repoPath: "/repos/a" }),
  createWorkspaceRecordFixture({ workspaceId: "b", workspaceName: "B", repoPath: "/repos/b" }),
];

function ActiveWorkspaceHost({ children }: PropsWithChildren): ReactElement {
  const [activeWorkspace, setActiveWorkspace] =
    useState<ActiveWorkspaceContextValue["activeWorkspace"]>(null);
  const value = useMemo(() => ({ activeWorkspace, setActiveWorkspace }), [activeWorkspace]);
  return createElement(ActiveWorkspaceContext.Provider, { value }, children);
}

describe("WorkspaceSelectionProvider", () => {
  test("makes a chosen workspace active in the first render that shows it", async () => {
    const connection = createTestClientConnection({
      client: { workspaceList: async () => workspaces },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        ClientConnectionProvider,
        { connection },
        createElement(
          ActiveWorkspaceHost,
          null,
          createElement(WorkspaceSelectionProvider, null, children),
        ),
      );
    const renders: { selected: string | null; active: string | null }[] = [];
    const { result } = renderHook(
      () => {
        const selection = useMobileWorkspaces();
        const { activeWorkspace } = useActiveWorkspaceContext();
        renders.push({
          selected: selection.selectedWorkspace?.workspaceId ?? null,
          active: activeWorkspace?.workspaceId ?? null,
        });
        return selection;
      },
      { wrapper },
    );
    await waitFor(() => expect(renders.at(-1)).toEqual({ selected: "a", active: "a" }));

    renders.length = 0;
    act(() => result.current.selectWorkspace("b"));

    expect(renders.filter((render) => render.selected === "b")).not.toHaveLength(0);
    expect(renders.filter((render) => render.selected === "b" && render.active !== "b")).toEqual(
      [],
    );
  });
});
