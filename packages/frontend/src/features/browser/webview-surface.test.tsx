import { afterEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import type { BrowserServerMessage } from "@openducktor/contracts";
import { render, screen } from "@testing-library/react";
import type { WebviewBrowserBridge } from "@/lib/shell-bridge";
import type { BrowserChannel, BrowserChannelListener } from "./browser-channel";
import { createBrowserFocusRegistry } from "./browser-focus-registry";
import { WebviewBrowserSurface } from "./webview-surface";

const TAB_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_TAB_ID = "00000000-0000-4000-8000-000000000002";

const bridge: WebviewBrowserBridge = {
  surface: "webview",
  partition: (workspaceId) => `persist:openducktor-browser-${workspaceId}`,
  bindGuest: async () => {},
  pickFiles: async () => [],
  connect: async () => ({ send: async () => {}, close: () => {} }),
};

const createChannelFixture = () => {
  const listeners = new Set<BrowserChannelListener>();
  const channel: BrowserChannel = {
    connect: async () => {},
    stop: async () => {},
    status: () => "connected",
    failure: () => null,
    send: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStatus: () => () => {},
  };
  const emit = (message: BrowserServerMessage): void => {
    for (const listener of Array.from(listeners)) listener(message);
  };
  return { channel, emit };
};

const press = (tabId: string, pressing: boolean): BrowserServerMessage => ({
  type: "agent_press",
  tabId,
  pressing,
});

const renderSurface = (isShown = true) => {
  const { channel, emit } = createChannelFixture();
  const focus = createBrowserFocusRegistry();
  const content = (shown: boolean) => (
    <>
      <textarea aria-label="Composer" />
      <input aria-label="Search" />
      <WebviewBrowserSurface
        bridge={bridge}
        channel={channel}
        focus={focus}
        isShown={shown}
        tabId={TAB_ID}
        workspaceId="workspace-1"
      />
    </>
  );
  const view = render(content(isShown));
  return {
    emit,
    focus,
    webview: screen.getByTestId("browser-webview"),
    show: () => view.rerender(content(true)),
  };
};

/** Moves the focus to the `<webview>`, as Electron does when a press reaches its guest. */
const pressFocus = (webview: HTMLElement): void => {
  webview.tabIndex = -1;
  webview.focus();
};

/** Electron can focus its guest without sending the public webview focus event. */
const focusGuest = (webview: HTMLElement): void => {
  webview.addEventListener("focus", (event) => event.stopImmediatePropagation(), {
    capture: true,
    once: true,
  });
  pressFocus(webview);
  window.dispatchEvent(new Event("blur"));
};

describe("WebviewBrowserSurface layout", () => {
  test("keeps the flex display that Electron needs to size the page to the slot", () => {
    const { webview } = renderSurface();

    expect(webview.className.split(" ")).toContain("flex");
    expect(webview.className.split(" ")).not.toContain("block");
  });
});

describe("WebviewBrowserSurface focus", () => {
  test("takes the focus when the address bar loads an address", () => {
    const { focus, webview } = renderSurface();
    // A real `<webview>` takes the focus. A test element needs a tab index.
    webview.tabIndex = -1;

    focus.focusPage(TAB_ID, { fromKeyboard: false });

    expect(document.activeElement).toBe(webview);
  });
});

describe("WebviewBrowserSurface agent focus guard", () => {
  afterEach(() => {
    setSystemTime();
  });

  test.each(["hidden", "hide", "press"])("avoids focus cycles across tabs (%s)", (scenario) => {
    const { channel, emit } = createChannelFixture();
    const focus = createBrowserFocusRegistry();
    const content = (isShown: boolean) => (
      <>
        <textarea aria-label="Composer" defaultValue="Keep typing here" />
        {[TAB_ID, OTHER_TAB_ID].map((tabId) => (
          <WebviewBrowserSurface
            key={tabId}
            bridge={bridge}
            channel={channel}
            focus={focus}
            isShown={isShown}
            tabId={tabId}
            workspaceId="workspace-1"
          />
        ))}
      </>
    );
    const view = render(content(scenario !== "hidden"));
    const composer = screen.getByLabelText<HTMLTextAreaElement>("Composer");
    composer.focus();
    composer.setSelectionRange(5, 11, "backward");
    const webviews = screen.getAllByTestId("browser-webview");
    let focusCalls = 0;
    const spies = webviews.map((webview) => {
      const focusPage = webview.focus.bind(webview);
      return spyOn(webview, "focus").mockImplementation((options) => {
        // Bound the pre-fix recursion so the test reports a failure instead of overflowing.
        if (++focusCalls <= 20) focusPage(options);
      });
    });
    try {
      if (scenario !== "hidden") {
        for (const webview of webviews) pressFocus(webview);
        focus.focusPage(TAB_ID, { fromKeyboard: false });
        if (scenario === "hide") view.rerender(content(false));
        else {
          for (const tabId of [TAB_ID, OTHER_TAB_ID]) emit(press(tabId, true));
        }
        focus.focusPage(OTHER_TAB_ID, { fromKeyboard: false });
        const expected = scenario === "hide" ? document.body : webviews[0];
        expect(document.activeElement === expected).toBe(true);
        composer.focus();
      }
      for (let round = 0; round < 5; round += 1) {
        for (const webview of webviews) {
          pressFocus(webview);
          expect(document.activeElement?.getAttribute("aria-label")).toBe("Composer");
          expect([
            composer.selectionStart,
            composer.selectionEnd,
            composer.selectionDirection,
          ]).toEqual([5, 11, "backward"]);
        }
      }
      expect(composer.value).toBe("Keep typing here");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test("keeps the composer focus and selection when Electron reports only a window blur", async () => {
    const { emit, webview } = renderSurface();
    const composer = screen.getByLabelText<HTMLTextAreaElement>("Composer");
    composer.value = "Keep typing here";
    composer.focus();
    composer.setSelectionRange(5, 11, "backward");

    emit(press(TAB_ID, true));
    focusGuest(webview);
    await Promise.resolve();

    expect(document.activeElement?.getAttribute("aria-label")).toBe("Composer");
    expect([composer.selectionStart, composer.selectionEnd, composer.selectionDirection]).toEqual([
      5,
      11,
      "backward",
    ]);
    expect(composer.value).toBe("Keep typing here");
  });

  test("keeps focus outside a hidden page before its press notification and after it settles", async () => {
    const { emit, webview } = renderSurface(false);
    const search = screen.getByLabelText("Search");
    search.focus();

    focusGuest(webview);
    await Promise.resolve();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Search");

    setSystemTime(new Date("2026-10-13T10:00:00.000Z"));
    emit(press(TAB_ID, false));
    setSystemTime(new Date("2026-10-13T10:00:01.000Z"));
    focusGuest(webview);
    await Promise.resolve();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Search");
  });

  test.each(["running", "settling"])(
    "keeps a %s press guarded when its hidden tab is shown",
    async (state) => {
      const { emit, show, webview } = renderSurface(false);
      screen.getByLabelText("Composer").focus();
      setSystemTime(new Date("2026-10-13T10:00:00.000Z"));
      emit(press(TAB_ID, true));
      if (state === "settling") emit(press(TAB_ID, false));
      setSystemTime(new Date("2026-10-13T10:00:00.200Z"));

      show();
      focusGuest(webview);
      await Promise.resolve();

      expect(document.activeElement?.getAttribute("aria-label")).toBe("Composer");
    },
  );

  test("gives the focus back to the element that the user has focused when an agent press moves it", () => {
    const { emit, webview } = renderSurface();
    screen.getByLabelText("Composer").focus();

    emit(press(TAB_ID, true));
    // The user moved to another field while the agent action waited.
    const search = screen.getByLabelText("Search");
    search.focus();
    pressFocus(webview);
    expect(document.activeElement).toBe(search);

    // A second press of the same action, such as a double click, is guarded too.
    pressFocus(webview);
    expect(document.activeElement).toBe(search);
  });

  test("guards a short time after the press ends, then leaves the page focus to the user", () => {
    const { emit, webview } = renderSurface();
    const composer = screen.getByLabelText("Composer");
    composer.focus();
    setSystemTime(new Date("2026-10-13T10:00:00.000Z"));

    emit(press(TAB_ID, true));
    emit(press(TAB_ID, false));
    setSystemTime(new Date("2026-10-13T10:00:00.200Z"));
    pressFocus(webview);
    expect(document.activeElement).toBe(composer);

    setSystemTime(new Date("2026-10-13T10:00:01.000Z"));
    pressFocus(webview);
    expect(document.activeElement).toBe(webview);
  });

  test("leaves the focus on the page when the user clicks it and no agent press runs", async () => {
    const { webview } = renderSurface();
    screen.getByLabelText("Composer").focus();

    focusGuest(webview);
    await Promise.resolve();

    expect(document.activeElement).toBe(webview);
  });

  test("ignores the presses of another tab", () => {
    const { emit, webview } = renderSurface();
    screen.getByLabelText("Composer").focus();

    emit(press(OTHER_TAB_ID, true));
    pressFocus(webview);

    expect(document.activeElement).toBe(webview);
  });

  test("takes the focus from the page when the user had nothing focused", async () => {
    const { emit, webview } = renderSurface();
    const composer = screen.getByLabelText("Composer");
    composer.focus();
    composer.blur();
    await Promise.resolve();

    emit(press(TAB_ID, true));
    pressFocus(webview);

    expect(document.activeElement).toBe(document.body);
  });

  test("stops guarding when the end of a press never comes", () => {
    const { emit, webview } = renderSurface();
    screen.getByLabelText("Composer").focus();
    setSystemTime(new Date("2026-10-13T10:00:00.000Z"));

    emit(press(TAB_ID, true));
    setSystemTime(new Date("2026-10-13T10:00:11.000Z"));
    pressFocus(webview);

    expect(document.activeElement).toBe(webview);
  });
});
