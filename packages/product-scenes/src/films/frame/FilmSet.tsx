// A set of a film: one scene of the package at its design width, at a place of the world. The film
// plays the scene of the set with `play`, and the camera frames the set or a part of it.
import type { ReactElement } from "react";
import { type LoopSceneName, SCENES } from "../../registry";

type FilmSetProps = {
  /** The scene of the set. */
  name: LoopSceneName;
  /** The place of the set in the world, in world pixels. */
  x: number;
  y: number;
  /**
   * The pixels that the film hides on the left of the set, as a crop of a film editor, such as a
   * side menu that would show at the edge of the captions.
   */
  cropLeft?: number;
  /** The view of the scene, with `captioned` on. */
  children: ReactElement;
};

export function FilmSet({ name, x, y, cropLeft, children }: FilmSetProps): ReactElement {
  return (
    <div
      className="film-set"
      data-set={name}
      style={{
        left: x,
        top: y,
        width: SCENES[name].size.width,
        clipPath: cropLeft === undefined ? undefined : `inset(0 0 0 ${cropLeft}px)`,
      }}
    >
      {children}
    </div>
  );
}
