// The film part of the video page: it renders the view of a film, loads the builders of the
// scenes of its sets, and mounts the film, which stays on its first frame. The renderer then shows
// each frame with `seek`.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type FilmHandle, mountFilm, type SetBuilders } from "../src/films/engine/film";
import { FILMS, FILM_NAMES, type FilmName } from "../src/films/registry";
import { FILM_VIEWS } from "../src/films/views";
import type { SceneTheme } from "../src/frame/SceneFrame";
import { all, data, must } from "../src/motion/dom";
import type { KeyLabels } from "../src/replicas/keys";
import { SCENES } from "../src/registry";

/** Returns the film `value`, or fails with the list of the films. */
export function filmName(value: string): FilmName {
  const name = FILM_NAMES.find((film) => film === value);
  if (name) return name;
  throw new Error(`There is no film ${value}. Use one of these films: ${FILM_NAMES.join(", ")}.`);
}

/** The builder of the scene of each set of the film. A set holds a loop scene. */
async function loadBuilders(root: HTMLElement): Promise<SetBuilders> {
  const names = all(root, "[data-set]").map((set) => data(set, "set"));
  const entries = await Promise.all(
    names.map(async (name) => {
      const entry = Object.entries(SCENES).find(([scene]) => scene === name)?.[1];
      if (!entry || !("timeline" in entry)) {
        throw new Error(`The set ${name} must hold a loop scene of the registry.`);
      }
      return [name, await entry.timeline()] as const;
    }),
  );
  return new Map(entries);
}

/** Renders the film `name` in `parent` and mounts it on its first frame. */
export async function startFilm(
  name: FilmName,
  theme: SceneTheme,
  keys: KeyLabels,
  parent: HTMLElement,
  fontsReady: Promise<void>,
): Promise<FilmHandle> {
  const View = await FILM_VIEWS[name]();
  parent.innerHTML = renderToStaticMarkup(createElement(View, { keys, theme }));
  const root = must(parent, "[data-film]");
  const [builders, build] = await Promise.all([
    loadBuilders(root),
    FILMS[name].timeline(),
    fontsReady,
  ]);
  return mountFilm(root, FILMS[name].size, builders, build);
}
