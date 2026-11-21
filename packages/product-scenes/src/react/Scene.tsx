import { SCENES, type LoopSceneName } from "../registry";
import { VIEWS } from "../views";
import { createScenePlayer, type SceneProps as PlayerProps } from "./create-scene-player";

export type SceneProps = PlayerProps;
export const { Scene, preloadScene } = createScenePlayer<LoopSceneName>(VIEWS, SCENES);
