// The sample data of the usage scene: the agent history of one developer on one host over the
// last 30 days, from Wednesday Oct 28 to Thursday Nov 26, 2026. The values are fictional. Claude
// Code does most of the work and Codex the second most. OpenCode helps a little, and Antigravity
// starts on Nov 9, when the developer turned it on. The developer did not work on Sunday Nov 1,
// and worked most on Wednesday Nov 18. Claude Code ran a larger model on Oct 29 and Nov 4, and a
// smaller one on Nov 11 and Nov 25, so the cost of those days differs from their tokens. It is
// 9:41 AM on Nov 26, so that day is still in progress. Every request has token counts and a rate.
// src/copied-usage.test.ts gives the report to the functions of the app.
import type { BoardData } from "../../replicas/board/model";
import type { NavData } from "../../replicas/shell/nav";
import type { UsageReport } from "../../replicas/usage/model";
import { CARDS } from "../../sample/board";
import { NAV_SESSIONS } from "../../sample/nav";

/** One million tokens. */
const M = 1_000_000;

/** Processed tokens of each day, in millions. */
const tokens = (millions: readonly number[]): number[] =>
  millions.map((value) => Math.round(value * M));

export const REPORT: UsageReport = {
  start: "2026-10-28",
  end: "2026-11-26",
  updated: "9:41 AM",
  runtimes: [
    {
      runtime: "claude",
      sessions: 168,
      tokens: tokens([
        47.6, 53.7, 40.4, 10, 0, 53.6, 44.1, 46.4, 35, 42.8, 13, 5.3, 45.1, 58.2, 71.6, 45.2, 42.7,
        9.3, 5.1, 56.1, 48.3, 83.1, 41, 46.3, 11.6, 5.1, 42.7, 72.5, 42.2, 14.1,
      ]),
      cost: [
        15.06, 23.32, 11.97, 2.76, 0, 19.8, 14.32, 25.07, 8.75, 11.27, 4.03, 1.57, 13.34, 18.43,
        12.41, 14.89, 13.38, 2.57, 1.23, 17.3, 11.55, 22.35, 10.51, 12.14, 2.85, 1.56, 13.42, 22.9,
        6.14, 3.66,
      ],
    },
    {
      runtime: "codex",
      sessions: 141,
      tokens: tokens([
        16.1, 25.3, 14, 6.2, 0, 21, 23.3, 16.1, 18.5, 26.7, 4.7, 3.1, 17.5, 18.5, 28.4, 30.3, 22.5,
        4.6, 2.4, 23.1, 20.4, 47.7, 19.8, 20.2, 6.9, 2.9, 20.5, 30.5, 27.7, 7.7,
      ]),
      cost: [
        3.34, 6.13, 3.48, 1.5, 0, 4.51, 5.35, 3.29, 4.08, 6.12, 0.97, 0.65, 3.66, 3.9, 6.38, 6.6,
        5.2, 0.98, 0.53, 5.66, 5.08, 10.26, 4.34, 4.74, 1.68, 0.69, 4.98, 6.23, 6.66, 1.8,
      ],
    },
    {
      runtime: "opencode",
      sessions: 67,
      tokens: tokens([
        4.9, 3.3, 6, 1.5, 0, 4.9, 5.6, 3.8, 6.5, 4.8, 1.4, 0.5, 5.3, 3.9, 11.6, 8.5, 4.9, 1.2, 1.1,
        4.3, 7.7, 8, 3.3, 5.1, 1, 0.8, 3.8, 4.4, 7.9, 1.2,
      ]),
      cost: [
        0.94, 0.55, 1.18, 0.29, 0, 0.97, 1, 0.64, 1.18, 0.87, 0.27, 0.1, 1.05, 0.76, 2.02, 1.4,
        0.94, 0.24, 0.2, 0.78, 1.33, 1.35, 0.55, 1.01, 0.18, 0.14, 0.76, 0.76, 1.5, 0.21,
      ],
    },
    {
      runtime: "antigravity",
      sessions: 36,
      tokens: tokens([
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3.5, 3.5, 6.4, 4.2, 2.8, 1, 0.5, 5.7, 5.5, 3.2, 4, 4.4,
        0.8, 0.3, 2.9, 4.1, 3.5, 1.4,
      ]),
      cost: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.61, 0.65, 1.19, 0.85, 0.54, 0.2, 0.09, 1.19, 1.04,
        0.67, 0.78, 0.84, 0.13, 0.06, 0.57, 0.85, 0.7, 0.25,
      ],
    },
  ],
  // Most input comes from the prompt cache, as in long agent sessions.
  tokenTypes: {
    cacheRead: 1_712_400_000,
    cacheWrite: 76_600_000,
    input: 38_700_000,
    output: 15_900_000,
  },
};

/** The day that the visitor inspects in the chart: Wednesday Nov 18, the busiest day. */
export const INSPECTED_DAY = 21;

/** The Kanban board of fieldnotes, where the visitor starts before opening Usage. */
export const BOARD: BoardData = {
  open: [CARDS.sync, CARDS.export],
  spec_ready: [CARDS.titles],
  in_progress: [CARDS.empty, CARDS.shortcut],
  ai_review: [CARDS.focus],
  human_review: [CARDS.typing],
};

/** The sessions of fieldnotes in the sidebar: the agents of the board. */
export const NAV: NavData = {
  scope: "current",
  entries: [
    NAV_SESSIONS["shortcut-build"],
    NAV_SESSIONS["empty-build"],
    NAV_SESSIONS["focus-qa"],
    NAV_SESSIONS["titles-spec"],
    NAV_SESSIONS["typing-qa"],
    NAV_SESSIONS["tags-chat"],
  ],
};

/**
 * The width of the trend chart column, in design pixels. A window of 1440 has a main area of 1062
 * beside the rail and the sidebar, so the page keeps its wide layout: 998 inside its padding, less
 * the 320 of the runtimes and the gap of 48. A phone stage shows the page alone in a window of 460,
 * and the chart takes the 426 inside the narrow padding.
 */
export const CHART_WIDTHS = { wide: 630, narrow: 426 } as const;
