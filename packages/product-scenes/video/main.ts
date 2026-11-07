// The page of the video renderer. It renders one loop scene from its query, scales the scene to
// fit the video frame, and mounts the timeline, which stays paused. The renderer then shows each
// frame with `window.__sceneVideo.seek`. Query: `scene`, `width`, and `height` are necessary;
// `theme` (light or dark, default light), `keys` (mac or pc, default mac), and `version` (default
// the version of the repository) are optional.
import "../styles/index.css";
import "./page.css";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import rootPackage from "../../../package.json";
import type { SceneTheme, ViewPropsOf } from "../src/frame/SceneFrame";
import { must } from "../src/motion/dom";
import { mountScene, type SceneHandle } from "../src/motion/mount";
import { type KeyLabels, MAC_KEYS, PC_KEYS } from "../src/replicas/keys";
import { type LoopSceneName, SCENES, type SceneOptions } from "../src/registry";
import { type SceneViewLoaders, VIEWS } from "../src/views";
import { videoScene } from "./scenes";

/** The empty space around the scene, as a part of the short side of the video. */
const MARGIN = 0.06;

const THEMES = new Map<string, SceneTheme>([
  ["light", "light"],
  ["dark", "dark"],
]);
const KEYS = new Map<string, KeyLabels>([
  ["mac", MAC_KEYS],
  ["pc", PC_KEYS],
]);

const query = new URLSearchParams(location.search);

function param(name: string, fallback?: string): string {
  const value = query.get(name) ?? fallback;
  if (value === undefined) throw new Error(`Add ${name} to the query of the page.`);
  return value;
}

function choice<T>(name: string, choices: ReadonlyMap<string, T>, fallback: string): T {
  const value = param(name, fallback);
  const chosen = choices.get(value);
  if (chosen === undefined) {
    throw new Error(`Set ${name} to ${[...choices.keys()].join(" or ")}, not ${value}.`);
  }
  return chosen;
}

function pixels(name: string): number {
  const value = Number(param(name));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Set ${name} to a pixel count.`);
  return value;
}

/** The options of each loop scene. */
type OptionsByScene = { [Name in LoopSceneName]: SceneOptions<Name> };

/** The options of each scene. The website gives the same options. */
function optionsOf(version: string): OptionsByScene {
  return {
    hero: { version },
    palette: { version },
    runtimes: {},
    autopilot: {},
    chat: {},
    mcp: {},
    prompts: {},
    actions: {},
    local: {},
  };
}

/** Renders the static view of the scene in `parent` and returns the root of the scene. */
async function renderView<Name extends LoopSceneName>(
  name: Name,
  props: ViewPropsOf<Name>,
  parent: HTMLElement,
): Promise<HTMLElement> {
  const views: SceneViewLoaders = VIEWS;
  const View = await views[name]();
  parent.innerHTML = renderToStaticMarkup(createElement(View, props));
  return must(parent, "[data-scene]");
}

/** Waits for the fonts of the scenes, so the first frame and the layout use them. */
async function loadFonts(): Promise<void> {
  const faces = [
    '16px "Space Grotesk Variable"',
    '400 16px "IBM Plex Mono"',
    '500 16px "IBM Plex Mono"',
  ];
  const loaded = await Promise.all(faces.map((face) => document.fonts.load(face)));
  const missing = faces.filter((_, index) => loaded[index]?.length === 0);
  if (missing.length > 0) throw new Error(`The page has no font face for ${missing.join(", ")}.`);
}

/** The scene time at which each CSS animation and transition of the scene started. */
const births = new WeakMap<Animation, number>();

/**
 * Moves the CSS animations and transitions of the scene, such as the status rings and the caret,
 * to the scene time `time`. They do not follow GSAP, so each one stays paused and gets its time from
 * the frame clock. A frame then has the same pixels in each run.
 */
function holdCssMotion(time: number): void {
  for (const animation of document.getAnimations()) {
    const birth = births.get(animation) ?? time;
    births.set(animation, birth);
    animation.pause();
    animation.currentTime = (time - birth) * 1000;
  }
}

async function start(): Promise<SceneHandle> {
  const name = videoScene(param("scene"));
  const width = pixels("width");
  const height = pixels("height");
  const theme = choice("theme", THEMES, "light");
  const options = optionsOf(param("version", rootPackage.version))[name];
  const design = SCENES[name].size;
  const margin = Math.round(MARGIN * Math.min(width, height));
  const scale = Math.min(
    (width - 2 * margin) / design.width,
    (height - 2 * margin) / design.height,
  );

  document.documentElement.dataset.theme = theme;
  const frame = document.createElement("div");
  frame.className = "video-frame";
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  const fit = document.createElement("div");
  fit.className = "video-fit";
  fit.style.width = `${design.width}px`;
  fit.style.transform = `translate(-50%, -50%) scale(${scale})`;
  frame.append(fit);
  document.body.append(frame);

  const props: ViewPropsOf<typeof name> = { theme, keys: choice("keys", KEYS, "mac"), options };
  const [root, build] = await Promise.all([
    renderView(name, props, fit),
    SCENES[name].timeline(),
    loadFonts(),
  ]);
  return mountScene(root, build);
}

let mounted: SceneHandle | undefined;
window.__sceneVideo = {
  ready: start().then((handle) => {
    mounted = handle;
    return handle.duration();
  }),
  seek: (time) => {
    if (!mounted) throw new Error("Wait for ready before the first seek.");
    mounted.seek(time);
    holdCssMotion(time);
  },
};
