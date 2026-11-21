import { TOUR_SCENES } from "../tour-scenes";
import { TOUR_VIEWS } from "../tour-views";
import { createScenePlayer, type SceneProps as PlayerProps } from "./create-scene-player";

export type SceneProps = PlayerProps<keyof typeof TOUR_SCENES>;
export const { Scene, preloadScene } = createScenePlayer(TOUR_VIEWS, TOUR_SCENES);
