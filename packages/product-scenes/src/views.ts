// The React view of each scene, loaded on demand, so a host that renders one scene loads only its
// view and its styles.
import { type ComponentType, createElement, type ReactElement } from "react";
import type { SceneViews, ViewPropsOf } from "./frame/SceneFrame";
import type { SceneName } from "./registry";

/** Renders the view of the scene `name` from a map of static views. */
export function viewElement<Names extends SceneName, Name extends Names>(
  views: SceneViews<Names>,
  name: Name,
  props: ViewPropsOf<Name>,
): ReactElement {
  const view: ComponentType<ViewPropsOf<Name>> = views[name];
  return createElement(view, props);
}

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
  composer: async () => (await import("./scenes/composer/view")).ComposerView,
  queue: async () => (await import("./scenes/queue/view")).QueueView,
  question: async () => (await import("./scenes/question/view")).QuestionView,
  terminal: async () => (await import("./scenes/terminal/view")).TerminalView,
  browser: async () => (await import("./scenes/browser/view")).BrowserView,
  annotate: async () => (await import("./scenes/annotate/view")).AnnotateView,
  "agent-browser": async () => (await import("./scenes/agent-browser/view")).AgentBrowserView,
  "new-session": async () => (await import("./scenes/new-session/view")).NewSessionView,
  fork: async () => (await import("./scenes/fork/view")).ForkView,
  "import-session": async () => (await import("./scenes/import-session/view")).ImportSessionView,
  "ci-checks": async () => (await import("./scenes/ci-checks/view")).CiChecksView,
  "pr-comments": async () => (await import("./scenes/pr-comments/view")).PrCommentsView,
  "git-conflict": async () => (await import("./scenes/git-conflict/view")).GitConflictView,
  "mobile-pair": async () => (await import("./scenes/mobile-pair/view")).MobilePairView,
  "mobile-needs-you": async () =>
    (await import("./scenes/mobile-needs-you/view")).MobileNeedsYouView,
  "mobile-steer": async () => (await import("./scenes/mobile-steer/view")).MobileSteerView,
  "mobile-diff-comment": async () =>
    (await import("./scenes/mobile-diff-comment/view")).MobileDiffCommentView,
  "mobile-start-builder": async () =>
    (await import("./scenes/mobile-start-builder/view")).MobileStartBuilderView,
  "mobile-approve": async () => (await import("./scenes/mobile-approve/view")).MobileApproveView,
  "goal-mode": async () => (await import("./scenes/goal-mode/view")).GoalModeView,
  "goal-command": async () => (await import("./scenes/goal-command/view")).GoalCommandView,
} as const satisfies SceneViewLoaders;
