import { all, data, must } from "./dom";
import { type Frame, showFrame, takeFrame } from "./frame";
import { gsap, ScrollTrigger } from "./gsap";
import {
  checkLength,
  createPlayback,
  type PlayZone,
  watchPlayback,
  whileMotionAllowed,
} from "./player";
import { isPausedByVisitor } from "./preference";
import { createScene, type SceneBuilder } from "./scene";
import { tabState, targetIndex } from "./tabs";
import { EASE } from "./tokens";

type Chapter = {
  id: string;
  tab: HTMLButtonElement;
  panel: HTMLElement;
  stage: HTMLElement;
  markup: string;
  build: SceneBuilder<string>;
};

/** Seconds that the last frame of a chapter stays on screen before the next chapter starts. */
const HOLD = 1.8;

/** Seconds that the last frame of a chapter takes to cross fade into the next chapter. */
const STEP_FADE = 0.6;

/**
 * The chapter player plays from the moment its top passes 75% of the screen height until its
 * bottom passes 25%.
 */
const CHAPTER_ZONE: PlayZone = { start: "top 75%", end: "bottom 25%" };

function chapterOf(
  tab: HTMLButtonElement,
  root: HTMLElement,
  builders: ReadonlyMap<string, SceneBuilder<string>>,
): Chapter {
  const id = data(tab, "chapter");
  const panel = must(root, `[data-chapter-panel="${id}"]`);
  const stage = must(panel, "[data-stage]");
  const build = builders.get(id);
  if (!build) throw new Error(`Chapter ${id} has no scene builder.`);
  if (!tab.id) throw new Error(`The tab of chapter ${id} needs an id.`);
  return { id, tab, panel, stage, markup: stage.innerHTML, build };
}

/**
 * A tab list of product scenes. Without JavaScript the panels stay stacked under their own
 * headings. With JavaScript the tabs select one panel. When motion is allowed, each chapter
 * plays while the player is on screen and shows its progress in its tab. The next chapter
 * opens after the hold. A tab click restarts that chapter.
 */
export function mountChapters(
  root: HTMLElement,
  builders: ReadonlyMap<string, SceneBuilder<string>>,
): void {
  const tablist = must(root, '[role="tablist"]');
  const chapters = all(tablist, '[role="tab"]', HTMLButtonElement).map((tab) =>
    chapterOf(tab, root, builders),
  );
  const first = chapters[0];
  if (!first) throw new Error("A chapter player needs at least one chapter.");

  let current = first;
  let start: ((chapter: Chapter, last?: Frame) => void) | undefined;

  const select = (chapter: Chapter, focus: boolean): void => {
    const height = root.offsetHeight;
    // The chapters follow one task, so a chapter starts where the chapter before it ends. The
    // last frame of the chapter before cross fades into the first frame of the next chapter.
    // The frame leaves its panel before the panel hides, so it keeps its scroll offsets. The
    // pause control switches at once.
    const last = start && !isPausedByVisitor() ? takeFrame(current.stage) : undefined;
    current = chapter;
    const position = chapters.indexOf(chapter);
    chapters.forEach((item, index) => {
      const selected = item === chapter;
      item.tab.setAttribute("aria-selected", String(selected));
      item.tab.tabIndex = selected ? 0 : -1;
      item.tab.dataset.state = tabState(index, position);
      item.panel.hidden = !selected;
      item.tab.style.setProperty("--progress", "0");
    });
    if (focus) chapter.tab.focus();
    // On a narrow screen, a chapter text can take one more line. The sections below then move,
    // so their triggers measure their positions again.
    if (root.offsetHeight !== height) ScrollTrigger.refresh();
    start?.(chapter, last);
  };

  for (const chapter of chapters) {
    chapter.panel.setAttribute("role", "tabpanel");
    chapter.panel.setAttribute("aria-labelledby", chapter.tab.id);
    chapter.panel.tabIndex = 0;
    chapter.tab.addEventListener("click", () => select(chapter, false));
  }
  tablist.addEventListener("keydown", (event) => {
    const index = targetIndex(event.key, chapters.indexOf(current), chapters.length - 1);
    const target = index === undefined ? undefined : chapters[index];
    if (!target) return;
    event.preventDefault();
    select(target, true);
  });

  // The tabs replace the stacked panels of the page without JavaScript.
  tablist.hidden = false;
  root.dataset.tabs = "";
  select(first, false);

  whileMotionAllowed(() => {
    const playback = createPlayback(STEP_FADE);
    start = (chapter, frame) => {
      const last = frame ? showFrame(frame, chapter.stage) : undefined;
      for (const item of chapters) item.stage.innerHTML = item.markup;
      const timeline = gsap.timeline({
        paused: true,
        onUpdate: () => chapter.tab.style.setProperty("--progress", timeline.progress().toFixed(4)),
      });
      chapter.build(createScene(chapter.panel, chapter.stage, timeline));
      timeline.to({}, { duration: HOLD });
      const built = timeline.duration();
      timeline.eventCallback("onComplete", () => {
        checkLength(chapter.id, timeline, built);
        const next = chapters[(chapters.indexOf(chapter) + 1) % chapters.length];
        if (next) select(next, false);
      });
      if (last) {
        // A narrow screen shows the text of the chapter above the window.
        gsap.fromTo(
          must(chapter.panel, "[data-chapter-copy]"),
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: STEP_FADE,
            ease: EASE.gentle,
            clearProps: "opacity,visibility",
            overwrite: true,
          },
        );
      }
      playback.start(timeline, last);
    };
    const stopWatch = watchPlayback(root, playback.sync, CHAPTER_ZONE);
    start(current);
    return () => {
      stopWatch();
      playback.stop();
      start = undefined;
      for (const chapter of chapters) {
        chapter.stage.innerHTML = chapter.markup;
        chapter.tab.style.removeProperty("--progress");
      }
    };
  });
}
