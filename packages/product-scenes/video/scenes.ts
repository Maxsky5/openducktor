// The scenes that the video renderer accepts, and the handle that its page gives to the renderer.
// The page and the renderer share this module. It loads no view and no React.
import {
  CHAPTER_SCENE_NAMES,
  type ChapterSceneName,
  type LoopSceneName,
  SCENE_NAMES,
  type SceneName,
} from "../src/registry";

/** The handle of the video page. Only the renderer uses it. */
type SceneVideo = {
  /** Resolves with the length of one run of the scene in seconds, after the scene mounts. */
  ready: Promise<number>;
  /** Shows the frame at `time` seconds. Call it with times that increase. */
  seek: (time: number) => void;
};

declare global {
  interface Window {
    __sceneVideo?: SceneVideo;
  }
}

/** The loop scenes. The renderer seeks their timeline through the handle of `mountScene`. */
export const VIDEO_SCENES = SCENE_NAMES.filter(
  (name): name is LoopSceneName => !isChapterScene(name),
);

function isChapterScene(name: SceneName): name is ChapterSceneName {
  return CHAPTER_SCENE_NAMES.some((chapter) => chapter === name);
}

/** Returns the loop scene `value`, or fails with the list of the scenes that the renderer accepts. */
export function videoScene(value: string): LoopSceneName {
  const scene = VIDEO_SCENES.find((name) => name === value);
  if (scene) return scene;
  const known = VIDEO_SCENES.join(", ");
  if (CHAPTER_SCENE_NAMES.some((name) => name === value)) {
    throw new Error(
      `The ${value} scene is a chapter player. Its player has no handle that seeks a time, so the renderer cannot record it. Use one of these scenes: ${known}.`,
    );
  }
  throw new Error(`There is no scene ${value}. Use one of these scenes: ${known}.`);
}
