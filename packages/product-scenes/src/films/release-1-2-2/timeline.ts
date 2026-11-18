// The master timeline of the 1.2.2 release film. The opening shows the title next to a wall of
// every new screen, then dives into the phone of the first chapter. Each chapter shows one feature
// of the releases since 1.0.0, and the closing brings the screens back into the wall and shows
// where to find the project.
import type { Film, FilmBuilder } from "../engine/film";
import { layoutMosaic, type MosaicOptions } from "../engine/mosaic";
import { playIntro, playOutro } from "../engine/titles";
import { artifactsChapter } from "./artifacts";
import { CHAPTERS } from "./captions";
import { gitlabChapter } from "./gitlab";
import { goalChapter } from "./goal";
import { FIRST, mobileChapter } from "./mobile";
import { sessionsChapter } from "./sessions";
import { shortcutsChapter } from "./shortcuts";
import { partOf, shotOf } from "./shots";
import { type SetName, VIEWS_OF, WORLD } from "./view";

/**
 * The rows of the wall of the opening and the closing, from the top. The phone of the first
 * chapter is in the middle of the wall, in the part next to the caption column, where the camera
 * dives into it.
 */
const WALL_ROWS: readonly (readonly SetName[])[] = [
  ["goal-mode", "mobile-question", "artifacts", "gitlab"],
  ["fork", "mobile-start-builder", "keyboard-shortcuts"],
];

/** The builder of each chapter, by its name in the chapter bar. It plays from `at` and returns its end. */
const CHAPTER_BUILDERS = {
  Mobile: mobileChapter,
  "Goal mode": goalChapter,
  Sessions: sessionsChapter,
  Artifacts: artifactsChapter,
  GitLab: gitlabChapter,
  Raccourcis: shortcutsChapter,
} as const satisfies Record<(typeof CHAPTERS)[number], (film: Film, at: number) => number>;

export const build: FilmBuilder = (film) => {
  const { camera, chapters } = film;
  const wall = (): MosaicOptions => ({
    rows: WALL_ROWS.map((row) =>
      row.map((name) => ({ set: partOf(film, name), view: partOf(film, name, VIEWS_OF[name]) })),
    ),
    width: 3900,
    center: { x: WORLD.width / 2, y: WORLD.height / 2 },
    gap: 70,
  });

  // The opening: every set shows in the wall. The camera dives into the phone of the first
  // chapter, and the other sets go dark once they are out of the frame.
  film.lightAll(0);
  const { dive, arrived } = playIntro(film, {
    layout: layoutMosaic(camera, wall()),
    first: partOf(film, FIRST.set)(),
    shot: shotOf(film, partOf(film, FIRST.set, FIRST.part), FIRST.framing)(),
  });
  film.light(FIRST.set, dive, arrived);

  // The chapters, one after the other, in the order of the chapter bar. The bar fills while each
  // one plays.
  chapters.show(arrived);
  let time = arrived;
  CHAPTERS.forEach((name, index) => {
    const end = CHAPTER_BUILDERS[name](film, time);
    chapters.play(index, time, end);
    time = end;
  });

  // The closing: the wall forms again, and the closing card shows next to it.
  film.endAt(playOutro(film, time, wall()));
};
