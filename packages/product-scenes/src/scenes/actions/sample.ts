// The sample data of the actions scene: the window state of its last frame.
import type { StudioFrame } from "../../replicas/studio/model";
import { FRAMES } from "../../sample/studio";
import { settled, studioNav } from "../../sample/studio-nav";

/** The last frame: the Builder is done, and two terminals run in its worktree. */
export const FRAME = {
  ...FRAMES.build,
  focus: "panel",
  nav: studioNav(settled("build", "ai_review", "1m")),
} as const satisfies StudioFrame;
