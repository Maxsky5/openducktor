import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// The scene modules load GSAP and React DOM, so they load after the browser globals exist. The
// first load of a module can exceed the test budget on a loaded runner, so the views and the
// timelines that the tests show load once here.
const loadModules = () =>
  Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./Scene"),
    import("../motion/gsap"),
    // The tests read the modules above by position. The modules below only load early.
    import("../scenes/autopilot/timeline"),
    import("../scenes/autopilot/view"),
    import("../scenes/hero/view"),
    import("../scenes/hero/timeline"),
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
