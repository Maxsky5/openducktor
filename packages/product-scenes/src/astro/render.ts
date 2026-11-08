// Renders the view of a scene to static HTML for Scene.astro.
import { renderToStaticMarkup } from "react-dom/server";
import type { KeyLabels } from "../replicas/keys";
import type { SceneOptions, SiteSceneName } from "../registry";
import { viewElement } from "../views";
import { ASTRO_VIEWS } from "./views";

export function renderView<Name extends SiteSceneName>(
  name: Name,
  keys: KeyLabels,
  options: SceneOptions<Name>,
): string {
  return renderToStaticMarkup(viewElement(ASTRO_VIEWS, name, { keys, options }));
}
