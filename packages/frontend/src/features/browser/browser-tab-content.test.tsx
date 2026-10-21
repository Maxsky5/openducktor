import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type BrowserAnnotationCapture,
  type BrowserClientMessage,
  type BrowserEngineState,
  type BrowserFailure,
  type BrowserServerMessage,
  type BrowserTabSummary,
  decodeBrowserClientMessage,
  encodeBrowserChannelMessage,
} from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { browserAnnotationStoreOf } from "@/features/browser-annotations/browser-annotation-store";
import { QueryProvider } from "@/test-utils/query-provider";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  type BrowserBridge,
  type BrowserFrameBridge,
  configureShellBridge,
  createUnavailableShellBridge,
} from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
} from "@/test-utils/session-panel-fixtures";
import { BrowserLayer } from "./browser-layer";
import {
  type BrowserRuntime,
  BrowserRuntimeProvider,
  useBrowserRuntime,
  type WebviewBrowserRuntime,
} from "./browser-runtime";
import { BROWSER_DEVTOOLS_DEFAULT_SIZE, useBrowserDevToolsStore } from "./browser-devtools-store";
import { BROWSER_TABS_NEED_LOCAL_APP } from "./browser-frame-display";
import { browserRecentPagesOf } from "./browser-recent-pages";
import { browserSurfaceKey, devToolsSurfaceKey } from "./browser-surface-registry";
import { BrowserTabContent } from "./browser-tab-content";

const TAB_ID = browserTabIdFixture(1);
const READY: BrowserEngineState = {
  kind: "ready",
  engine: "electron_webview",
};
const PREVIEW = "http://localhost:61000";

const capture: BrowserAnnotationCapture = {
  page: { url: "http://localhost:3000/", title: "Dev server" },
  selectedText: null,
  elements: [
    {
      tag: "button",
      text: "Go",
      openingTag: '<button id="go">',
      selector: "#go",
      componentChain: null,
      source: null,
      accessible: null,
    },
  ],
  image: null,
};

/** A browser channel that records client messages and lets the test send server messages. */
const createChannelFixture = () => {
  const sent: BrowserClientMessage[] = [];
  let deliver: (message: Uint8Array) => void = () => {};
  let drop: (message: string) => void = () => {};
  return {
    sent,
    connect: async (
      onMessage: (message: Uint8Array) => void,
      onStateChange: (state: "connected" | "disconnected") => void,
      onFailure: (failure: BrowserFailure) => void,
    ) => {
      deliver = onMessage;
      drop = (message) => {
        onFailure({ code: "protocol_error", message });
        onStateChange("disconnected");
      };
      queueMicrotask(() => onStateChange("connected"));
      return {
        send: async (message: Uint8Array) => {
          sent.push(decodeBrowserClientMessage(message));
        },
        close: () => {},
      };
    },
    receive: (message: BrowserServerMessage) => deliver(encodeBrowserChannelMessage(message)),
    /** Ends the connection with a failure, like a socket that the host closed. */
    fail: (message: string) => drop(message),
  };
};

const renderTab = (
  tab: BrowserTabSummary,
  engine: BrowserEngineState = READY,
  options: {
    withLayer?: boolean;
    frames?: BrowserFrameBridge | null;
    listed?: boolean;
    inPanel?: boolean;
  } = {},
) => {
  const channel = createChannelFixture();
  const openExternalUrl = mock(async (_url: string) => {});
  const browser: BrowserBridge =
    options.frames === undefined
      ? {
          surface: "webview",
          connect: channel.connect,
          partition: (workspaceId) => `persist:openducktor-browser-${workspaceId}`,
          bindGuest: async () => {},
          pickFiles: async () => [],
        }
      : { surface: "frame", frames: options.frames };
  const pickerSet = mock(async () => {});
  const navigate = mock(async () => {});
  const start = mock(async () => tab);
  const annotationCapture = mock(async () => capture);
  const connection = createTestClientConnection({
    client: {
      browserTabsList: async () => ({ tabs: [tab] }),
      browserStateRead: async () => engine,
      browserPickerSet: pickerSet,
      browserTabNavigate: navigate,
      browserTabStart: start,
      browserAnnotationCapture: annotationCapture,
      browserDevToolsOpen: async () => ({ frontendUrl: "devtools://devtools/bundled/app.html" }),
    },
  });
  configureShellBridge(createShellBridgeFixture({ bridge: { openExternalUrl, browser } }));
  let runtime: BrowserRuntime | null = null;
  function Probe(): ReactElement | null {
    runtime = useBrowserRuntime();
    return null;
  }
  /** `inPanel` false leaves the tab out of the panels, as for an owner that no panel shows. */
  const tree = (inPanel: boolean) => (
    <QueryProvider connection={connection}>
      <BrowserRuntimeProvider>
        <Probe />
        {options.withLayer ? <BrowserLayer /> : null}
        {inPanel ? (
          <BrowserTabContent
            entry={{
              id: `browser:${TAB_ID}`,
              kind: "browser",
              tabId: TAB_ID,
            }}
            tab={options.listed === false ? null : tab}
            isShown
            addressFocusRequest={0}
          />
        ) : null}
      </BrowserRuntimeProvider>
    </QueryProvider>
  );
  const view = render(tree(options.inPanel ?? true));
  const requireRuntime = (): BrowserRuntime => {
    if (runtime === null) throw new Error("The runtime did not render.");
    return runtime;
  };
  const webviewRuntime = (): WebviewBrowserRuntime => {
    const current = requireRuntime();
    if (current.surface !== "webview") throw new Error("The runtime is not the Electron one.");
    return current;
  };
  return {
    view,
    connection,
    channel,
    pickerSet,
    navigate,
    start,
    annotationCapture,
    openExternalUrl,
    runtime: requireRuntime,
    webviewRuntime,
    setInPanel: (inPanel: boolean) => view.rerender(tree(inPanel)),
  };
};

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
  useBrowserDevToolsStore.setState({ docks: {} });
});

describe("BrowserTabContent", () => {
  test("shows a selected live page in its slot", async () => {
    const { runtime } = renderTab(createBrowserTabSummaryFixture({ tabId: TAB_ID }));

    await waitFor(() => expect(runtime().store.getSnapshot().engine).toEqual(READY));
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))?.visible).toBe(true);
  });

  test("docks DevTools in the tab, and they open again at the size the user chose", async () => {
    const { runtime } = renderTab(createBrowserTabSummaryFixture({ tabId: TAB_ID }), {
      kind: "ready",
      engine: "electron_webview",
    });
    const devTools = await screen.findByRole("button", { name: "DevTools" });

    fireEvent.click(devTools);
    await waitFor(() =>
      expect(runtime().slots.get(devToolsSurfaceKey(TAB_ID))?.visible).toBe(true),
    );
    expect(screen.getByRole("separator", { name: "Resize DevTools" })).toBeTruthy();
    expect(devTools.getAttribute("aria-pressed")).toBe("true");
    act(() => useBrowserDevToolsStore.getState().resize(TAB_ID, 25));

    fireEvent.click(devTools);
    expect(screen.queryByRole("separator", { name: "Resize DevTools" })).toBeNull();
    expect(runtime().slots.get(devToolsSurfaceKey(TAB_ID))).toBeUndefined();
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))?.visible).toBe(true);

    fireEvent.click(devTools);
    expect(useBrowserDevToolsStore.getState().docks[TAB_ID]).toEqual({ open: true, size: 25 });
    expect(BROWSER_DEVTOOLS_DEFAULT_SIZE).not.toBe(25);

    fireEvent.click(screen.getByRole("button", { name: "Close DevTools" }));
    expect(screen.queryByRole("separator", { name: "Resize DevTools" })).toBeNull();
    expect(devTools.getAttribute("aria-pressed")).toBe("false");
  });

  test("shows recent pages in place of a blank page, and opens one in the tab", async () => {
    const { runtime, navigate, connection } = renderTab(
      createBrowserTabSummaryFixture({ tabId: TAB_ID, url: "about:blank", title: null }),
    );
    act(() =>
      browserRecentPagesOf(connection).record(
        createBrowserTabSummaryFixture({
          tabId: browserTabIdFixture(2),
          url: "http://localhost:5173/",
          title: "Dev app",
        }),
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: /Dev app/ }));

    expect(screen.getByText("Open a page")).toBeTruthy();
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))?.visible).toBe(false);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        tabId: TAB_ID,
        navigation: { kind: "address", address: "http://localhost:5173/" },
      }),
    );
  });

  test("hides the page while no window can show it", async () => {
    const { runtime } = renderTab(createBrowserTabSummaryFixture({ tabId: TAB_ID }), {
      kind: "no_window",
    });

    expect(await screen.findByText("No window can show this page")).toBeTruthy();
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))?.visible).toBe(false);
  });

  test("shows a load error in place of the page and reloads it", async () => {
    const tab = createBrowserTabSummaryFixture({
      tabId: TAB_ID,
      error: {
        kind: "load_failed",
        url: "http://localhost:3000/",
        message: "The connection was refused.",
      },
    });
    const { runtime, navigate } = renderTab(tab);

    const reloadButtons = await screen.findAllByRole("button", { name: /reload/i });
    // The toolbar has a Reload button too. The last one belongs to the error view.
    const errorReload = reloadButtons.at(-1);
    if (!errorReload) throw new Error("The error view has no Reload button.");
    fireEvent.click(errorReload);

    expect(screen.getByText("The connection was refused.")).toBeTruthy();
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))?.visible).toBe(false);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ tabId: TAB_ID, navigation: { kind: "reload" } }),
    );
  });

  test("hides the page of a saved tab until the tab starts", async () => {
    const { runtime } = renderTab(
      createBrowserTabSummaryFixture({ tabId: TAB_ID, started: false, live: false }),
    );

    expect(await screen.findByText("Opening the page...")).toBeTruthy();
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))?.visible).toBe(false);
  });

  test("shows the start failure of a saved tab, and Reload starts it again", async () => {
    const { start, navigate } = renderTab(
      createBrowserTabSummaryFixture({
        tabId: TAB_ID,
        started: false,
        live: false,
        error: {
          kind: "load_failed",
          url: "http://localhost:3000/",
          message: "This Workspace Session is archived.",
        },
      }),
    );

    const reloadButtons = await screen.findAllByRole("button", { name: /reload/i });
    const errorReload = reloadButtons.at(-1);
    if (!errorReload) throw new Error("The error view has no Reload button.");
    fireEvent.click(errorReload);

    expect(screen.getByText("This Workspace Session is archived.")).toBeTruthy();
    await waitFor(() => expect(start).toHaveBeenCalledWith({ tabId: TAB_ID }));
    expect(navigate).not.toHaveBeenCalled();
  });

  test("shows a channel failure until the channel connects again", async () => {
    const { webviewRuntime, channel } = renderTab(
      createBrowserTabSummaryFixture({ tabId: TAB_ID }),
    );
    await waitFor(() => expect(webviewRuntime().channel.status()).toBe("connected"));

    act(() => channel.fail("The host closed the browser channel."));

    expect(
      await screen.findByText(
        "The page connection failed: The host closed the browser channel. OpenDucktor tries again.",
      ),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  test("picks an element and saves its annotation for the tab owner", async () => {
    const { webviewRuntime, channel, pickerSet, annotationCapture, connection } = renderTab(
      createBrowserTabSummaryFixture({ tabId: TAB_ID }),
    );
    await waitFor(() => expect(webviewRuntime().channel.status()).toBe("connected"));
    const overlayHost = document.createElement("div");
    document.body.append(overlayHost);
    act(() => {
      webviewRuntime().overlays.register(browserSurfaceKey(TAB_ID), overlayHost);
    });

    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(pickerSet).toHaveBeenCalledWith({ tabId: TAB_ID, enabled: true }));
    const picker = await screen.findByTestId("browser-picker-overlay");
    const target = (nodeRef: string, x: number) =>
      act(() =>
        channel.receive({
          type: "picker_target",
          tabId: TAB_ID,
          x,
          y: 40,
          target: { nodeRef, box: { x: 10, y: 20, width: 80, height: 30 }, label: "button" },
        }),
      );
    // The pointer moved on from the last element that the host found, and the click comes first.
    target("node-6", 15);
    fireEvent.click(picker, { clientX: 30, clientY: 40 });
    expect(channel.sent.at(-1)).toEqual({ type: "picker_hover", tabId: TAB_ID, x: 30, y: 40 });
    expect(screen.queryByRole("textbox", { name: "Annotation comment" })).toBeNull();
    target("node-7", 30);
    fireEvent.change(await screen.findByRole("textbox", { name: "Annotation comment" }), {
      target: { value: "Make it blue" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(annotationCapture).toHaveBeenCalledWith({ tabId: TAB_ID, nodeRefs: ["node-7"] }),
    );
    await waitFor(() =>
      expect(
        Object.values(browserAnnotationStoreOf(connection).getState().annotationsByOwner)
          .flat()
          .map((annotation) => annotation.comment),
      ).toEqual(["Make it blue"]),
    );
    overlayHost.remove();
  });
});

describe("BrowserTabContent in the web runner", () => {
  const frames: BrowserFrameBridge = {
    source: async () => ({ kind: "preview", origin: PREVIEW }),
  };

  test("a keyboard user enters the iframe from its slot, and F6 in the address bar too", async () => {
    renderTab(
      createBrowserTabSummaryFixture({ tabId: TAB_ID, page: "frame", started: false }),
      READY,
      {
        withLayer: true,
        frames,
      },
    );
    const page = await screen.findByRole("group", { name: "Page" });
    const frame = await screen.findByTestId("browser-frame");
    const address = screen.getByLabelText("Address");

    act(() => page.focus());
    expect(document.activeElement).toBe(frame);
    act(() => address.focus());
    fireEvent.keyDown(address, { key: "F6" });

    expect(document.activeElement).toBe(frame);
    for (const name of ["Annotate", "Share with agents", "Site settings"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  test("loads a frame page when the panels first show its tab, and keeps it after", async () => {
    const { runtime, setInPanel } = renderTab(
      createBrowserTabSummaryFixture({ tabId: TAB_ID, page: "frame", started: false }),
      READY,
      { withLayer: true, frames, inPanel: false },
    );
    await waitFor(() => expect(runtime().store.getSnapshot().tabs.has(TAB_ID)).toBe(true));
    expect(screen.queryByTestId("browser-frame")).toBeNull();

    setInPanel(true);
    const frame = await screen.findByTestId("browser-frame");

    setInPanel(false);
    expect(screen.getByTestId("browser-frame")).toBe(frame);
  });

  test("offers to open a site that refuses frames in the browser of the user", async () => {
    const { runtime, openExternalUrl } = renderTab(
      createBrowserTabSummaryFixture({
        page: "frame",
        tabId: TAB_ID,
        started: false,
        url: "https://github.com/",
        error: {
          kind: "frame_refused",
          url: "https://github.com/",
          message: "github.com does not let other sites show its pages in a frame.",
        },
      }),
      READY,
      { frames },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open in browser" }));

    expect(screen.getByText("This site cannot show in a tab")).toBeTruthy();
    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/");
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))?.visible).toBe(false);
  });

  test("keeps the toolbar in place and the page hidden until the host lists a new tab", async () => {
    const { runtime } = renderTab(
      createBrowserTabSummaryFixture({ tabId: TAB_ID, started: false, url: "about:blank" }),
      READY,
      { frames, withLayer: true, listed: false },
    );

    expect((await screen.findByLabelText("Address")).getAttribute("placeholder")).toBe(
      "Type a web address",
    );
    expect(screen.queryByRole("group", { name: "Browser controls" })).toBeNull();
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))).toBeUndefined();
  });

  test("shows the new tab page in place of a blank iframe", async () => {
    const { runtime } = renderTab(
      createBrowserTabSummaryFixture({ tabId: TAB_ID, started: false, url: "about:blank" }),
      READY,
      { frames },
    );

    expect(
      await screen.findByText("The pages that you open in this workspace show here."),
    ).toBeTruthy();
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))?.visible).toBe(false);
  });

  test("says why an app on another machine cannot show pages", async () => {
    const { runtime } = renderTab(
      createBrowserTabSummaryFixture({ tabId: TAB_ID, page: "frame", started: false }),
      READY,
      { frames: null },
    );

    expect(await screen.findByText(BROWSER_TABS_NEED_LOCAL_APP)).toBeTruthy();
    expect(runtime().slots.get(browserSurfaceKey(TAB_ID))?.visible).toBe(false);
  });
});
