// The page of the video renderer. It renders one loop scene or one film from its query, and mounts
// its timeline, which stays paused. A scene scales to fit the video frame. The renderer then shows
// each frame with `window.__sceneVideo.seek`. Query: `scene` with `width` and `height`, or `film`;
// `theme` (light or dark, default light), `keys` (mac or pc, default mac), `version` (default
// the version of the repository), and `stage` (the stage width in CSS pixels, default the design
// width of the scene) are optional. With `preview`, the page plays in real time.
import "../styles/index.css";
import "./page.css";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import rootPackage from "../../../package.json";
import type { SceneTheme, ViewPropsOf } from "../src/frame/SceneFrame";
import { must } from "../src/motion/dom";
import { gsap } from "../src/motion/gsap";
import { mountScene, type SceneHandle, stepForward } from "../src/motion/mount";
import { type KeyLabels, MAC_KEYS, PC_KEYS } from "../src/replicas/keys";
import { type LoopSceneName, SCENES, type SceneOptions } from "../src/registry";
import { type SceneViewLoaders, VIEWS } from "../src/views";
import { startFilm } from "./film";
import { startPreview } from "./preview";
import { filmName, type SceneVideo, videoScene } from "./scenes";

// A tween of GSAP moves its element with a 3D transform by default, which gives the element its
// own layer while it moves. A video renders each frame by itself, so 2D transforms keep the text
// of a moving element sharp, with no change of sharpness when the tween ends.
gsap.config({ force3D: false });

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
    chat: { compact: false },
    mcp: {},
    prompts: {},
    actions: {},
    local: {},
    composer: {},
    queue: {},
    question: {},
    terminal: {},
    browser: {},
    annotate: {},
    "agent-browser": {},
    "new-session": {},
    fork: {},
    "import-session": {},
    "ci-checks": {},
    "pr-comments": {},
    "git-conflict": {},
    "mobile-pair": {},
    "mobile-needs-you": {},
    "mobile-question": {},
    "mobile-steer": {},
    "mobile-diff-comment": {},
    "mobile-start-builder": {},
    "mobile-approve": {},
    "mobile-pull-request": {},
    "goal-mode": {},
    "goal-command": {},
    artifacts: {},
    gitlab: {},
    "approve-merged": {},
    "keyboard-shortcuts": {},
    processes: {},
    usage: {},
    "workflow-editor": {},
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

/** A mounted scene or film, as the renderer drives it. */
type Mounted = {
  duration: number;
  seek: (time: number) => void;
  moving: (from: number, to: number) => boolean;
};

async function startScene(): Promise<Mounted> {
  const name = videoScene(param("scene"));
  const width = pixels("width");
  const height = pixels("height");
  const theme = choice("theme", THEMES, "light");
  const options = optionsOf(param("version", rootPackage.version))[name];
  // A narrower stage, such as `stage=390`, shows the phone layout of a scene in a preview.
  const stage = query.has("stage") ? pixels("stage") : undefined;
  const design = stage ? { width: stage, height: height - 2 * MARGIN * height } : SCENES[name].size;
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
  const handle: SceneHandle = mountScene(root, build);
  return { duration: handle.duration(), seek: handle.seek, moving: () => false };
}

async function startFilmPage(value: string): Promise<Mounted> {
  const theme = choice("theme", THEMES, "light");
  document.documentElement.dataset.theme = theme;
  const parent = document.createElement("div");
  document.body.append(parent);
  return startFilm(filmName(value), theme, choice("keys", KEYS, "mac"), parent, loadFonts());
}

const film = query.get("film");
let mounted: Mounted | undefined;
const ready = (film === null ? startScene() : startFilmPage(film)).then((handle) => {
  mounted = handle;
  return handle.duration;
});
/** The time of the frame that shows. */
let shown = 0;
const video: SceneVideo = {
  ready,
  moving: (from, to) => {
    if (!mounted) throw new Error("Wait for ready before the page tells a camera move.");
    return mounted.moving(from, to);
  },
  seek: (time) => {
    if (!mounted) throw new Error("Wait for ready before the first seek.");
    const { seek } = mounted;
    // The page holds the CSS motion after each frame step of a long seek, such as for a still
    // image, so a transition that starts during the seek starts at its own time.
    const show = (at: number): void => {
      seek(at);
      holdCssMotion(at);
    };
    if (time <= shown) show(time);
    stepForward(shown, time, show);
    shown = time;
  },
};
window.__sceneVideo = video;
if (query.has("preview")) void ready.then((duration) => startPreview(video, duration, query));
