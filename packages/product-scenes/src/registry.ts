// The scenes of the package: the name of each scene, the size of its product window, and the
// loader of its timeline. Each timeline loads in its own chunk, so a page loads only the scenes
// that it shows. This module loads no view, no React, and no text, so a page script can import it.
// The React views load from views.ts.
import type { SceneBuilder } from "./motion/scene";
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
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

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
} as const satisfies {
  [Name in SceneName]: Name extends ChapterSceneName ? ChapterEntry : SceneEntry;
};

/** The options of the scenes that take more from their host than the theme and the keys. */
type OptionsOf = { hero: HeroOptions; palette: PaletteOptions };

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
