// Renders the view of a scene to static HTML for Scene.astro.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SceneViews, ViewPropsOf } from "../frame/SceneFrame";
import type { KeyLabels } from "../replicas/keys";
import type { SceneName, SceneOptions } from "../registry";
import { ASTRO_VIEWS } from "./views";

export function renderView<Name extends SceneName>(
  name: Name,
  keys: KeyLabels,
  options: SceneOptions<Name>,
): string {
  const views: SceneViews = ASTRO_VIEWS;
  const props: ViewPropsOf<Name> = { keys, options };
  return renderToStaticMarkup(createElement(views[name], props));
}
