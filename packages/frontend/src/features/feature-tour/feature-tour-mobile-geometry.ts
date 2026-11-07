import type {
  SessionNavigationEntry,
  SessionNavigationGroupId,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { SESSIONS } from "./feature-tour-samples";

// The geometry of the Android phone in the tour, in dp: the screen, the frame, the bars, and the
// session list. The sizes come from the styles of the mobile app (`apps/mobile`).

/** The reference device: 1080 by 2400 pixels at a density of 2.625. */
export const DENSITY = 2.625;
export const SCREEN_WIDTH = 1080 / DENSITY;
export const SCREEN_HEIGHT = 2400 / DENSITY;

/** The Android status bar and the Material toolbar of `StackHeader`. */
export const STATUS_BAR_HEIGHT = 24;
export const HEADER_HEIGHT = 56;

/** The phone body around the screen: a metal rim and a black bezel. */
export const RIM = 2;
export const BEZEL = 10;
export const SCREEN_RADIUS = 34;
export const FRAME = RIM + BEZEL;

/** The size of the phone with its frame, in dp. */
export const TOUR_PHONE_SIZE = {
  width: SCREEN_WIDTH + 2 * FRAME,
  height: SCREEN_HEIGHT + 2 * FRAME,
} as const;

export type PhoneGroup = {
  id: SessionNavigationGroupId;
  entries: readonly SessionNavigationEntry[];
};

const NEEDS_YOU_ENTRIES = [SESSIONS.emptyBuild] as const;
const RUNNING_ENTRIES = [SESSIONS.shortcutBuild, SESSIONS.focusQa] as const;

/** The sessions on the phone: the same groups as the sidebar of the host. */
export const PHONE_GROUPS: readonly PhoneGroup[] = [
  { id: "needs_you", entries: NEEDS_YOU_ENTRIES },
  { id: "running", entries: RUNNING_ENTRIES },
  { id: "recent", entries: [SESSIONS.tagsChat] },
];

/** The Needs you count of the badge on the Sessions tab. */
export const NEEDS_YOU_COUNT = NEEDS_YOU_ENTRIES.length;

/**
 * The heights of the parts of the session list, in dp. `feature-tour-mobile.tsx` sets them on its
 * markup. The scope switch has 12 dp of padding around a 42 dp control. A group header has 16 dp of
 * padding around a 48 dp bar.
 */
export const SCOPE_SWITCH_HEIGHT = 54;
export const GROUP_HEADER_HEIGHT = 64;

/** A row is 16 dp from the screen edges. */
export const SESSION_ROW_INSET = 16;

/**
 * The height of a session row with one title line, in dp: 6 dp of padding around a card. The status
 * badge of a task session makes the first line of its card 22 dp high. A chat session has no badge,
 * so its first line is 16 dp high.
 */
export const sessionRowHeight = (entry: SessionNavigationEntry): number =>
  entry.context.kind === "task" ? 76 : 70;

const rowsHeight = (entries: readonly SessionNavigationEntry[]): number =>
  entries.reduce((height, entry) => height + sessionRowHeight(entry), 0);

/** The middle of the right edge of the first Running row, in dp from the top-left of the phone. */
export const TOUR_PHONE_RUNNING_ROW_END = {
  x: FRAME + SCREEN_WIDTH - SESSION_ROW_INSET,
  y:
    FRAME +
    STATUS_BAR_HEIGHT +
    HEADER_HEIGHT +
    SCOPE_SWITCH_HEIGHT +
    GROUP_HEADER_HEIGHT +
    rowsHeight(NEEDS_YOU_ENTRIES) +
    GROUP_HEADER_HEIGHT +
    sessionRowHeight(RUNNING_ENTRIES[0]) / 2,
} as const;
