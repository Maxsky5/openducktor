// The React view of each scene of the website for the Astro entry. The build renders them at build
// time, so static imports keep the styles of the scenes in the stylesheet of the page, without one
// more stylesheet request for each scene. The map holds only the scenes of the website, so the
// website loads no style of a scene that only the documentation shows. No page script imports
// this module.
import type { SceneViews } from "../frame/SceneFrame";
import type { SiteSceneName } from "../registry";
import { ActionsView } from "../scenes/actions/view";
import { AutopilotView } from "../scenes/autopilot/view";
import { ChatView } from "../scenes/chat/view";
import { HeroView } from "../scenes/hero/view";
import { LocalView } from "../scenes/local/view";
import { McpView } from "../scenes/mcp/view";
import { PaletteView } from "../scenes/palette/view";
import { PromptsView } from "../scenes/prompts/view";
import { RuntimesView } from "../scenes/runtimes/view";
import { WorkflowView } from "../scenes/workflow/view";

export const ASTRO_VIEWS = {
  hero: HeroView,
  workflow: WorkflowView,
  palette: PaletteView,
  autopilot: AutopilotView,
  runtimes: RuntimesView,
  chat: ChatView,
  mcp: McpView,
  prompts: PromptsView,
  actions: ActionsView,
  local: LocalView,
} as const satisfies SceneViews<SiteSceneName>;
