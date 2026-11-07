// The frame of a product scene: the root that the timeline mounts on, the stage with the copied
// UI, and the hidden stock of templates that the timeline clones. The stage is an image for
// assistive technology, with the text alternative of the view.
import type { ComponentType, ReactElement, ReactNode, Ref } from "react";
import type { KeyLabels } from "../replicas/keys";
import { classes } from "../replicas/classes";
import { flag } from "../replicas/flag";
import type { SceneName, SceneOptions } from "../registry";

/** The theme of a scene. Without a theme, the scene follows `data-theme` of the page root. */
export type SceneTheme = "light" | "dark";

/** The props of every scene view. A view renders the same markup for the same props. */
export type SceneViewProps = {
  theme?: SceneTheme | undefined;
  keys: KeyLabels;
  /** The root of the scene, for a host that mounts the timeline. */
  ref?: Ref<HTMLDivElement> | undefined;
  /**
   * The host draws the frame of the scene, such as the tour of the app. The scene then takes the
   * size of its container, its product window has no border, corners, or shadow, and it shows no
   * pointer of a visitor. The website does not frame its scenes.
   */
  framed?: boolean | undefined;
};

/** The props of the view of the scene `Name`: the props of every view and the scene options. */
export type ViewPropsOf<Name extends SceneName> = SceneViewProps & { options: SceneOptions<Name> };

/** The view of each scene. */
export type SceneViews = { [Name in SceneName]: ComponentType<ViewPropsOf<Name>> };

type SceneFrameProps = SceneViewProps & {
  name: SceneName;
  /** What the scene shows, in a sentence or two for assistive technology. */
  alt: string;
  /** The class of the stage, for a view that sizes its stage. */
  stageClass?: string;
  /** The templates of the view, as `Stock` elements. */
  stock?: ReactNode;
  children: ReactNode;
};

export function SceneFrame({
  name,
  alt,
  theme,
  ref,
  stageClass,
  framed = false,
  stock,
  children,
}: SceneFrameProps): ReactElement {
  return (
    <div
      className="scene"
      data-scene={name}
      data-theme={theme}
      data-framed={flag(framed)}
      ref={ref}
    >
      <div className={classes("stage", stageClass)} data-stage="" role="img" aria-label={alt}>
        {children}
      </div>
      {stock && (
        <div hidden inert data-stock="">
          {stock}
        </div>
      )}
    </div>
  );
}
