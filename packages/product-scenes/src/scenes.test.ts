import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ViewPropsOf } from "./frame/SceneFrame";
import type { SceneBuilder } from "./motion/scene";
import { SCENE_NAMES, type SceneName, type SceneOptions } from "./registry";
import type { SceneViewLoaders } from "./views";

// Each scene of the registry renders its static view and builds its timeline from that markup. The
// build finds each hook and template of the view. The steps of a scene measure the layout, so a
// browser checks the play itself. A new scene passes this test before a host shows it.

/** The options of each scene. */
type OptionsByScene = { [Name in SceneName]: SceneOptions<Name> };

/** The options of each scene, as the website gives them. */
const OPTIONS: OptionsByScene = {
  hero: { version: "1.0.0" },
  workflow: {},
  palette: { version: "1.0.0" },
  runtimes: {},
  autopilot: {},
  chat: {},
  mcp: {},
  prompts: {},
  actions: {},
  local: {},
};

// The scene modules load GSAP and React DOM, so they load after the browser globals exist. The
// first load of the views and the timelines can exceed the test budget, so they load once here.
const loadModules = () =>
  Promise.all([
    import("react"),
    import("react-dom/server"),
    import("./motion/gsap"),
    import("./motion/scene"),
    import("./replicas/keys"),
    import("./registry"),
    import("./views"),
  ]);
let modules: Awaited<ReturnType<typeof loadModules>>;

beforeAll(async () => {
  GlobalRegistrator.register();
  // The test loads no stylesheet of the scenes, so it gives each element the design pixel that a
  // build reads.
  const style = document.createElement("style");
  style.textContent = "* { --u: 1px; }";
  document.head.append(style);
  modules = await loadModules();
  const [, , , , , { SCENES }, { VIEWS }] = modules;
  await Promise.all(
    SCENE_NAMES.map((name) => {
      const entry = SCENES[name];
      return Promise.all([
        VIEWS[name](),
        "chapters" in entry ? entry.chapters() : entry.timeline(),
      ]);
    }),
  );
}, 10_000);
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

/** Renders the static view of the scene `name` in the document and returns its root. */
async function renderView<Name extends SceneName>(name: Name): Promise<HTMLElement> {
  const [{ createElement }, { renderToStaticMarkup }, , , { MAC_KEYS }, , { VIEWS }] = modules;
  const views: SceneViewLoaders = VIEWS;
  const View = await views[name]();
  const props: ViewPropsOf<Name> = {
    keys: MAC_KEYS,
    options: OPTIONS[name],
  };
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(createElement(View, props));
  const root = holder.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error(`The ${name} view has no root.`);
  document.body.append(root);
  return root;
}

/** The stages of a view and the frame of each: one for a loop scene, one for each chapter. */
type Run = { frame: HTMLElement; stage: HTMLElement; build: SceneBuilder<string> };

async function runsOf(name: SceneName, root: HTMLElement): Promise<Run[]> {
  const [, , , , , { SCENES }] = modules;
  const entry = SCENES[name];
  const stageOf = (frame: HTMLElement): HTMLElement => {
    const stage = frame.querySelector("[data-stage]");
    if (!(stage instanceof HTMLElement)) throw new Error(`The ${name} view has no stage.`);
    return stage;
  };
  if (!("chapters" in entry)) {
    return [{ frame: root, stage: stageOf(root), build: await entry.timeline() }];
  }
  return Object.entries(await entry.chapters()).map(([id, build]) => {
    const panel = root.querySelector(`[data-chapter-panel="${id}"]`);
    if (!(panel instanceof HTMLElement)) throw new Error(`The ${name} view has no panel ${id}.`);
    return { frame: panel, stage: stageOf(panel), build };
  });
}

describe("each registered scene", () => {
  test.each([...SCENE_NAMES])(
    "%s renders its static view and builds its timeline from it",
    async (name) => {
      const [, , { gsap }, { createScene }] = modules;
      const root = await renderView(name);
      try {
        expect(root.dataset.scene ?? root.dataset.chapters).toBe(name);
        const runs = await runsOf(name, root);
        expect(runs.length).toBeGreaterThan(0);
        for (const { frame, stage, build } of runs) {
          const markup = stage.innerHTML;
          const timeline = gsap.timeline({ paused: true });
          build(createScene(frame, stage, timeline));
          expect(timeline.duration()).toBeGreaterThan(0);
          timeline.kill();
          stage.innerHTML = markup;
        }
      } finally {
        root.remove();
      }
    },
  );
});
