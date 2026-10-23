import { describe, expect, mock, spyOn, test } from "bun:test";
import type { BrowserFrameSource, BrowserTabFrameStateRequest } from "@openducktor/contracts";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { browserTabIdFixture } from "@/test-utils/session-panel-fixtures";
import { createBrowserFocusRegistry } from "./browser-focus-registry";
import type { BrowserFrameControls } from "./browser-frame-display";
import { createBrowserSurfaceRegistry } from "./browser-surface-registry";
import { FrameBrowserSurface } from "./frame-surface";

const TAB_ID = browserTabIdFixture(1);

/** A message as the frame script posts it, or as another script of the page could post it. */
type FrameMessageData = Record<string, string | number | boolean | null>;
const PREVIEW = "http://localhost:61000";
const PREVIEW_SOURCE: BrowserFrameSource = { kind: "preview", origin: PREVIEW };

const renderFrame = async (
  url = "http://localhost:3000/app?x=1",
  sourceOf: (url: string) => BrowserFrameSource | Promise<BrowserFrameSource> = () =>
    PREVIEW_SOURCE,
) => {
  const reports: BrowserTabFrameStateRequest[] = [];
  const connection = createTestClientConnection({
    client: {
      browserTabFrameState: async (request) => {
        reports.push(request);
      },
    },
  });
  const focus = createBrowserFocusRegistry();
  const toAddressBar = mock(() => {});
  focus.registerAddressBar(TAB_ID, toAddressBar);
  const controls = createBrowserSurfaceRegistry<BrowserFrameControls>();
  const source = mock(async (target: string) => sourceOf(target));
  render(
    <QueryProvider connection={connection}>
      <FrameBrowserSurface
        frames={{ source }}
        focus={focus}
        controls={controls}
        tabId={TAB_ID}
        initialUrl={url}
      />
    </QueryProvider>,
  );
  const frame = screen.getByTestId("browser-frame");
  if (!(frame instanceof HTMLIFrameElement)) throw new Error("The page is not an iframe.");
  // Test iframes load no page, so the frame gets a window that only takes messages.
  Object.defineProperty(frame, "contentWindow", {
    configurable: true,
    value: { postMessage: () => {} },
  });
  await waitFor(() => expect(source).toHaveBeenCalled());
  const fromFrame = (data: FrameMessageData, origin = PREVIEW) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data, origin, source: frame.contentWindow }),
      );
    });
  const control = (): BrowserFrameControls => {
    const found = controls.get(TAB_ID);
    if (!found) throw new Error("The frame has no controls.");
    return found;
  };
  return { frame, reports, source, control, toAddressBar, fromFrame };
};

const state = {
  openducktorFrame: 1,
  type: "state",
  url: "http://localhost:3000/settings",
  title: "Settings",
  favicon: null,
  canGoBack: true,
  canGoForward: false,
  error: null,
};

describe("FrameBrowserSurface", () => {
  test("loads a page of the host from the preview origin of its dev server", async () => {
    const { frame, source } = await renderFrame();

    expect(source).toHaveBeenCalledWith("http://localhost:3000/app?x=1");
    await waitFor(() => expect(frame.src).toBe(`${PREVIEW}/app?x=1`));
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
  });

  test("reports the state that the frame script sends, and ignores other origins", async () => {
    const { frame, reports, fromFrame } = await renderFrame();
    await waitFor(() => expect(frame.src).toContain(PREVIEW));
    const before = reports.length;

    fromFrame(state, "http://localhost:3000");
    expect(reports.length).toBe(before);
    fromFrame(state);

    expect(reports.at(-1)).toMatchObject({
      tabId: TAB_ID,
      url: "http://localhost:3000/settings",
      title: "Settings",
      canGoBack: true,
      error: null,
    });
  });

  test("shows a load error of the dev server and gives F6 to the address bar", async () => {
    const { frame, reports, fromFrame, toAddressBar } = await renderFrame();
    await waitFor(() => expect(frame.src).toContain(PREVIEW));

    fromFrame({ ...state, error: "http://localhost:3000/settings did not answer." });
    fromFrame({ openducktorFrame: 1, type: "focus_address_bar" });

    expect(reports.at(-1)?.error).toEqual({
      kind: "load_failed",
      url: "http://localhost:3000/settings",
      message: "http://localhost:3000/settings did not answer.",
    });
    expect(toAddressBar).toHaveBeenCalledTimes(1);
  });

  test("sends toolbar commands to the frame script of the preview origin", async () => {
    const { frame, control, fromFrame } = await renderFrame();
    await waitFor(() => expect(frame.src).toContain(PREVIEW));
    fromFrame(state);
    if (!frame.contentWindow) throw new Error("The frame has no window.");
    const posted = spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});

    control().run("back");

    expect(posted).toHaveBeenCalledWith({ openducktorFrameCommand: "back" }, PREVIEW);
  });

  test("follows a page without the frame script, such as JSON, and Back returns to the page before", async () => {
    const { frame, reports, control, fromFrame } = await renderFrame();
    await waitFor(() => expect(frame.src).toContain(PREVIEW));
    fromFrame({ ...state, canGoBack: false });
    if (!frame.contentWindow) throw new Error("The frame has no window.");
    const posted = spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});

    fromFrame({ openducktorFrame: 1, type: "loading", url: "http://localhost:3000/api/data" });
    act(() => {
      frame.dispatchEvent(new Event("load"));
    });

    expect(reports.at(-1)).toMatchObject({
      url: "http://localhost:3000/api/data",
      title: null,
      loading: false,
      canGoBack: true,
    });
    control().run("back");

    expect(posted).not.toHaveBeenCalled();
    await waitFor(() => expect(frame.src).toBe(`${PREVIEW}/settings`));
  });

  test("sends Stop to the page while a link loads, before the next document replaces it", async () => {
    const { frame, control, fromFrame } = await renderFrame();
    await waitFor(() => expect(frame.src).toContain(PREVIEW));
    fromFrame(state);
    if (!frame.contentWindow) throw new Error("The frame has no window.");
    const posted = spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});

    fromFrame({ openducktorFrame: 1, type: "loading", url: "http://localhost:3000/slow" });
    control().run("stop");

    expect(posted).toHaveBeenCalledWith({ openducktorFrameCommand: "stop" }, PREVIEW);
  });

  test("loads a site at its own URL, and shows it after the host allows frames", async () => {
    let allow: () => void = () => {};
    const { frame } = await renderFrame(
      "https://openducktor.dev/docs",
      () =>
        new Promise<BrowserFrameSource>((resolve) => {
          allow = () => resolve({ kind: "direct" });
        }),
    );

    expect(frame.src).toBe("https://openducktor.dev/docs");
    expect(frame.className).toContain("invisible");
    await act(async () => allow());

    await waitFor(() => expect(frame.className).not.toContain("invisible"));
  });

  test("never loads a script URL, from a page message or from a load", async () => {
    const { frame, reports, control, fromFrame } = await renderFrame();
    await waitFor(() => expect(frame.src).toContain(PREVIEW));
    const reported = reports.length;

    // The page posts a script URL as its state, so a later mount or reload would run it.
    fromFrame({ ...state, url: "javascript:parent.document.title='owned'" });
    expect(reports).toHaveLength(reported);

    await act(() => control().load("javascript:parent.document.title='owned'"));
    expect(frame.src).toBe("about:blank");
    expect(reports.at(-1)).toMatchObject({
      url: "about:blank",
      error: { kind: "load_failed", message: "Only http and https pages can load in a tab." },
    });
  });

  test("leaves a site that refuses frames and says why", async () => {
    const refused: BrowserFrameSource = {
      kind: "refused",
      message: "github.com does not let other sites show its pages in a frame.",
    };
    const { frame, reports } = await renderFrame("https://github.com/", () => refused);

    await waitFor(() => expect(reports.at(-1)?.error?.kind).toBe("frame_refused"));
    expect(reports.at(-1)).toMatchObject({
      url: "https://github.com/",
      loading: false,
      error: { kind: "frame_refused", url: "https://github.com/", message: refused.message },
    });
    expect(frame.src).toBe("about:blank");
  });

  test("opens a site that a preview page links to, and Back returns to the preview page", async () => {
    const { frame, reports, control, fromFrame } = await renderFrame(undefined, (url) =>
      url.startsWith("http://localhost") ? PREVIEW_SOURCE : { kind: "direct" },
    );
    await waitFor(() => expect(frame.src).toContain(PREVIEW));
    fromFrame({ ...state, canGoBack: false });

    fromFrame({ openducktorFrame: 1, type: "leave", url: "https://openducktor.dev/" });
    await waitFor(() => expect(frame.src).toBe("https://openducktor.dev/"));
    expect(reports.at(-1)).toMatchObject({ url: "https://openducktor.dev/", canGoBack: true });
    control().run("back");

    await waitFor(() => expect(frame.src).toBe(`${PREVIEW}/settings`));
    expect(reports.at(-1)).toMatchObject({
      url: "http://localhost:3000/settings",
      canGoForward: true,
    });
  });
});
