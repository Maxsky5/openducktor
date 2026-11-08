import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// The motion modules load GSAP, so they load after the browser globals exist. The first load of
// GSAP can exceed the test budget on a loaded runner, so it runs once here.
const loadModules = () =>
  Promise.all([import("./gsap"), import("./mount"), import("./preference")]);
let modules: Awaited<ReturnType<typeof loadModules>>;

beforeAll(async () => {
  GlobalRegistrator.register();
  modules = await loadModules();
}, 5_000);
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

/** A scene root with a stage and one template, in the document. */
function frame(): HTMLElement {
  const root = document.createElement("div");
  root.dataset.scene = "test";
  root.innerHTML =
    '<div data-stage><p data-text>Done</p></div><div hidden inert data-stock><div data-tpl="word"><span>Start</span></div></div>';
  document.body.append(root);
  return root;
}

describe("mountScene", () => {
  test("a mounted scene stays paused until play(), and stop() puts back the markup", () => {
    const [{ gsap }, { mountScene }] = modules;
    const root = frame();
    const handle = mountScene(root, (scene) => {
      const text = scene.stage.querySelector("[data-text]");
      if (!(text instanceof HTMLElement)) throw new Error("The test frame has no text.");
      text.replaceWith(scene.template("word"));
      scene.timeline.to({}, { duration: 2 });
    });
    expect(root.dataset.motion).toBe("paused");
    expect(root.querySelector("[data-stage]")?.textContent).toBe("Start");
    expect(handle.duration()).toBe(2);
    handle.play();
    expect(root.dataset.motion).toBe("running");

    handle.stop();
    expect(root.dataset.motion).toBeUndefined();
    expect(root.querySelector("[data-stage]")?.innerHTML).toBe('<p data-text="">Done</p>');
    expect(() => handle.duration()).toThrow("reduced motion");
    expect(
      gsap.globalTimeline
        .getChildren()
        .some((child) => child.vars.paused === true && child.duration() === 2),
    ).toBe(false);
    root.remove();
  });

  test("with reduced motion, the scene keeps its static frame and builds no timeline", () => {
    const [, { mountScene }, { MOTION_QUERY }] = modules;
    // The visitor asks for reduced motion, so the motion query does not match.
    const matchMedia = window.matchMedia;
    window.matchMedia = (query) =>
      matchMedia.call(window, query === MOTION_QUERY ? "(prefers-reduced-motion: reduce)" : query);
    try {
      const root = frame();
      let built = false;
      const handle = mountScene(root, () => {
        built = true;
      });
      expect(built).toBe(false);
      expect(root.dataset.motion).toBeUndefined();
      expect(() => handle.seek(0)).toThrow("reduced motion");
      handle.stop();
      root.remove();
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  test("seek() pauses the scene and runs its steps up to the time, also back in time", () => {
    const [, { mountScene }] = modules;
    const root = frame();
    const steps: number[] = [];
    const handle = mountScene(root, (scene) => {
      scene.at(0.5, () => steps.push(0.5));
      scene.at(1.5, () => steps.push(1.5));
      scene.endAt(3);
    });
    handle.play();
    expect(root.dataset.motion).toBe("running");
    handle.seek(1);
    expect(root.dataset.motion).toBe("paused");
    expect(steps).toEqual([0.5]);
    handle.seek(2);
    expect(steps).toEqual([0.5, 1.5]);
    handle.seek(0.6);
    expect(steps).toEqual([0.5, 1.5, 0.5]);
    expect(() => handle.seek(3)).toThrow("Seek to a time from 0 to below 3.00 s");
    handle.stop();
    root.remove();
  });

  test("the runs of the loop keep no old animation, and stop() kills every animation", () => {
    const [{ gsap }, { mountScene }] = modules;
    const root = frame();
    const before = gsap.globalTimeline.getChildren(true, true, true);
    const timelines: gsap.core.Timeline[] = [];
    const handle = mountScene(root, (scene) => {
      timelines.push(scene.timeline);
      const text = scene.stage.querySelector("[data-text]");
      if (!(text instanceof HTMLElement)) throw new Error("The test frame has no text.");
      scene.at(0.5, () => scene.run(gsap.to(text, { x: 10, duration: 0.3 })));
      scene.endAt(1);
    });
    const added = (): number =>
      gsap.globalTimeline.getChildren(true, true, true).filter((child) => !before.includes(child))
        .length;
    handle.play();
    timelines.at(-1)?.progress(1);
    const perRun = added();
    // Each end of a run starts the next run.
    for (let run = 0; run < 5; run += 1) timelines.at(-1)?.progress(1);
    expect(timelines).toHaveLength(7);
    expect(added()).toBe(perRun);

    handle.stop();
    expect(added()).toBe(0);
    expect(root.querySelector("[data-stage]")?.innerHTML).toBe('<p data-text="">Done</p>');
    root.remove();
  });

  test("an old run of the loop leaves no reference, so its animations can go", async () => {
    const [{ gsap }, { mountScene }] = modules;
    const root = frame();
    const runs: WeakRef<gsap.core.Timeline>[] = [];
    let latest: gsap.core.Timeline | undefined;
    const handle = mountScene(root, (scene) => {
      latest = scene.timeline;
      runs.push(new WeakRef(scene.timeline));
      const text = scene.stage.querySelector("[data-text]");
      if (!(text instanceof HTMLElement)) throw new Error("The test frame has no text.");
      scene.at(0.5, () => scene.run(gsap.to(text, { x: 10, duration: 0.3 })));
      scene.endAt(1);
    });
    handle.play();
    for (let run = 0; run < 5; run += 1) latest?.progress(1);
    // A weak reference keeps its target until the current job ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    // The media context of the scene must not record the animations of each run.
    expect(runs[0]?.deref() === undefined).toBe(true);
    handle.stop();
    root.remove();
  });
});
