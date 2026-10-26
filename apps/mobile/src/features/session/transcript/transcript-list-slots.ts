import type { TranscriptListKind } from "./transcript-list-items";

/** The place of the reader in a list: the distances from both ends and the viewport height. */
export type ListPlace = { fromTop: number; fromBottom: number; viewportHeight: number };

export const LIST_START: ListPlace = { fromTop: 0, fromBottom: 0, viewportHeight: 0 };

/** A jump within this many screens scrolls the list on screen. A longer jump shows another list. */
const NEAR_JUMP_VIEWPORTS = 2;

/** True when the reader is within the near jump distance of the start of the list. */
export const isNearListStart = (kind: TranscriptListKind, place: ListPlace): boolean =>
  (kind === "latest" ? place.fromBottom : place.fromTop) <=
  NEAR_JUMP_VIEWPORTS * place.viewportHeight;

/** Two lists of each kind take turns: one can be on screen while the other waits at its start. */
export type TranscriptListSlot = "latestA" | "latestB" | "firstA" | "firstB";

export const TRANSCRIPT_LIST_SLOTS: readonly TranscriptListSlot[] = [
  "latestA",
  "latestB",
  "firstA",
  "firstB",
];

export const SLOT_KIND = {
  latestA: "latest",
  latestB: "latest",
  firstA: "first",
  firstB: "first",
} as const satisfies Record<TranscriptListSlot, TranscriptListKind>;

/** The other list of the same kind. */
export const PARTNER_SLOT = {
  latestA: "latestB",
  latestB: "latestA",
  firstA: "firstB",
  firstB: "firstA",
} as const satisfies Record<TranscriptListSlot, TranscriptListSlot>;

const MAIN_SLOT = { latest: "latestA", first: "firstA" } as const satisfies Record<
  TranscriptListKind,
  TranscriptListSlot
>;

/**
 * The list that a long jump to the start of `kind` shows. Each list that is not on screen waits at
 * its start, so a jump within the kind on screen shows its partner, and a jump to the other kind
 * shows the main list of that kind.
 */
export const jumpSlot = (
  current: TranscriptListSlot,
  kind: TranscriptListKind,
): TranscriptListSlot => (SLOT_KIND[current] === kind ? PARTNER_SLOT[current] : MAIN_SLOT[kind]);
