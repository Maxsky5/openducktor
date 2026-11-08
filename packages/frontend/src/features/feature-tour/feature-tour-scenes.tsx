import "@openducktor/product-scenes/styles.css";
import type { AppPlatform } from "@openducktor/contracts";
import { MAC_KEYS, PC_KEYS } from "@openducktor/product-scenes/keys";
import { Scene, type SceneProps } from "@openducktor/product-scenes/react";
import { type ReactElement, Suspense } from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { getAppVersion } from "@/lib/app-version";
import type { TourSceneName } from "./feature-tour-dialog-loader";
import { TourFrame } from "./feature-tour-stage";

// The product scenes of the marketing website, live in the tour: each scene runs the timeline of
// its website view, so it is sharp at any size and moves at the refresh rate of the screen. A scene
// follows the motion setting of the system. The scenes, their styles, and GSAP load only with the
// tour. The tour dialog loads its scenes before it shows, so a scene never shows its fallback.

const VERSION = getAppVersion();

/**
 * The options that fit each scene to the frame of the tour. The board shows no cut lane, and the
 * views leave out what crowds the short frame.
 */
const SCENE_OPTIONS = {
  hero: {
    version: VERSION,
    designWidth: 1476,
    wholeLanes: true,
    omitted: ["recent"],
  },
  palette: {
    version: VERSION,
    designWidth: 1545,
    lanes: ["spec_ready", "ready_for_dev", "in_progress", "blocked", "ai_review"],
    collapsed: ["recent"],
    toasts: false,
    destructive: false,
    keysAtEnd: true,
  },
} as const satisfies { [Name in TourSceneName]: Extract<SceneProps, { name: Name }>["options"] };

type TourSceneProps = {
  scene: TourSceneName;
  /** The device platform: it sets the keys that the scene shows. */
  platform: AppPlatform;
};

/**
 * A live scene of the marketing website, in the theme of the app. The tour frame draws the window
 * border, and the tour explains the app, so the scene is framed: it fills the frame and shows no
 * pointer of a visitor. The tour keeps a seen slide mounted in a hidden `Activity`, which runs the
 * effect cleanups of the scene: a hidden scene stops, and it plays again from its start when its
 * slide shows.
 */
export function TourScene({ scene, platform }: TourSceneProps): ReactElement {
  const { theme } = useTheme();
  const keys = platform === "darwin" ? MAC_KEYS : PC_KEYS;
  return (
    <TourFrame>
      <div className="absolute inset-0">
        <Suspense fallback={null}>
          {scene === "hero" ? (
            <Scene name="hero" theme={theme} keys={keys} framed options={SCENE_OPTIONS.hero} />
          ) : (
            <Scene
              name="palette"
              theme={theme}
              keys={keys}
              framed
              options={SCENE_OPTIONS.palette}
            />
          )}
        </Suspense>
      </div>
    </TourFrame>
  );
}
