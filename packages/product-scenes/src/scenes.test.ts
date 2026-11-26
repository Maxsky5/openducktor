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
  "approve-merged",
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
// happy-dom finds the stylesheets with a query of the whole document on each getComputedStyle
// call, and GSAP calls it for each tweened property. The views render no stylesheet, so the query
// gives the stylesheet of this test. This halves the time of the longest scene play.
const STYLESHEET_QUERY = 'style,link[rel="stylesheet"]';
const queryAll = document.querySelectorAll.bind(document);
// SAFETY: happy-dom only iterates the stylesheet result, and an array of style elements iterates
// as its node list does.
document.querySelectorAll = ((selector: string) =>
  selector === STYLESHEET_QUERY ? [designPixel] : queryAll(selector)) as typeof queryAll;
// The document has no layout, so it gives no offset parent. The steps measure an element from
// a positioned ancestor, so the parent element takes its place.
const elementPrototype = HTMLElement.prototype;
const originalOffsetParent = Object.getOwnPropertyDescriptor(elementPrototype, "offsetParent");
Object.defineProperty(elementPrototype, "offsetParent", {
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

afterAll(async () => {
  if (originalOffsetParent)
    Object.defineProperty(elementPrototype, "offsetParent", originalOffsetParent);
  else Reflect.deleteProperty(elementPrototype, "offsetParent");
  await GlobalRegistrator.unregister();
});

/** Renders the static view of the scene `name` to markup. */
async function renderMarkup<Name extends SceneName>(name: Name): Promise<string> {
  const [{ createElement }, { renderToStaticMarkup }, , , { MAC_KEYS }, , { VIEWS }] = modules;
  const views: SceneViewLoaders = VIEWS;
  const View = await views[name]();
  const props: ViewPropsOf<Name> = {
    keys: MAC_KEYS,
    options: optionsOf(name),
  };
  return renderToStaticMarkup(createElement(View, props));
}

/** Parses the markup of the scene `name` and returns its root, out of the document. */
function viewOf(name: SceneName, markup: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const root = holder.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error(`The ${name} view has no root.`);
  return root;
}

type RunCase = {
  label: string;
  name: SceneName;
  chapter: string | null;
  markup: string;
  build: SceneBuilder<string>;
};

// Render each scene once, to markup. Each case parses its own copy, because playing a timeline
// changes its DOM, and the copy lives only during its case, so the document holds one scene at a
// time.
const RUN_CASES: RunCase[] = (
  await Promise.all(
    SCENE_NAMES.map(async (name): Promise<RunCase[]> => {
      const [, , , , , { SCENES }] = modules;
      const entry = SCENES[name];
      const markup = await renderMarkup(name);
      if (!("chapters" in entry)) {
        return [{ label: name, name, chapter: null, markup, build: await entry.timeline() }];
      }
      return Object.entries(await entry.chapters()).map(([chapter, build]) => ({
        label: `${name} (${chapter})`,
        name,
        chapter,
        markup,
        build,
      }));
    }),
  )
).flat();

type RunView = { root: HTMLElement; frame: HTMLElement };

function mountRun({ name, chapter, markup }: RunCase): RunView {
  const view = viewOf(name, markup);
  if (chapter === null) return { root: view, frame: view };
  const root = view.cloneNode(false);
  if (!(root instanceof HTMLElement)) throw new Error(`The ${name} copy has no root.`);

  // A chapter's timeline reads only its own panel.
  const panel = view.querySelector(`[data-chapter-panel="${chapter}"]`)?.cloneNode(true);
  if (!(panel instanceof HTMLElement))
    throw new Error(`The ${name} view has no chapter ${chapter}.`);
  root.append(panel);
  return { root, frame: panel };
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
  test.each(RUN_CASES)("$label builds its timeline from the static view", (run) => {
    const [, , { gsap }, { createScene }] = modules;
    const { root, frame } = mountRun(run);
    const stage = frame.querySelector("[data-stage]");
    if (!(stage instanceof HTMLElement)) throw new Error(`The ${run.label} view has no stage.`);
    const timeline = gsap.timeline({ paused: true });
    document.body.append(root);
    try {
      expect(root.dataset.scene ?? root.dataset.chapters).toBe(run.name);
      run.build(createScene(frame, stage, timeline));
      expect(timeline.duration()).toBeGreaterThan(0);
      // Each change of the run finds its elements when it runs, so the run plays to its end
      // in steps. A change that does not find an element, or finds it with the wrong type,
      // throws here.
      if (!NEEDS_BROWSER.has(run.name)) {
        for (const time of changeTimes(timeline)) timeline.time(time);
        timeline.progress(1);
      }
    } finally {
      timeline.kill();
      root.remove();
    }
  });
});
