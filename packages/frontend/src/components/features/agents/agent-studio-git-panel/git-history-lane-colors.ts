import type { GitHistoryCommitMembership } from "@openducktor/contracts";

/**
 * Lane colors of each side. Branch commits use cool colors and missing target commits use warm
 * colors, so every lane keeps its side when the graph has many lanes. The dark theme uses lighter
 * shades, so thin lines stay visible on a dark surface.
 */
const LANE_COLORS = {
  current: [
    "text-blue-500 dark:text-blue-400",
    "text-violet-500 dark:text-violet-400",
    "text-pink-500 dark:text-pink-400",
    "text-teal-500 dark:text-teal-400",
    "text-indigo-500 dark:text-indigo-400",
  ],
  target: [
    "text-amber-500 dark:text-amber-400",
    "text-orange-500 dark:text-orange-400",
    "text-rose-500 dark:text-rose-400",
  ],
  boundary: ["text-slate-400 dark:text-slate-500"],
} satisfies Record<GitHistoryCommitMembership, string[]>;

/**
 * The text color of a line. Lines, nodes, and bands use it through `currentColor`. Color 0 is the
 * main line of a side, and merged lines use the other colors of that side.
 */
export const laneColor = (tone: GitHistoryCommitMembership, color: number): string => {
  const colors = LANE_COLORS[tone];
  const index = color === 0 || colors.length === 1 ? 0 : 1 + ((color - 1) % (colors.length - 1));
  return colors[index] ?? colors[0] ?? "";
};
