"use client";
// The client part of `PageScene`: it plays the view that the server rendered. It loads the player
// and the timeline of the scene when the view comes near the screen, so the page loads no view
// code and no GSAP until a scene can show, and it shows the static frame until the timeline loads.
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { MOTION_QUERY } from "../motion/preference";
import { CHAPTER_SCENE_NAMES, type ChapterSceneName, SCENES, type SceneName } from "../registry";

/** Starts the page player on the root of a view. Returns the function that stops it. */
type MountPlayer = (root: HTMLElement) => () => void;

/**
 * A view starts to load its player when it is one screen height or less from the screen, so the
 * player is ready before the view shows.
 */
const LOAD_MARGIN = "100% 0px";

const isChapterScene = (name: SceneName): name is ChapterSceneName =>
  CHAPTER_SCENE_NAMES.some((chapter) => chapter === name);

const players = new Map<SceneName, Promise<MountPlayer>>();

/**
 * Loads the page player of a scene once: the chapter player or the loop, with the timeline of the
 * scene. A load that fails leaves no entry, so the next mount loads the scene again.
 */
function loadPlayer(name: SceneName): Promise<MountPlayer> {
  const known = players.get(name);
  if (known) return known;
  const load = isChapterScene(name)
    ? Promise.all([import("../motion/chapters"), SCENES[name].chapters()]).then(
        ([{ mountChapters }, builders]): MountPlayer => {
          const chapters = new Map(Object.entries(builders));
          return (root) => mountChapters(root, chapters);
        },
      )
    : Promise.all([import("../motion/player"), SCENES[name].timeline()]).then(
        ([{ mountLoop }, build]): MountPlayer =>
          (root) =>
            mountLoop(root, build),
      );
  players.set(name, load);
  load.catch(() => players.delete(name));
  return load;
}

type ScenePlayerProps = {
  name: SceneName;
  /** What shows under the static frame when the timeline of the scene does not load. */
  failure: ReactNode;
  /** The view of the scene, which the server renders. */
  children: ReactNode;
};

/**
 * Plays the view in `children` with the page player of the scene `name` while it is mounted. The
 * player loads when the view comes near the screen. With reduced motion, a loop scene keeps its
 * static frame and loads nothing until the reader accepts motion, and a chapter player loads for
 * its tabs. The unmount stops the player and puts back the static frame. When the timeline does
 * not load, the view keeps its static frame, `failure` shows under it, and the error goes to the
 * error handler of the page.
 */
export function ScenePlayer({ name, failure, children }: ScenePlayerProps): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = box.current?.firstElementChild;
    if (!(root instanceof HTMLElement))
      throw new Error(`The ${name} scene did not render its root.`);
    let mounted = true;
    let stop: (() => void) | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadPlayer(name).then(
          (mount) => {
            if (mounted) stop = mount(root);
          },
          (error) => {
            reportError(error);
            if (mounted) setFailed(true);
          },
        );
      },
      { rootMargin: LOAD_MARGIN },
    );
    const listeners = new AbortController();
    const motion = matchMedia(MOTION_QUERY);
    if (isChapterScene(name) || motion.matches) observer.observe(root);
    else
      motion.addEventListener("change", () => observer.observe(root), {
        once: true,
        signal: listeners.signal,
      });
    return () => {
      mounted = false;
      observer.disconnect();
      listeners.abort();
      stop?.();
    };
  }, [name]);

  return (
    <>
      <div ref={box} data-page-scene={name}>
        {children}
      </div>
      {failed && failure}
    </>
  );
}
