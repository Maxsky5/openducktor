import { TOUR_SCENES } from "../tour-scenes";
import { TOUR_VIEWS } from "../tour-views";
import { createScenePlayer, type SceneProps as PlayerProps } from "./create-scene-player";

export type SceneProps = PlayerProps<keyof typeof TOUR_SCENES>;
export const { Scene, preloadScene } = createScenePlayer(TOUR_VIEWS, TOUR_SCENES);

export async function preloadTourScenes(): Promise<void> {
  // SAFETY: TOUR_SCENES is the object literal that defines SceneProps["name"].
  const names = Object.keys(TOUR_SCENES) as SceneProps["name"][];
  await Promise.all(names.map(preloadScene));
}
