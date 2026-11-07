// The React view of each scene, loaded on demand, so a host that renders one scene loads only its
// view and its styles.
import type { ComponentType } from "react";
import type { ViewPropsOf } from "./frame/SceneFrame";
import type { SceneName } from "./registry";

/** The loader of the view of each scene. */
export type SceneViewLoaders = {
  [Name in SceneName]: () => Promise<ComponentType<ViewPropsOf<Name>>>;
};

export const VIEWS = {
  hero: async () => (await import("./scenes/hero/view")).HeroView,
  workflow: async () => (await import("./scenes/workflow/view")).WorkflowView,
  palette: async () => (await import("./scenes/palette/view")).PaletteView,
  autopilot: async () => (await import("./scenes/autopilot/view")).AutopilotView,
  runtimes: async () => (await import("./scenes/runtimes/view")).RuntimesView,
  chat: async () => (await import("./scenes/chat/view")).ChatView,
  mcp: async () => (await import("./scenes/mcp/view")).McpView,
  prompts: async () => (await import("./scenes/prompts/view")).PromptsView,
  actions: async () => (await import("./scenes/actions/view")).ActionsView,
  local: async () => (await import("./scenes/local/view")).LocalView,
} as const satisfies SceneViewLoaders;
