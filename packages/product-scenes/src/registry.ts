// The scenes of the package: the name of each scene, the size of its product window, and the
// loader of its timeline. Each timeline loads in its own chunk, so a page loads only the scenes
// that it shows. This module loads no view, no React, and no text, so a page script can import it.
// The React views load from views.ts.
import type { SceneBuilder } from "./motion/scene";
import type { ChatOptions } from "./scenes/chat/view";
import type { HeroOptions } from "./scenes/hero/view";
import type { PaletteOptions } from "./scenes/palette/view";

/** The names of the scenes, in the order of the site. */
export const SCENE_NAMES = [
  "hero",
  "workflow",
  "palette",
  "runtimes",
  "autopilot",
  "chat",
  "mcp",
  "prompts",
  "actions",
  "local",
  "composer",
  "queue",
  "question",
  "terminal",
  "browser",
  "annotate",
  "agent-browser",
  "new-session",
  "fork",
  "import-session",
  "ci-checks",
  "pr-comments",
  "git-conflict",
  "mobile-pair",
  "mobile-needs-you",
  "mobile-steer",
  "mobile-diff-comment",
  "mobile-start-builder",
  "mobile-approve",
  "goal-mode",
  "goal-command",
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

/**
 * The scenes that the website renders. The Astro entry bundles only these, so the website loads
 * no style and no timeline of a scene that only the documentation shows.
 */
const SITE_SCENE_NAMES = [
  "hero",
  "workflow",
  "palette",
  "runtimes",
  "autopilot",
  "chat",
  "mcp",
  "prompts",
  "actions",
  "local",
] as const satisfies readonly SceneName[];
export type SiteSceneName = (typeof SITE_SCENE_NAMES)[number];

/**
 * The scenes that play their steps one after the other in tabs, such as the workflow. The other
 * scenes play in a loop.
 */
export const CHAPTER_SCENE_NAMES = ["workflow"] as const satisfies readonly SceneName[];
export type ChapterSceneName = (typeof CHAPTER_SCENE_NAMES)[number];

/** The scenes that play in a loop. A host with a handle, such as the React `Scene`, mounts them. */
export type LoopSceneName = Exclude<SceneName, ChapterSceneName>;

/** The builders of a chapter player: one builder for each chapter, by the id of the chapter. */
export type ChapterBuilders = Readonly<Record<string, SceneBuilder<string>>>;

/** The size of the product window at full scale, in design pixels. */
type SceneSize = { width: number; height: number };

/** A loop scene: its size and the loader of the builder of each run of its loop. */
export type SceneEntry = { size: SceneSize; timeline: () => Promise<SceneBuilder<string>> };

/** A chapter player: its size and the loader of the builders of its chapters. */
export type ChapterEntry = { size: SceneSize; chapters: () => Promise<ChapterBuilders> };

export const SCENES = {
  hero: {
    size: { width: 1440, height: 700 },
    timeline: async () => (await import("./scenes/hero/timeline")).build,
  },
  workflow: {
    size: { width: 1440, height: 780 },
    chapters: async () => (await import("./scenes/workflow/timeline")).build,
  },
  palette: {
    size: { width: 1440, height: 740 },
    timeline: async () => (await import("./scenes/palette/timeline")).build,
  },
  autopilot: {
    size: { width: 1328, height: 576 },
    timeline: async () => (await import("./scenes/autopilot/timeline")).build,
  },
  runtimes: {
    size: { width: 760, height: 620 },
    timeline: async () => (await import("./scenes/runtimes/timeline")).build,
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
    size: { width: 960, height: 540 },
    timeline: async () => (await import("./scenes/new-session/timeline")).build,
  },
  fork: {
    size: { width: 960, height: 540 },
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
} as const satisfies {
  [Name in SceneName]: Name extends ChapterSceneName ? ChapterEntry : SceneEntry;
};

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
