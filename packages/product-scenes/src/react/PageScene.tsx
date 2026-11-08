// A product scene on a page that a React server renders, such as the documentation. The server
// renders the static frame of the view, so the page shows the scene and its styles before scripts
// run, and the page loads no view code. `ScenePlayer` then plays the scene as the website does: a
// loop scene plays while it shows on the screen, and a chapter player, such as the workflow, shows
// its tabs and plays one chapter at a time. Both follow the reduced motion setting and the pause
// control of the page. A host that controls when a scene plays uses `Scene`.
//
// Each scene links its stylesheet, after the base stylesheet. React puts the links in the head and
// loads each one once, so a page loads only the styles of its scenes, and a client navigation
// shows a scene after its styles load. The view sits in `[data-page-scene="<name>"]`.
import type { ReactElement, ReactNode } from "react";
import type { SceneTheme } from "../frame/SceneFrame";
import { type KeyLabels, MAC_KEYS } from "../replicas/keys";
import type { SceneName, SceneOptionsProp } from "../registry";
import { viewElement } from "../views";
import { PAGE_VIEWS } from "./page-views";
import { ScenePlayer } from "./ScenePlayer";

/** The props of the page scene `Name`. */
type PageScenePropsOf<Name extends SceneName> = {
  name: Name;
  /** The theme of the scene. Without it, the scene follows `data-theme` of the page root. */
  theme?: SceneTheme;
  /** The keys that the scene shows. The default is the macOS keys. */
  keys?: KeyLabels;
} & SceneOptionsProp<Name>;

/** The scenes that take options from their host. */
type SceneWithOptions = {
  [Name in SceneName]: SceneOptionsProp<Name> extends { options: unknown } ? Name : never;
}[SceneName];

/**
 * The props of one page scene. The scenes without options share one member, so a host can pass
 * the name of any of them, such as a name from its own map of scenes.
 */
export type PageSceneProps =
  | PageScenePropsOf<Exclude<SceneName, SceneWithOptions>>
  | { [Name in SceneWithOptions]: PageScenePropsOf<Name> }[SceneWithOptions];

/** A stylesheet of `PageScene`: `base`, with the base styles, or the stylesheet of one scene. */
export type PageStyleSheet = "base" | SceneName;

/** The precedence of the scene stylesheets. React puts them after the stylesheets of the host. */
const STYLE_PRECEDENCE = "product-scenes";

/**
 * A scene that plays as on the website while it is mounted. The unmount stops it and removes its
 * listeners. With reduced motion, a loop scene keeps its static frame, and the tabs of a chapter
 * player select a chapter that does not play. The component has no state, so a React server can
 * render it.
 */
export function PageScene(
  props: PageSceneProps & {
    /**
     * What shows under the static frame when the timeline of the scene does not load, such as a
     * line that asks the reader to load the page again.
     */
    failure: ReactNode;
    /**
     * The address of the built file of a stylesheet of `PageScene`. The host bundles the files of
     * each stylesheet that `pageStyles()` gives, and serves the results. Two scene stylesheets
     * can hold the same part stylesheet, and the second copy would override the rules between
     * them, so the host scopes the rules of each scene stylesheet to `[data-page-scene="<name>"]`.
     */
    stylesheet: (sheet: PageStyleSheet) => string;
  },
): ReactElement {
  const { name, theme, keys = MAC_KEYS, failure, stylesheet } = props;
  return (
    <>
      <link rel="stylesheet" href={stylesheet("base")} precedence={STYLE_PRECEDENCE} />
      <link rel="stylesheet" href={stylesheet(name)} precedence={STYLE_PRECEDENCE} />
      <ScenePlayer name={name} failure={failure}>
        {viewElement(PAGE_VIEWS, name, { theme, keys, options: props.options ?? {} })}
      </ScenePlayer>
    </>
  );
}
