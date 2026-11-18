// The frame of a film: the backdrop, the camera rig with the world of the sets, and the parts over
// the camera, such as the captions, the chapter bar, and the titles.
// The root holds the theme, as the root of a scene does, and its child is a stage, so the base
// styles of the scenes apply to the film too. The film holds the paused motion state, so the frame
// clock of the renderer moves the CSS animations of the scenes. Only the video tool renders a film.
import type { ReactElement, ReactNode } from "react";
import type { SceneTheme } from "../../frame/SceneFrame";
import type { FrameSize } from "../engine/camera";
import "./FilmFrame.css";

type FilmFrameProps = {
  /** The name of the film. */
  name: string;
  /** What the film shows, in a few sentences for assistive technology. */
  alt: string;
  theme?: SceneTheme | undefined;
  size: FrameSize;
  /** The size of the world that holds the sets, in world pixels. */
  world: FrameSize;
  /** The sets of the world, as `FilmSet` elements. */
  sets: ReactNode;
  /** The parts over the camera: captions, the chapter bar, and the titles. */
  overlay: ReactNode;
};

export function FilmFrame({
  name,
  alt,
  theme,
  size,
  world,
  sets,
  overlay,
}: FilmFrameProps): ReactElement {
  return (
    <div className="film-root" data-film={name} data-theme={theme} role="img" aria-label={alt}>
      <div className="stage film-stage" style={size}>
        <div className="film" data-motion="paused">
          <div className="film-backdrop">
            <div className="film-glow" data-glow="a" />
            <div className="film-glow" data-glow="b" />
            <div className="film-dots" />
          </div>
          <div className="film-viewport" data-viewport="">
            <div className="film-rig" data-rig="">
              <div className="film-cam" data-cam="">
                <div className="film-world" data-world="" style={world}>
                  {sets}
                </div>
              </div>
            </div>
          </div>
          <div className="film-overlay">{overlay}</div>
        </div>
      </div>
    </div>
  );
}
