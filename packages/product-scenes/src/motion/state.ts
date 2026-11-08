// The play state that the players show on the root of a view. The styles of the scenes read it,
// and a host page or its browser tests can read it too. This module loads no GSAP.

/** The root of a view that a page player plays: a loop scene or a chapter player. */
export const PLAYER_ROOT = "[data-scene], [data-chapters]";

/**
 * The values of `data-motion` on the root of a view while a player watches it: `running` while the
 * view plays, and `paused` while it is out of its play zone or the visitor paused motion. A root
 * without `data-motion` has no player that plays it: the player did not load yet or did not load,
 * or the visitor asks for reduced motion.
 */
export const MOTION_STATE = { running: "running", paused: "paused" } as const;

/** The value of `data-motion` for a view that plays or does not play. */
export function motionState(running: boolean): string {
  return running ? MOTION_STATE.running : MOTION_STATE.paused;
}
