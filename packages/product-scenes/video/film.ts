// The film part of the video page: it renders the view of a film and mounts the film, which stays
// on its first frame. The renderer then shows each frame with `seek`.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type FilmHandle, mountFilm } from "../src/films/engine/film";
import type { FilmName } from "../src/films/registry";
import { FILM_VIEWS } from "../src/films/views";
import type { SceneTheme } from "../src/frame/SceneFrame";
import { must } from "../src/motion/dom";
import type { KeyLabels } from "../src/replicas/keys";

/** Renders the film `name` in `parent` and mounts it on its first frame, once the fonts load. */
export async function startFilm(
  name: FilmName,
  theme: SceneTheme,
  keys: KeyLabels,
  parent: HTMLElement,
  fontsReady: Promise<void>,
): Promise<FilmHandle> {
  const View = await FILM_VIEWS[name]();
  parent.innerHTML = renderToStaticMarkup(createElement(View, { keys, theme }));
  await fontsReady;
  return mountFilm(must(parent, "[data-film]"), name);
}
