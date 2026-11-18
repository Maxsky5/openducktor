// The master timeline of the 1.2.2 release film. The opening shows the title next to a wall of
// every new screen, then dives into the phone of the first chapter. Each chapter shows one feature
// of the releases since 1.0.0, and the closing brings the screens back into the wall and shows
// where to find the project.
import type { FilmBuilder } from "../engine/film";
import { layoutMosaic, type MosaicOptions } from "../engine/mosaic";
import { playIntro, playOutro } from "../engine/titles";
import { artifactsChapter } from "./artifacts";
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
  const phone = partOf(film, FIRST.set, FIRST.part);
  film.lightAll(0);
  const { dive, arrived } = playIntro(film, 0, {
    layout: layoutMosaic(camera, wall()),
    first: { set: partOf(film, FIRST.set)(), view: phone() },
    shot: shotOf(film, phone, FIRST.framing)(),
  });
  film.light(FIRST.set, dive, arrived);

  // The chapters, one after the other. The chapter bar fills while each one plays.
  chapters.show(arrived);
  const chapterTimes = [
    mobileChapter,
    goalChapter,
    sessionsChapter,
    artifactsChapter,
    gitlabChapter,
    shortcutsChapter,
  ].reduce<number[]>(
    (times, chapter) => [...times, chapter(film, times.at(-1) ?? arrived)],
    [arrived],
  );
  chapterTimes.slice(1).forEach((end, index) => {
    chapters.play(index, chapterTimes[index] ?? arrived, end);
  });

  // The closing: the wall forms again, and the closing card shows next to it.
  const last = chapterTimes.at(-1) ?? arrived;
  film.endAt(playOutro(film, last, wall()));
};
