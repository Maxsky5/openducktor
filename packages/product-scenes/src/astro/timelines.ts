// The timeline of each scene of the website for the page script of the Astro entry. The site shows
// every scene on one page, so static imports load the timelines with the page script, without a
// loader for each scene. The maps hold only the scenes of the website. A host that renders one
// scene uses the lazy loaders of the registry instead.
import type { SceneBuilder } from "../motion/scene";
import type { ChapterBuilders, ChapterSceneName, LoopSceneName } from "../registry";
import type { SiteSceneName } from "./views";
import { build as actions } from "../scenes/actions/timeline";
import { build as autopilot } from "../scenes/autopilot/timeline";
import { build as chat } from "../scenes/chat/timeline";
import { build as goalMode } from "../scenes/goal-mode/timeline";
import { build as hero } from "../scenes/hero/timeline";
import { build as local } from "../scenes/local/timeline";
import { build as mcp } from "../scenes/mcp/timeline";
import { build as palette } from "../scenes/palette/timeline";
import { build as processes } from "../scenes/processes/timeline";
import { build as prompts } from "../scenes/prompts/timeline";
import { build as runtimes } from "../scenes/runtimes/timeline";
import { build as usage } from "../scenes/usage/timeline";
import { build as workflow } from "../scenes/workflow/timeline";
import { build as workflowEditor } from "../scenes/workflow-editor/timeline";

export const ASTRO_TIMELINES = {
  hero,
  palette,
  autopilot,
  runtimes,
  chat,
  "goal-mode": goalMode,
  mcp,
  prompts,
  actions,
  local,
  usage,
  processes,
  "workflow-editor": workflowEditor,
} as const satisfies Record<Extract<LoopSceneName, SiteSceneName>, SceneBuilder<string>>;

/** The chapter builders of each chapter player. */
export const ASTRO_CHAPTERS = {
  workflow,
} as const satisfies Record<Extract<ChapterSceneName, SiteSceneName>, ChapterBuilders>;
