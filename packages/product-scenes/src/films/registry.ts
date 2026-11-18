// The films of the package: long videos that put scenes of the package together, with a camera,
// captions, and titles. Only the video tool renders them. This module loads no view and no React.
import type { FrameSize } from "./engine/camera";
import type { FilmBuilder } from "./engine/film";

export const FILM_NAMES = ["release-1-2-2"] as const;
export type FilmName = (typeof FILM_NAMES)[number];

/** A film: the size of its frame and the loader of its builder. */
type FilmEntry = { size: FrameSize; timeline: () => Promise<FilmBuilder> };

export const FILMS = {
  "release-1-2-2": {
    size: { width: 1920, height: 1080 },
    timeline: async () => (await import("./release-1-2-2/timeline")).build,
  },
} as const satisfies Record<FilmName, FilmEntry>;
