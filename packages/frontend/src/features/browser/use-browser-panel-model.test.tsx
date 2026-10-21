import { afterEach, describe, expect, test } from "bun:test";
import type { BrowserTabOwner, BrowserTabSummary } from "@openducktor/contracts";
import type { BrowserTabEventListener } from "@openducktor/frontend-core/connection/host-connection";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
} from "@/test-utils/session-panel-fixtures";
import { BrowserRuntimeProvider } from "./browser-runtime";
import { useBrowserPanelModel } from "./use-browser-panel-model";

const OWNER: BrowserTabOwner = { kind: "task", workspaceId: "workspace-1", taskId: "task-1" };
const TAB_ID = browserTabIdFixture(1);

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

/** Renders the model with host commands that the test answers. */
const renderModel = () => {
  let emit: BrowserTabEventListener = () => {};
  const opened = Promise.withResolvers<BrowserTabSummary>();
  const closed = Promise.withResolvers<void>();
  const connection = createTestClientConnection({
    host: createTestHostConnection({
      client: {
        browserTabsList: async () => ({ tabs: [] }),
        browserStateRead: async () => ({ kind: "ready", engine: "electron_webview" }),
        browserTabOpen: () => opened.promise,
        browserTabClose: () => closed.promise,
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
  const view = renderHook(() => useBrowserPanelModel(OWNER), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryProvider connection={connection}>
        <BrowserRuntimeProvider>{children}</BrowserRuntimeProvider>
      </QueryProvider>
    ),
  });
  const model = () => {
    const current = view.result.current;
    if (current === null) throw new Error("Expected a browser model.");
    return current;
  };
  return {
    model,
    opened,
    closed,
    emit: (tab: BrowserTabSummary) => emit({ type: "tab_upserted", tab }),
  };
};

describe("useBrowserPanelModel", () => {
  test("marks a tab as opening until the host lists it", async () => {
    const { model, opened, emit } = renderModel();
    await waitFor(() => expect(model().isSynced).toBe(true));

    let open!: Promise<void>;
    act(() => {
      open = model().openTab(TAB_ID, null);
    });
    expect(model().openingTabIds.has(TAB_ID)).toBe(true);

    const tab = createBrowserTabSummaryFixture({ tabId: TAB_ID, owner: OWNER });
    opened.resolve(tab);
    await act(async () => {
      emit(tab);
      await open;
    });
    expect(model().openingTabIds.has(TAB_ID)).toBe(false);
  });

  test("keeps a closing tab hidden, and shows it again when the close fails", async () => {
    const { model, closed } = renderModel();
    await waitFor(() => expect(model().isSynced).toBe(true));

    let close!: Promise<void>;
    act(() => {
      close = model().closeTab(TAB_ID);
    });
    expect(model().closingTabIds.has(TAB_ID)).toBe(true);

    closed.reject(new Error("The host is not ready."));
    await act(async () => {
      await close.catch(() => undefined);
    });
    expect(model().closingTabIds.has(TAB_ID)).toBe(false);
  });
});
