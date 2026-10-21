import { afterEach, describe, expect, test } from "bun:test";
import type { BrowserHostEvent, BrowserTabSummary } from "@openducktor/contracts";
import type { BrowserTabEventListener } from "@openducktor/frontend-core/connection/host-connection";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { toBrowserAnnotationOwnerKey } from "@/features/browser-annotations";
import { browserAnnotationStoreOf } from "@/features/browser-annotations/browser-annotation-store";
import { buildCapture } from "@/features/browser-annotations/browser-annotation-test-support";
import {
  type SessionPanelLayoutStore,
  type SessionPanelOwner,
  useSessionPanelLayoutStore,
} from "@/features/session-panels";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { WorkspacePresenceContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
} from "@/test-utils/session-panel-fixtures";
import {
  createWorkspacePresenceFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { browserRecentPagesOf } from "./browser-recent-pages";
import { BrowserRuntimeProvider } from "./browser-runtime";
import { BrowserTabCoordinator } from "./browser-tab-coordinator";

const TASK: SessionPanelOwner = { kind: "task", workspaceId: "workspace-1", taskId: "task-1" };
const TAB_ID = browserTabIdFixture(1);

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

/** Renders the coordinator on an Electron shell, with host browser events that the test sends. */
const renderCoordinator = async () => {
  let emit: BrowserTabEventListener = () => {};
  const connection = createTestClientConnection({
    host: createTestHostConnection({
      client: {
        browserTabsList: async () => ({ tabs: [] }),
        browserStateRead: async () => ({ kind: "ready", engine: "electron_webview" }),
        systemGetPlatform: async () => "darwin",
      },
      subscribeBrowserTabEvents: async (listener) => {
        emit = listener;
        return () => {};
      },
    }),
  });
  configureShellBridge(
    createShellBridgeFixture({
      bridge: {
        browser: {
          surface: "webview",
          connect: async () => ({ send: async () => {}, close: () => {} }),
          partition: (workspaceId) => `persist:openducktor-browser-${workspaceId}`,
          bindGuest: async () => {},
          pickFiles: async () => [],
        },
      },
    }),
  );
  let layouts: SessionPanelLayoutStore | null = null;
  function LayoutProbe(): ReactElement | null {
    layouts = useSessionPanelLayoutStore();
    return null;
  }
  render(
    <QueryProvider connection={connection}>
      <WorkspaceStateContext.Provider value={createWorkspaceStateFixture()}>
        <WorkspacePresenceContext.Provider value={createWorkspacePresenceFixture()}>
          <BrowserRuntimeProvider>
            <BrowserTabCoordinator />
            <LayoutProbe />
          </BrowserRuntimeProvider>
        </WorkspacePresenceContext.Provider>
      </WorkspaceStateContext.Provider>
    </QueryProvider>,
  );
  await waitFor(() => expect(layouts).not.toBeNull());
  const layoutStore = (): SessionPanelLayoutStore => {
    if (layouts === null) throw new Error("The layout store did not render.");
    return layouts;
  };
  const send = (event: BrowserHostEvent) => act(() => void emit(event));
  return { connection, layoutStore, send };
};

const rightEntryIds = (store: SessionPanelLayoutStore): string[] =>
  store.read(TASK).panels.right.map((entry) => entry.id);

const upserted = (tab: BrowserTabSummary): BrowserHostEvent => ({ type: "tab_upserted", tab });

describe("BrowserTabCoordinator", () => {
  test("places a new agent tab at the end of the right panel and removes a closed tab", async () => {
    const { layoutStore, send } = await renderCoordinator();

    send(upserted(createBrowserTabSummaryFixture({ tabId: TAB_ID, createdBy: "agent" })));
    await waitFor(() => expect(rightEntryIds(layoutStore())).toContain(`browser:${TAB_ID}`));
    expect(layoutStore().read(TASK).selectedRight.build).toBe(`browser:${TAB_ID}`);

    send({ type: "tab_closed", tabId: TAB_ID, owner: TASK });
    await waitFor(() => expect(rightEntryIds(layoutStore())).not.toContain(`browser:${TAB_ID}`));
  });

  test("records the loaded page of a user tab in the recent pages of its workspace", async () => {
    const { connection, send } = await renderCoordinator();

    send(
      upserted(createBrowserTabSummaryFixture({ tabId: TAB_ID, url: "http://localhost:5173/" })),
    );

    await waitFor(() =>
      expect(
        browserRecentPagesOf(connection)
          .read("workspace-1")
          .map((page) => page.url),
      ).toEqual(["http://localhost:5173/"]),
    );
  });

  test("removes the pending annotations of an owner whose layout a prune removed", async () => {
    const { connection, layoutStore } = await renderCoordinator();
    const annotations = browserAnnotationStoreOf(connection);
    const ownerKey = toBrowserAnnotationOwnerKey(TASK);
    if (ownerKey === null) throw new Error("Expected an annotation owner key.");
    annotations.getState().addAnnotation(ownerKey, {
      capture: buildCapture(),
      comment: "Fix the header",
      includeScreenshot: false,
    });
    act(() =>
      layoutStore().update(TASK, (layout) => ({
        ...layout,
        panels: { ...layout.panels, right: [{ id: "files", kind: "files" }] },
      })),
    );

    act(() => layoutStore().prune({ kind: "tasks", workspaceId: "workspace-1", ids: new Set() }));

    expect(annotations.getState().getPendingAnnotations(ownerKey)).toEqual([]);
  });
});
