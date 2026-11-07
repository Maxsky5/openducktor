import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { tabState, targetIndex } from "./tabs";

const loadMotion = () =>
  Promise.all([
    import("./gsap"),
    import("./scene"),
    import("./text"),
    import("./dom"),
    import("./loop"),
  ]);
let modules: Awaited<ReturnType<typeof loadMotion>>;

// The site tests share one process, so the browser globals exist only while this file runs. The
// motion modules load GSAP, so they load after the globals. The first load of GSAP can exceed
// the 1000 ms test budget on a loaded Windows runner, so it runs once here.
beforeAll(async () => {
  GlobalRegistrator.register();
  modules = await loadMotion();
}, 5_000);
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function motion() {
  const [{ gsap }, { createScene }, text, dom] = modules;
  const stage = document.createElement("div");
  const frame = document.createElement("div");
  frame.append(stage);
  const scene = createScene(frame, stage, gsap.timeline({ paused: true }));
  return { scene, stage, text, dom };
}

describe("tab keys", () => {
  test("the arrows wrap, and Home and End select the first and the last tab", () => {
    expect(targetIndex("ArrowRight", 4, 4)).toBe(0);
    expect(targetIndex("ArrowDown", 1, 4)).toBe(2);
    expect(targetIndex("ArrowLeft", 0, 4)).toBe(4);
    expect(targetIndex("ArrowUp", 3, 4)).toBe(2);
    expect(targetIndex("Home", 3, 4)).toBe(0);
    expect(targetIndex("End", 1, 4)).toBe(4);
    expect(targetIndex("Enter", 1, 4)).toBeUndefined();
  });

  test("the tabs before the current one read as done", () => {
    expect([0, 1, 2].map((index) => tabState(index, 1))).toEqual(["done", "current", "next"]);
  });
});

describe("scene.run", () => {
  test("adds the animation at the time of its change, also after a long tick", async () => {
    const [{ gsap }, , , , { createLoop }] = modules;
    const frame = document.createElement("div");
    frame.dataset.scene = "test";
    frame.innerHTML = "<div data-stage><p>Done</p></div>";
    document.body.append(frame);
    const timelines: gsap.core.Timeline[] = [];
    let tween: gsap.core.Tween | undefined;
    const loop = createLoop(frame, (scene) => {
      timelines.push(scene.timeline);
      scene.at(1, () => {
        tween = gsap.to({ x: 0 }, { x: 1, duration: 0.4 });
        scene.run(tween);
      });
      scene.endAt(1.5);
    });
    const [timeline] = timelines;
    if (!timeline) throw new Error("The loop did not build a run.");
    try {
      // A slow frame moves the playhead from 0.9 s to 1.4 s, past the change at 1 s, in one tick.
      timeline.time(0.9);
      timeline.time(1.4);
      expect(tween?.startTime()).toBe(1);
      expect(timeline.duration()).toBe(1.5);
      // The run ends and the next one starts. A run that grew would throw in a microtask.
      timeline.time(1.5);
      await Promise.resolve();
      expect(timelines).toHaveLength(2);
    } finally {
      loop.stop();
      frame.remove();
    }
  });

  test("fails outside a change of scene.at", () => {
    const [{ gsap }] = modules;
    const { scene } = motion();
    expect(() => scene.run(gsap.to({}, { duration: 1 }))).toThrow("only in a change of scene.at");
  });

  test("runNow adds a change that the browser reports later at the playhead", () => {
    const [{ gsap }] = modules;
    const { scene } = motion();
    scene.endAt(4);
    scene.timeline.time(1.5);
    const glide = gsap.to({}, { duration: 0.5 });
    scene.runNow(glide);
    expect(glide.startTime()).toBe(1.5);
  });
});

describe("stream", () => {
  test("hides the message at build time and shows every word by its end time", async () => {
    const { scene, stage, text } = motion();
    stage.innerHTML = "<p>I saved the plan.</p><p>The hook opens search.</p>";
    const end = text.stream(scene, stage, 0.5);
    const words = [...stage.querySelectorAll("p > span")];
    expect(words.map((word) => word.textContent).join("")).toBe(
      "I saved the plan.The hook opens search.",
    );
    expect(words.every((word) => word instanceof HTMLElement && word.hidden)).toBe(true);
    expect(end).toBeGreaterThan(0.5);
    scene.timeline.progress(1);
    expect(stage.querySelectorAll("[hidden]")).toHaveLength(0);
  });

  test("streams the same text with the same rhythm in every loop", async () => {
    const first = motion();
    const second = motion();
    for (const { stage } of [first, second]) stage.innerHTML = "<p>Search opens with Cmd+K.</p>";
    expect(first.text.stream(first.scene, first.stage, 0)).toBe(
      second.text.stream(second.scene, second.stage, 0),
    );
  });
});

describe("typeText", () => {
  test("empties the element at build time and types the whole text by its end time", async () => {
    const { scene, stage, text } = motion();
    stage.textContent = "old";
    const shown: string[] = [];
    const end = text.typeText(scene, stage, "Cmd+K", 1, {
      charsPerSecond: 10,
      onText: (value) => shown.push(value),
    });
    expect(stage.textContent).toBe("");
    expect(end).toBeCloseTo(1.5);
    scene.timeline.progress(1);
    expect(stage.textContent).toBe("Cmd+K");
    expect(shown.at(-1)).toBe("Cmd+K");
  });
});

describe("typed queries", () => {
  test("fail loudly when the markup lost an element or changed its kind", async () => {
    const { stage, dom } = motion();
    stage.innerHTML = '<span data-wait="1.5"></span><svg class="icon"></svg>';
    expect(() => dom.must(stage, ".missing")).toThrow("Markup is missing .missing.");
    expect(() => dom.must(stage, ".icon")).toThrow("but not as HTMLElement");
    const line = dom.must(stage, "[data-wait]");
    expect(dom.numberData(line, "wait")).toBe(1.5);
    line.dataset.wait = "soon";
    expect(() => dom.numberData(line, "wait")).toThrow("no number in data-wait");
  });
});
