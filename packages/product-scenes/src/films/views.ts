// The React view of each film, loaded on demand.
import type { ComponentType } from "react";
import type { SceneTheme } from "../frame/SceneFrame";
import type { KeyLabels } from "../replicas/keys";
import type { FilmName } from "./registry";

/** The props of every film view. */
export type FilmViewProps = { keys: KeyLabels; theme?: SceneTheme | undefined };

export const FILM_VIEWS = {
  "release-1-2-2": async () => (await import("./release-1-2-2/view")).ReleaseFilmView,
} as const satisfies Record<FilmName, () => Promise<ComponentType<FilmViewProps>>>;
