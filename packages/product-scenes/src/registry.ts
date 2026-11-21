// The scenes of the package: the name of each scene, the size of its product window, and the
// loader of its timeline. Each timeline loads in its own chunk, so a page loads only the scenes
// that it shows. This module loads no view, no React, and no text, so a page script can import it.
// The React views load from views.ts.
import { TOUR_SCENES } from "./tour-scenes";
import type { SceneBuilder } from "./motion/scene";
import type { ChatOptions } from "./scenes/chat/view";
import type { HeroOptions } from "./scenes/hero/view";
import type { PaletteOptions } from "./scenes/palette/view";

/** The builders of a chapter player: one builder for each chapter, by the id of the chapter. */
export type ChapterBuilders = Readonly<Record<string, SceneBuilder<string>>>;

/** The size of the product window at full scale, in design pixels. */
type SceneSize = { width: number; height: number };

/** A loop scene: its size and the loader of the builder of each run of its loop. */
type SceneEntry = { size: SceneSize; timeline: () => Promise<SceneBuilder<string>> };

/** A chapter player: its size and the loader of the builders of its chapters. */
type ChapterEntry = { size: SceneSize; chapters: () => Promise<ChapterBuilders> };

export const SCENES = {
  hero: TOUR_SCENES.hero,
  workflow: {
    size: { width: 1440, height: 780 },
    chapters: async () => (await import("./scenes/workflow/timeline")).build,
  },
  palette: TOUR_SCENES.palette,
  runtimes: {
    size: { width: 760, height: 620 },
    timeline: async () => (await import("./scenes/runtimes/timeline")).build,
  },
  autopilot: {
    size: { width: 1328, height: 576 },
    timeline: async () => (await import("./scenes/autopilot/timeline")).build,
  },
  chat: {
    size: { width: 740, height: 600 },
    timeline: async () => (await import("./scenes/chat/timeline")).build,
  },
  mcp: {
    size: { width: 800, height: 420 },
    timeline: async () => (await import("./scenes/mcp/timeline")).build,
  },
  prompts: {
    size: { width: 760, height: 660 },
    timeline: async () => (await import("./scenes/prompts/timeline")).build,
  },
  actions: {
    size: { width: 1440, height: 760 },
    timeline: async () => (await import("./scenes/actions/timeline")).build,
  },
  local: {
    size: { width: 576, height: 720 },
    timeline: async () => (await import("./scenes/local/timeline")).build,
  },
  composer: {
    size: { width: 760, height: 520 },
    timeline: async () => (await import("./scenes/composer/timeline")).build,
  },
  queue: {
    size: { width: 640, height: 470 },
    timeline: async () => (await import("./scenes/queue/timeline")).build,
  },
  question: {
    size: { width: 1016, height: 700 },
    timeline: async () => (await import("./scenes/question/timeline")).build,
  },
  terminal: {
    size: { width: 880, height: 470 },
    timeline: async () => (await import("./scenes/terminal/timeline")).build,
  },
  browser: {
    size: { width: 1040, height: 512 },
    timeline: async () => (await import("./scenes/browser/timeline")).build,
  },
  annotate: {
    size: { width: 1040, height: 512 },
    timeline: async () => (await import("./scenes/annotate/timeline")).build,
  },
  "agent-browser": {
    size: { width: 1040, height: 512 },
    timeline: async () => (await import("./scenes/agent-browser/timeline")).build,
  },
  "new-session": {
    size: { width: 960, height: 936 },
    timeline: async () => (await import("./scenes/new-session/timeline")).build,
  },
  fork: {
    size: { width: 960, height: 704 },
    timeline: async () => (await import("./scenes/fork/timeline")).build,
  },
  "import-session": {
    size: { width: 960, height: 660 },
    timeline: async () => (await import("./scenes/import-session/timeline")).build,
  },
  "ci-checks": {
    size: { width: 960, height: 500 },
    timeline: async () => (await import("./scenes/ci-checks/timeline")).build,
  },
  "pr-comments": {
    size: { width: 960, height: 540 },
    timeline: async () => (await import("./scenes/pr-comments/timeline")).build,
  },
  "git-conflict": {
    size: { width: 960, height: 520 },
    timeline: async () => (await import("./scenes/git-conflict/timeline")).build,
  },
  "mobile-pair": {
    size: { width: 1185, height: 980 },
    timeline: async () => (await import("./scenes/mobile-pair/timeline")).build,
  },
  "mobile-needs-you": {
    size: { width: 920, height: 860 },
    timeline: async () => (await import("./scenes/mobile-needs-you/timeline")).build,
  },
  "mobile-steer": {
    size: { width: 920, height: 860 },
    timeline: async () => (await import("./scenes/mobile-steer/timeline")).build,
  },
  "mobile-diff-comment": {
    size: { width: 920, height: 860 },
    timeline: async () => (await import("./scenes/mobile-diff-comment/timeline")).build,
  },
  "mobile-start-builder": {
    size: { width: 920, height: 860 },
    timeline: async () => (await import("./scenes/mobile-start-builder/timeline")).build,
  },
  "mobile-approve": {
    size: { width: 920, height: 860 },
    timeline: async () => (await import("./scenes/mobile-approve/timeline")).build,
  },
  "goal-mode": {
    size: { width: 1440, height: 780 },
    timeline: async () => (await import("./scenes/goal-mode/timeline")).build,
  },
  "goal-command": {
    size: { width: 640, height: 500 },
    timeline: async () => (await import("./scenes/goal-command/timeline")).build,
  },
  "mobile-question": {
    size: { width: 920, height: 860 },
    timeline: async () => (await import("./scenes/mobile-question/timeline")).build,
  },
  "mobile-pull-request": {
    size: { width: 920, height: 860 },
    timeline: async () => (await import("./scenes/mobile-pull-request/timeline")).build,
  },
  artifacts: {
    size: { width: 960, height: 600 },
    timeline: async () => (await import("./scenes/artifacts/timeline")).build,
  },
  gitlab: {
    size: { width: 1060, height: 730 },
    timeline: async () => (await import("./scenes/gitlab/timeline")).build,
  },
  "approve-merged": {
    size: { width: 1040, height: 640 },
    timeline: async () => (await import("./scenes/approve-merged/timeline")).build,
  },
  "keyboard-shortcuts": {
    size: { width: 1040, height: 704 },
    timeline: async () => (await import("./scenes/keyboard-shortcuts/timeline")).build,
  },
} as const satisfies Record<string, SceneEntry | ChapterEntry>;

export type SceneName = keyof typeof SCENES;
export const SCENE_NAMES =
  // SAFETY: The registry is a closed object literal. Its enumerable keys are its scene names.
  Object.keys(SCENES) as readonly SceneName[];

/** The scenes that play their steps one after the other in tabs. */
export type ChapterSceneName = {
  [Name in SceneName]: (typeof SCENES)[Name] extends ChapterEntry ? Name : never;
}[SceneName];

export const isChapterScene = (name: SceneName): name is ChapterSceneName =>
  "chapters" in SCENES[name];

/** The scenes that play in a loop. A host with a handle, such as the React `Scene`, mounts them. */
export type LoopSceneName = Exclude<SceneName, ChapterSceneName>;

/** The options of the scenes that take more from their host than the theme and the keys. */
type OptionsOf = { hero: HeroOptions; palette: PaletteOptions; chat: ChatOptions };

/** The options that a host gives to the scene `Name`. A scene without options takes none. */
export type SceneOptions<Name extends SceneName> = Name extends keyof OptionsOf
  ? OptionsOf[Name]
  : Record<never, never>;

/**
 * The `options` prop of a host component for the scene `Name`. A scene with options requires
 * them.
 */
export type SceneOptionsProp<Name extends SceneName> = Name extends keyof OptionsOf
  ? { options: OptionsOf[Name] }
  : { options?: never };
