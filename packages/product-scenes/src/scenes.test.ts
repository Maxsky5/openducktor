import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ViewPropsOf } from "./frame/SceneFrame";
import type { SceneBuilder } from "./motion/scene";
import { SCENE_NAMES, type SceneName, type SceneOptions } from "./registry";
import type { SceneViewLoaders } from "./views";

// Each scene of the registry renders its static view, builds its timeline from that markup, and
// plays the timeline to its end. The build and each change find the hooks and the templates of the
// view. The document has no layout, so a browser checks what the play shows. A new scene passes
// this test before a host shows it.

/**
 * The scenes whose changes need the layout or the styles of a browser, such as the place of a
 * board lane or a color of the theme. The test builds them and does not play them.
 */
const NEEDS_BROWSER: ReadonlySet<SceneName> = new Set([
  "hero",
  "runtimes",
  "autopilot",
  "browser",
  "annotate",
  "agent-browser",
]);

/** The scenes that take options from their host. */
type SceneWithOptions = {
  [Name in SceneName]: Record<never, never> extends SceneOptions<Name> ? never : Name;
}[SceneName];

/** The options of the scenes that take options, as the website gives them. */
const OPTIONS = {
  hero: { version: "1.0.0" },
  palette: { version: "1.0.0" },
  chat: { compact: false },
} satisfies { [Name in SceneWithOptions]: SceneOptions<Name> };

/** The options of the scene `name`. A scene without an entry in OPTIONS takes no options. */
function optionsOf<Name extends SceneName>(name: Name): SceneOptions<Name> {
  const options = Object.entries(OPTIONS).find(([scene]) => scene === name)?.[1];
  // SAFETY: OPTIONS holds the options of each scene that takes options.
  return (options ?? {}) as SceneOptions<Name>;
}

// The scene modules load GSAP and React DOM, so they load after the browser globals exist. They
// load once, before the test cases, because the case list holds each chapter of a chapter player.
GlobalRegistrator.register();
// The test loads no stylesheet of the scenes, so it gives each element the design pixel that a
// build reads.
const designPixel = document.createElement("style");
designPixel.textContent = "* { --u: 1px; }";
document.head.append(designPixel);
// The document has no layout, so it gives no offset parent. The steps measure an element from
// a positioned ancestor, so the parent element takes its place.
Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get(this: HTMLElement) {
    return this.parentElement;
  },
});
const modules = await Promise.all([
  import("react"),
  import("react-dom/server"),
  import("./motion/gsap"),
  import("./motion/scene"),
  import("./replicas/keys"),
  import("./registry"),
  import("./views"),
]);

/** One run of a scene: the run of a loop scene, or one chapter of a chapter player. */
type RunCase = { label: string; name: SceneName; chapter: string | null };

const RUN_CASES: RunCase[] = (
  await Promise.all(
    SCENE_NAMES.map(async (name): Promise<RunCase[]> => {
      const [, , , , , { SCENES }, { VIEWS }] = modules;
      const entry = SCENES[name];
      await VIEWS[name]();
      if (!("chapters" in entry)) {
        await entry.timeline();
        return [{ label: name, name, chapter: null }];
      }
      return Object.keys(await entry.chapters()).map((chapter) => ({
        label: `${name} (${chapter})`,
        name,
        chapter,
      }));
    }),
  )
).flat();

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

/** Renders the static view of the scene `name` and returns its root, out of the document. */
async function renderView<Name extends SceneName>(name: Name): Promise<HTMLElement> {
  const [{ createElement }, { renderToStaticMarkup }, , , { MAC_KEYS }, , { VIEWS }] = modules;
  const views: SceneViewLoaders = VIEWS;
  const View = await views[name]();
  const props: ViewPropsOf<Name> = {
    keys: MAC_KEYS,
    options: optionsOf(name),
  };
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(createElement(View, props));
  const root = holder.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error(`The ${name} view has no root.`);
  return root;
}

// The views render before the test cases, as the modules load, so each case only builds and plays
// its run. A view stays out of the document until its case, because each step of happy-dom costs
// more in a larger document.
// A chapter reads only its own panel, so the view of a chapter keeps no other panel.
const VIEW_ROOTS = new Map(
  await Promise.all(
    RUN_CASES.map(async (run) => {
      const root = await renderView(run.name);
      for (const panel of root.querySelectorAll("[data-chapter-panel]")) {
        if (panel.getAttribute("data-chapter-panel") !== run.chapter) panel.remove();
      }
      return [run, root] as const;
    }),
  ),
);

/** The stage of a run and its frame: the view of a loop scene, or the panel of a chapter. */
type Run = { frame: HTMLElement; stage: HTMLElement; build: SceneBuilder<string> };

async function runOf({ name, chapter }: RunCase, root: HTMLElement): Promise<Run> {
  const [, , , , , { SCENES }] = modules;
  const entry = SCENES[name];
  const stageOf = (frame: HTMLElement): HTMLElement => {
    const stage = frame.querySelector("[data-stage]");
    if (!(stage instanceof HTMLElement)) throw new Error(`The ${name} view has no stage.`);
    return stage;
  };
  if (!("chapters" in entry) || chapter === null) {
    if ("chapters" in entry) throw new Error(`The ${name} case names no chapter.`);
    return { frame: root, stage: stageOf(root), build: await entry.timeline() };
  }
  const build = Object.entries(await entry.chapters()).find(([id]) => id === chapter)?.[1];
  const panel = root.querySelector(`[data-chapter-panel="${chapter}"]`);
  if (!build || !(panel instanceof HTMLElement)) {
    throw new Error(`The ${name} view has no chapter ${chapter}.`);
  }
  return { frame: panel, stage: stageOf(panel), build };
}

/**
 * The start time of each change of a run, nested timelines included, in order. The play stops at
 * each of them, so each change starts once, in the order of the run.
 */
function changeTimes(timeline: gsap.core.Timeline): number[] {
  const [, , { gsap }] = modules;
  const starts = (parent: gsap.core.Timeline, offset: number): number[] =>
    parent.getChildren(false, true, true).flatMap((child) => {
      const at = offset + child.startTime();
      return child instanceof gsap.core.Timeline ? [at, ...starts(child, at)] : [at];
    });
  return [...new Set(starts(timeline, 0))].toSorted((a, b) => a - b);
}

describe("each registered scene", () => {
  test.each(RUN_CASES)(
    "$label renders its static view, builds its timeline from it, and plays it",
    async (run) => {
      const [, , { gsap }, { createScene }] = modules;
      const root = VIEW_ROOTS.get(run);
      if (!root) throw new Error(`The ${run.label} case has no view.`);
      document.body.append(root);
      try {
        expect(root.dataset.scene ?? root.dataset.chapters).toBe(run.name);
        const { frame, stage, build } = await runOf(run, root);
        const timeline = gsap.timeline({ paused: true });
        build(createScene(frame, stage, timeline));
        expect(timeline.duration()).toBeGreaterThan(0);
        // Each change of the run finds its elements when it runs, so the run plays to its end
        // in steps. A change that does not find an element, or finds it with the wrong type,
        // throws here.
        if (!NEEDS_BROWSER.has(run.name)) {
          for (const time of changeTimes(timeline)) timeline.time(time);
          timeline.progress(1);
        }
        timeline.kill();
      } finally {
        root.remove();
      }
    },
  );
});
