// The page script of Scene.astro: it mounts the timeline of each scene that the page shows. A loop
// scene mounts on its `data-scene` root, and a chapter player on its `data-chapters` root.
import { mountChapters } from "../motion/chapters";
import { all } from "../motion/dom";
import { mountLoop } from "../motion/player";
import { ASTRO_CHAPTERS, ASTRO_TIMELINES } from "./timelines";

export function mountPageScenes(): void {
  for (const [name, build] of Object.entries(ASTRO_TIMELINES)) {
    for (const root of all(document, `[data-scene="${name}"]`)) mountLoop(root, build);
  }
  for (const [name, builders] of Object.entries(ASTRO_CHAPTERS)) {
    const chapters = new Map(Object.entries(builders));
    for (const root of all(document, `[data-chapters="${name}"]`)) mountChapters(root, chapters);
  }
}
