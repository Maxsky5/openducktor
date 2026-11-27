// Renders the view of a scene to static HTML for Scene.astro.
import { renderToStaticMarkup } from "react-dom/server";
import { viewElement } from "../frame/SceneFrame";
import type { KeyLabels } from "../replicas/keys";
import type { SceneOptions } from "../registry";
import { ASTRO_VIEWS, type SiteSceneName } from "./views";

/**
 * Each scene renders on its own, so the scene name prefixes the ids of `useId`, such as the
 * gradient of the Antigravity mark. Two scenes on one page then have no id in common.
 */
export function renderView<Name extends SiteSceneName>(
  name: Name,
  keys: KeyLabels,
  options: SceneOptions<Name>,
): string {
  return renderToStaticMarkup(viewElement(ASTRO_VIEWS, name, { keys, options }), {
    identifierPrefix: `${name}-`,
  });
}
