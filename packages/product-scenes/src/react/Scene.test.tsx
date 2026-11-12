import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PageSceneProps } from "./PageScene";
import { testObserver } from "../test-support/test-observer";

// The scene modules load GSAP and React DOM, so they load after the browser globals exist. The
// first load of a module can exceed the test budget on a loaded runner, so the views and the
// timelines that the tests show load once here. React DOM and GSAP keep the timers of the first
// browser globals, so the tests of both React hosts share one set of globals in this file.
const loadModules = () =>
  Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./Scene"),
    import("../motion/gsap"),
    import("./PageScene"),
    import("../motion/preference"),
    import("react-dom/server"),
    // The tests read the modules above by position. The modules below only load early.
    import("../scenes/autopilot/timeline"),
    import("../scenes/autopilot/view"),
    import("../scenes/hero/view"),
    import("../scenes/hero/timeline"),
    import("../scenes/workflow/timeline"),
    import("../scenes/workflow/view"),
  ]);
let modules: Awaited<ReturnType<typeof loadModules>>;

beforeAll(async () => {
  GlobalRegistrator.register();
  modules = await loadModules();
}, 5_000);
afterAll(async () => {
  // An unmount leaves React work in the scheduler, which reads the browser globals. It runs
  // before this timer.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await GlobalRegistrator.unregister();
});

/** Waits until `ready` holds, while React commits and the scene modules load. */
async function waitFor(ready: () => boolean): Promise<void> {
  for (let step = 0; step < 200 && !ready(); step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!ready()) throw new Error("The scene did not reach the expected state in 1 s.");
}

describe("Scene", () => {
  test("renders the autopilot view, plays after mount, and the unmount clears its timeline", async () => {
    const [{ createElement, Suspense }, { createRoot }, { Scene }, { gsap }] = modules;
    const container = document.createElement("div");
    document.body.append(container);
    const tweensBefore = gsap.globalTimeline.getChildren().length;
    const host = createRoot(container);
    let unmounted = false;
    const render = (theme: "light" | "dark"): void =>
      host.render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(Scene, { name: "autopilot", theme }),
        ),
      );

    try {
      render("dark");
      await waitFor(
        () =>
          container.querySelector('[data-scene="autopilot"]')?.hasAttribute("data-motion") ?? false,
      );
      const root = container.querySelector<HTMLElement>('[data-scene="autopilot"]');
      if (!root) throw new Error("The autopilot scene did not render.");
      expect(root.dataset.theme).toBe("dark");
      expect(root.querySelector("[data-stage]")?.getAttribute("aria-label")).toContain("Autopilot");
      expect(root.querySelectorAll("[data-stock] > [data-tpl]").length).toBeGreaterThan(10);
      expect(root.dataset.motion).toBe("running");
      expect(root.hasAttribute("data-framed")).toBe(false);
      // The first frame of the loop moves the task to Backlog.
      expect(root.querySelector('[data-lane="open"] [data-card="import"]')).not.toBeNull();
      expect(gsap.globalTimeline.getChildren().length).toBeGreaterThan(tweensBefore);

      render("dark");
      // A render of the host does not render the view again: the timeline keeps its DOM.
      expect(container.querySelector('[data-scene="autopilot"]')).toBe(root);

      host.unmount();
      unmounted = true;
      expect(gsap.globalTimeline.getChildren().length).toBe(tweensBefore);
      expect(root.dataset.motion).toBeUndefined();
      // The stage holds the static frame again: the task waits in Human Review.
      expect(root.querySelector('[data-lane="human_review"] [data-card="import"]')).not.toBeNull();
    } finally {
      if (!unmounted) host.unmount();
      container.remove();
    }
  });

  test("a preloaded scene renders at once, without its Suspense fallback", async () => {
    const [{ createElement, Suspense }, { createRoot }, { Scene, preloadScene }] = modules;
    const { flushSync } = await import("react-dom");
    await preloadScene("hero");
    const container = document.createElement("div");
    document.body.append(container);
    const host = createRoot(container);
    try {
      flushSync(() =>
        host.render(
          createElement(
            Suspense,
            { fallback: createElement("p", { "data-fallback": "" }) },
            createElement(Scene, { name: "hero", framed: true, options: { version: "1.0.0" } }),
          ),
        ),
      );
      expect(container.querySelector("[data-fallback]")).toBeNull();
      const root = container.querySelector<HTMLElement>('[data-scene="hero"]');
      // A framed scene fills the frame of its host, which hides the pointer of the visitor.
      expect(root?.hasAttribute("data-framed")).toBe(true);
      expect(root?.querySelector("[data-cursor]")).not.toBeNull();
    } finally {
      host.unmount();
      container.remove();
    }
  });

  test("a scene without a version shows no version line under the app name", async () => {
    const [{ createElement, Suspense }, { createRoot }, { Scene, preloadScene }] = modules;
    const { flushSync } = await import("react-dom");
    await preloadScene("hero");
    const container = document.createElement("div");
    document.body.append(container);
    const host = createRoot(container);
    try {
      flushSync(() =>
        host.render(
          createElement(
            Suspense,
            { fallback: null },
            createElement(Scene, { name: "hero", framed: true, options: { version: null } }),
          ),
        ),
      );
      expect(container.querySelector('[data-scene="hero"] .sb-brand strong')?.textContent).toBe(
        "OpenDucktor",
      );
      expect(container.querySelector('[data-scene="hero"] .sb-brand small')).toBeNull();
    } finally {
      host.unmount();
      container.remove();
    }
  });

  test("renders the options of the host, and new options mount a new view", async () => {
    const [{ createElement, Suspense }, { createRoot }, { Scene }] = modules;
    const container = document.createElement("div");
    document.body.append(container);
    const host = createRoot(container);
    const render = (designWidth: number): void =>
      host.render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(Scene, {
            name: "hero",
            options: { version: "9.8.7", designWidth, wholeLanes: true },
          }),
        ),
      );
    const window = (): HTMLElement | null =>
      container.querySelector<HTMLElement>('[data-scene="hero"] .app-window');

    try {
      render(1476);
      await waitFor(() => window() !== null);
      // The loop of the scene puts back the stage markup, so the test keeps the scene root, which
      // React owns.
      const first = container.querySelector('[data-scene="hero"]');
      expect(window()?.style.getPropertyValue("--design-width")).toBe("1476");
      expect(container.querySelector('[data-scene="hero"] .sb-head small')?.textContent).toBe(
        "9.8.7",
      );
      expect(container.querySelector("[data-board-track]")?.hasAttribute("data-whole-lanes")).toBe(
        true,
      );

      render(1545);
      const root = (): Element | null => container.querySelector('[data-scene="hero"]');
      await waitFor(() => root() !== first && window() !== null);
      expect(window()?.style.getPropertyValue("--design-width")).toBe("1545");
    } finally {
      host.unmount();
      container.remove();
    }
  });
});

/** A page scene in its own container, the markup of the server, and the unmount. */
type RenderedScene = { container: HTMLElement; html: string; unmount: () => void };

/**
 * The server HTML of each page scene that the tests hydrate. It renders before the tests, because
 * the server render of the large workflow view can exceed the test budget on a loaded runner.
 */
const serverHtml = new Map<string, string>();

function pageElement(props: PageSceneProps) {
  const [{ createElement }, , , , { PageScene }] = modules;
  const stylesheet = (sheet: string) => `/scenes/${sheet}.css`;
  return createElement(PageScene, { ...props, failure: null, stylesheet });
}

/** Hydrates the server HTML of the page scene of `props` in a new container. */
function renderScene(props: PageSceneProps): RenderedScene {
  const [, { hydrateRoot }] = modules;
  const element = pageElement(props);
  const html = serverHtml.get(props.name);
  if (html === undefined) throw new Error(`Render the server HTML of ${props.name} first.`);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  const host = hydrateRoot(container, element);
  return {
    html,
    container,
    unmount: () => {
      host.unmount();
      container.remove();
    },
  };
}

/** Makes the visitor ask for reduced motion. Returns the function that restores the setting. */
function reduceMotion(): () => void {
  const [, , , , , { MOTION_QUERY }] = modules;
  const matchMedia = window.matchMedia;
  window.matchMedia = (query) =>
    matchMedia.call(window, query === MOTION_QUERY ? "(prefers-reduced-motion: reduce)" : query);
  return () => {
    window.matchMedia = matchMedia;
  };
}

let Observer: ReturnType<typeof testObserver>;

/** True while an observer watches `view`, such as the player that waits for the view. */
const watched = (view: Element): boolean =>
  Array.from(Observer.live).some((observer) => observer.targets.has(view));

/** Reports to the observers that watch `view` that it comes near the screen. */
async function nearScreen(view: () => HTMLElement | null): Promise<HTMLElement> {
  await waitFor(() => {
    const element = view();
    return element !== null && watched(element);
  });
  const element = view();
  if (!element) throw new Error("The view did not render.");
  Observer.report(element, true);
  return element;
}

const tabs = (root: HTMLElement): HTMLButtonElement[] =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const shownPanels = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-chapter-panel]")).filter(
    (panel) => !panel.hidden,
  );

describe("PageScene", () => {
  let native: typeof IntersectionObserver;
  beforeAll(() => {
    const scenes: PageSceneProps[] = [{ name: "workflow" }, { name: "autopilot" }];
    scenes.push({ name: "hero", options: { version: null } });
    for (const props of scenes)
      serverHtml.set(props.name, modules[6].renderToString(pageElement(props)));
    native = globalThis.IntersectionObserver;
    Observer = testObserver();
    globalThis.IntersectionObserver = Observer;
  });
  afterAll(() => {
    globalThis.IntersectionObserver = native;
  });

  test("a chapter player shows its tabs, one chapter at a time, and the unmount stops it", async () => {
    const [, , , { gsap }] = modules;
    const tweensBefore = gsap.globalTimeline.getChildren().length;
    const { container, unmount } = renderScene({ name: "workflow" });
    let mounted = true;
    try {
      const chapters = (): HTMLElement | null =>
        container.querySelector<HTMLElement>('[data-chapters="workflow"]');
      // Without scripts, and until the view comes near the screen, the panels of the server stack
      // under their headings.
      await waitFor(() => {
        const view = chapters();
        return view !== null && watched(view);
      });
      expect(container.querySelector('[role="tablist"]')?.hasAttribute("hidden")).toBe(true);
      expect(shownPanels(container)).toHaveLength(5);
      const root = await nearScreen(chapters);
      await waitFor(() => root.hasAttribute("data-motion"));
      expect(root.querySelector('[role="tablist"]')?.hasAttribute("hidden")).toBe(false);
      expect(root.hasAttribute("data-tabs")).toBe(true);
      expect(shownPanels(root).map((panel) => panel.dataset.chapterPanel)).toEqual(["spec"]);
      // The browser reports no play zone yet, so the player waits.
      expect(root.dataset.motion).toBe("paused");
      expect(gsap.globalTimeline.getChildren().length).toBeGreaterThan(tweensBefore);

      const qa = tabs(root).find((tab) => tab.dataset.chapter === "qa");
      qa?.click();
      expect(qa?.getAttribute("aria-selected")).toBe("true");
      expect(shownPanels(root).map((panel) => panel.dataset.chapterPanel)).toEqual(["qa"]);
      qa?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(shownPanels(root).map((panel) => panel.dataset.chapterPanel)).toEqual(["review"]);
      expect(document.activeElement).toBe(tabs(root).at(-1) ?? null);

      unmount();
      mounted = false;
      expect(gsap.globalTimeline.getChildren().length).toBe(tweensBefore);
      expect(root.dataset.motion).toBeUndefined();
      // The unmount removes the listeners of the tabs.
      tabs(root)[0]?.click();
      expect(shownPanels(root).map((panel) => panel.dataset.chapterPanel)).toEqual(["review"]);
    } finally {
      if (mounted) unmount();
    }
  });

  test("with reduced motion, the tabs still select a chapter and nothing plays", async () => {
    const [, , , { gsap }] = modules;
    const restoreMotion = reduceMotion();
    const tweensBefore = gsap.globalTimeline.getChildren().length;
    const { container, unmount } = renderScene({ name: "workflow" });
    try {
      // The tabs need the chapter player, so it loads with reduced motion too.
      await nearScreen(() => container.querySelector<HTMLElement>('[data-chapters="workflow"]'));
      const root = (): HTMLElement | null =>
        container.querySelector<HTMLElement>('[data-chapters="workflow"][data-tabs]');
      await waitFor(() => root() !== null);
      const chapters = root();
      if (!chapters) throw new Error("The workflow view did not render.");
      expect(chapters.hasAttribute("data-motion")).toBe(false);
      tabs(chapters)[1]?.click();
      expect(shownPanels(chapters).map((panel) => panel.dataset.chapterPanel)).toEqual(["plan"]);
      expect(gsap.globalTimeline.getChildren().length).toBe(tweensBefore);
    } finally {
      unmount();
      restoreMotion();
    }
  });

  test("a loop scene waits for its play zone, and the unmount puts back the static frame", async () => {
    const [, , , { gsap }] = modules;
    const tweensBefore = gsap.globalTimeline.getChildren().length;
    const { container, html, unmount } = renderScene({ name: "autopilot" });
    let mounted = true;
    try {
      const root = await nearScreen(() =>
        container.querySelector<HTMLElement>('[data-scene="autopilot"]'),
      );
      await waitFor(() => root.hasAttribute("data-motion"));
      expect(root.dataset.motion).toBe("paused");
      expect(gsap.globalTimeline.getChildren().length).toBeGreaterThan(tweensBefore);

      unmount();
      mounted = false;
      expect(root.dataset.motion).toBeUndefined();
      expect(gsap.globalTimeline.getChildren().length).toBe(tweensBefore);
      // The stage holds the static frame of the server again.
      const server = document.createElement("div");
      server.innerHTML = html;
      expect(root.querySelector("[data-stage]")?.innerHTML).toBe(
        server.querySelector("[data-stage]")?.innerHTML,
      );
    } finally {
      if (mounted) unmount();
    }
  });

  test("with reduced motion, a loop scene keeps its static frame and loads nothing", async () => {
    const [, , , { gsap }] = modules;
    const restoreMotion = reduceMotion();
    const tweensBefore = gsap.globalTimeline.getChildren().length;
    const { container, unmount } = renderScene({ name: "hero", options: { version: null } });
    try {
      const root = container.querySelector<HTMLElement>('[data-scene="hero"]');
      if (!root) throw new Error("The hero view did not render.");
      // The effects of the hydration run, and no observer waits for the view.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(watched(root)).toBe(false);
      expect(root.hasAttribute("data-motion")).toBe(false);
      expect(gsap.globalTimeline.getChildren().length).toBe(tweensBefore);
    } finally {
      unmount();
      restoreMotion();
    }
  });
});
