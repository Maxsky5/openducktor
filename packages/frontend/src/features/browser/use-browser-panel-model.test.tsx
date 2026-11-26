import { describe, expect, test } from "bun:test";
import type { BrowserTabOwner, BrowserTabSummary } from "@openducktor/contracts";
import type { BrowserTabEventListener } from "@openducktor/frontend-core/connection/host-connection";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createShellBridgeFixture, withShellPlatform } from "@/test-utils/focused-fixture";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
} from "@/test-utils/session-panel-fixtures";
import { BrowserRuntimeProvider } from "./browser-runtime";
import { useBrowserPanelModel } from "./use-browser-panel-model";

const OWNER: BrowserTabOwner = { kind: "task", workspaceId: "workspace-1", taskId: "task-1" };
const TAB_ID = browserTabIdFixture(1);

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
  const shellPlatform = createShellBridgeFixture({
    bridge: {
      browser: {
        surface: "electron",
        connect: async () => ({ send: async () => {}, close: () => {} }),
        setSurface: async () => {},
        focusPage: async () => {},
        capturePage: async () => "data:image/png;base64,",
        pickFiles: async () => [],
      },
    },
  });
  // Two views of one task, as with kept role views.
  const view = renderHook(() => [useBrowserPanelModel(OWNER), useBrowserPanelModel(OWNER)], {
    wrapper: ({ children }: { children: ReactNode }) =>
      withShellPlatform(
        <QueryProvider connection={connection}>
          <BrowserRuntimeProvider>{children}</BrowserRuntimeProvider>
        </QueryProvider>,
        shellPlatform,
      ),
  });
  const modelAt = (index: 0 | 1) => {
    const current = view.result.current[index];
    if (!current) throw new Error("Expected a browser model.");
    return current;
  };
  return {
    model: () => modelAt(0),
    otherView: () => modelAt(1),
    opened,
    closed,
    emit: (tab: BrowserTabSummary) => emit({ type: "tab_upserted", tab }),
    emitClosed: (tabId: string) => emit({ type: "tab_closed", tabId, owner: OWNER }),
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

  test("hides a closing tab in every view, until the host list removes it", async () => {
    const { model, otherView, closed, emit, emitClosed } = renderModel();
    await waitFor(() => expect(model().isSynced).toBe(true));
    act(() => emit(createBrowserTabSummaryFixture({ tabId: TAB_ID, owner: OWNER })));

    let close!: Promise<void>;
    act(() => {
      close = model().closeTab(TAB_ID);
    });
    expect(otherView().closingTabIds.has(TAB_ID)).toBe(true);

    closed.resolve();
    await act(async () => {
      await close;
    });
    expect(otherView().closingTabIds.has(TAB_ID)).toBe(true);
    act(() => emitClosed(TAB_ID));
    expect(model().closingTabIds.has(TAB_ID)).toBe(false);
    expect(otherView().closingTabIds.has(TAB_ID)).toBe(false);
  });
});
