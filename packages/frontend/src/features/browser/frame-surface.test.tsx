import { afterEach, describe, expect, mock, test } from "bun:test";
import type { BrowserFrameMessage, BrowserFrameSource } from "@openducktor/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryProvider } from "@/test-utils/query-provider";
import { browserTabIdFixture } from "@/test-utils/session-panel-fixtures";
import { createBrowserFocusRegistry } from "./browser-focus-registry";
import type { BrowserFrameControls } from "./browser-frame-display";
import { createBrowserSurfaceRegistry } from "./browser-surface-registry";
import { FrameBrowserSurface } from "./frame-surface";
import { type BrowserFrameState, startFrameTabController } from "./frame-tab-controller";
import { embeddedShortcutSources } from "../shortcuts/embedded-sources";

const TAB_ID = browserTabIdFixture(1);

/** A message as the frame script posts it, or as another script of the page could post it. */
type FrameMessageData = BrowserFrameMessage | Record<string, string | number | boolean | null>;
const PREVIEW = "http://localhost:61000";
const PREVIEW_SOURCE: BrowserFrameSource = { kind: "preview", origin: PREVIEW };

let stopFrame: (() => void) | undefined;
afterEach(() => {
  stopFrame?.();
  stopFrame = undefined;
});

const startFrame = (
  url = "http://localhost:3000/app?x=1",
  sourceOf: (url: string) => BrowserFrameSource | Promise<BrowserFrameSource> = () =>
    PREVIEW_SOURCE,
) => {
  const reports: BrowserFrameState[] = [];
  const focus = createBrowserFocusRegistry();
  const toAddressBar = mock(() => {});
  focus.registerAddressBar(TAB_ID, toAddressBar);
  const controls = createBrowserSurfaceRegistry<BrowserFrameControls>();
  const source = mock(async (target: string) => sourceOf(target));
  const setChecking = mock((_checking: boolean) => {});
  // Drive frame events ourselves so the browser cannot start a network request.
  const frame = document.createElement("iframe");
  const posted = mock(() => {});
  Object.defineProperty(frame, "contentWindow", {
    value: { postMessage: posted },
  });
  stopFrame = startFrameTabController({
    element: frame,
    frames: { source },
    focus,
    controls,
    tabId: TAB_ID,
    startUrl: url,
    setChecking,
    reportState: (state) => reports.push(state),
  });
  const fromFrame = (data: FrameMessageData, origin = PREVIEW) =>
    window.dispatchEvent(
      new MessageEvent("message", { data, origin, source: frame.contentWindow }),
    );
  const control = (): BrowserFrameControls => {
    const found = controls.get(TAB_ID);
    if (!found) throw new Error("The frame has no controls.");
    return found;
  };
  const finishLoad = async () => {
    await source.mock.results.at(-1)?.value;
  };
  return {
    frame,
    reports,
    source,
    control,
    toAddressBar,
    fromFrame,
    finishLoad,
    posted,
    setChecking,
  };
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

test("lets a page run scripts without letting it navigate the app", () => {
  const markup = renderToStaticMarkup(
    <QueryProvider>
      <FrameBrowserSurface
        frames={{ source: async () => PREVIEW_SOURCE }}
        focus={createBrowserFocusRegistry()}
        controls={createBrowserSurfaceRegistry<BrowserFrameControls>()}
        tabId={TAB_ID}
        initialUrl="about:blank"
      />
    </QueryProvider>,
  );
  const sandbox = markup.match(/sandbox="([^"]*)"/)?.[1];
  expect(sandbox).toContain("allow-scripts");
  expect(sandbox).not.toContain("allow-top-navigation");
});

describe("frame tab controller", () => {
  test("installs routes into a replacement document without a loading message", async () => {
    const { frame, fromFrame, finishLoad, posted } = startFrame();
    await finishLoad();
    fromFrame(state);
    const first = embeddedShortcutSources.all().find((source) => source.tabId === TAB_ID)!;
    const rules = { revision: 1, routes: [] };
    const installed = first.apply(rules);
    fromFrame({ openducktorFrame: 1, type: "shortcut", event: { type: "ready", revision: 1 } });
    await installed;

    fromFrame({ ...state, url: "http://localhost:3000/replacement" });
    frame.dispatchEvent(new Event("load"));
    const replacement = embeddedShortcutSources.all().find((source) => source.tabId === TAB_ID)!;
    expect(replacement).not.toBe(first);
    expect(embeddedShortcutSources.has(first)).toBe(false);
    const reinstalled = replacement.apply({ ...rules, revision: 2 });
    fromFrame({ openducktorFrame: 1, type: "shortcut", event: { type: "ready", revision: 2 } });
    await reinstalled;
    expect(posted).toHaveBeenLastCalledWith(
      { openducktorShortcutRules: { ...rules, revision: 2 } },
      PREVIEW,
    );
  });
  test("loads a page of the host from the preview origin of its dev server", async () => {
    const { frame, source, finishLoad } = startFrame();
    await finishLoad();

    expect(source).toHaveBeenCalledWith("http://localhost:3000/app?x=1");
    expect(frame.src).toBe(`${PREVIEW}/app?x=1`);
  });

  test("reports the state that the frame script sends, and ignores other origins", async () => {
    const { reports, fromFrame, finishLoad } = startFrame();
    await finishLoad();
    const before = reports.length;

    fromFrame(state, "http://localhost:3000");
    expect(reports.length).toBe(before);
    fromFrame(state);

    expect(reports.at(-1)).toMatchObject({
      url: "http://localhost:3000/settings",
      title: "Settings",
      canGoBack: true,
      error: null,
    });
  });

  test("shows a load error of the dev server and gives F6 to the address bar", async () => {
    const { reports, fromFrame, toAddressBar, finishLoad } = startFrame();
    await finishLoad();

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
    const { control, fromFrame, finishLoad, posted } = startFrame();
    await finishLoad();
    fromFrame(state);

    control().run("back");

    expect(posted).toHaveBeenCalledWith({ openducktorFrameCommand: "back" }, PREVIEW);
  });

  test("follows a page without the frame script, such as JSON, and Back returns to the page before", async () => {
    const { frame, reports, control, fromFrame, finishLoad, posted } = startFrame();
    await finishLoad();
    fromFrame({ ...state, canGoBack: false });

    fromFrame({ openducktorFrame: 1, type: "loading", url: "http://localhost:3000/api/data" });
    frame.dispatchEvent(new Event("load"));

    expect(reports.at(-1)).toMatchObject({
      url: "http://localhost:3000/api/data",
      title: null,
      loading: false,
      canGoBack: true,
    });
    control().run("back");

    expect(posted).not.toHaveBeenCalled();
    await finishLoad();
    expect(frame.src).toBe(`${PREVIEW}/settings`);
  });

  test("sends Stop to the page while a link loads, before the next document replaces it", async () => {
    const { control, fromFrame, finishLoad, posted } = startFrame();
    await finishLoad();
    fromFrame(state);

    fromFrame({ openducktorFrame: 1, type: "loading", url: "http://localhost:3000/slow" });
    control().run("stop");

    expect(posted).toHaveBeenCalledWith({ openducktorFrameCommand: "stop" }, PREVIEW);
  });

  test("loads a site at its own URL, and shows it after the host allows frames", async () => {
    let allow: () => void = () => {};
    const { frame, finishLoad, setChecking } = startFrame(
      "https://openducktor.dev/docs",
      () =>
        new Promise<BrowserFrameSource>((resolve) => {
          allow = () => resolve({ kind: "direct" });
        }),
    );

    expect(frame.src).toBe("https://openducktor.dev/docs");
    expect(setChecking).toHaveBeenLastCalledWith(true);
    allow();
    await finishLoad();

    expect(setChecking).toHaveBeenLastCalledWith(false);
  });

  test("never loads a script URL, from a page message or from a load", async () => {
    const { frame, reports, control, fromFrame, finishLoad } = startFrame();
    await finishLoad();
    const reported = reports.length;

    // The page posts a script URL as its state, so a later mount or reload would run it.
    fromFrame({ ...state, url: "javascript:parent.document.title='owned'" });
    expect(reports).toHaveLength(reported);

    await control().load("javascript:parent.document.title='owned'");
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
    const { frame, reports, finishLoad } = startFrame("https://github.com/", () => refused);
    await finishLoad();

    expect(reports.at(-1)).toMatchObject({
      url: "https://github.com/",
      loading: false,
      error: { kind: "frame_refused", url: "https://github.com/", message: refused.message },
    });
    expect(frame.src).toBe("about:blank");
  });

  test("opens a site that a preview page links to, and Back returns to the preview page", async () => {
    const { frame, reports, control, fromFrame, finishLoad } = startFrame(undefined, (url) =>
      url.startsWith("http://localhost") ? PREVIEW_SOURCE : { kind: "direct" },
    );
    await finishLoad();
    fromFrame({ ...state, canGoBack: false });

    fromFrame({ openducktorFrame: 1, type: "leave", url: "https://openducktor.dev/" });
    await finishLoad();
    expect(frame.src).toBe("https://openducktor.dev/");
    expect(reports.at(-1)).toMatchObject({ url: "https://openducktor.dev/", canGoBack: true });
    control().run("back");

    await finishLoad();
    expect(frame.src).toBe(`${PREVIEW}/settings`);
    expect(reports.at(-1)).toMatchObject({
      url: "http://localhost:3000/settings",
      canGoForward: true,
    });
  });
});
