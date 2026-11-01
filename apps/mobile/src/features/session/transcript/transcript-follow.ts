/**
 * Follows live content while the reader is at the bottom of the transcript. When the reader
 * scrolls up, the transcript keeps its place, and new content raises "New activity".
 */

/** The share of the viewport height that still counts as the top. */
const TOP_THRESHOLD_FRACTION = 0.2;

/**
 * The height of the space under the latest message, the first item of the inverted list. While
 * it is in view, the list keeps it in place, so new rows and a growing reply push the rows above
 * up and the latest message stays in view. So this space is the bottom of the transcript.
 */
export const BOTTOM_EDGE_HEIGHT = 16;

export type TranscriptFollowState = {
  /** True while the reader is at the bottom, so new content scrolls into view. */
  readonly atBottom: boolean;
  /** True while the reader is near the first message, so the top control hides. */
  readonly atTop: boolean;
  /** True when content changed while the reader was away from the bottom. */
  readonly hasNewActivity: boolean;
  /**
   * Names the content that the reader saw when the state last changed: rows, last row, and
   * message revision. Changes at the bottom keep the previous key.
   */
  readonly contentKey: string | null;
};

export type TranscriptFollowEvent =
  | {
      type: "scrolled";
      distanceFromBottom: number;
      distanceFromTop: number;
      viewportHeight: number;
    }
  | { type: "content_changed"; contentKey: string }
  | { type: "jumped_to_latest" }
  /** The list mounted the first rows at its top, away from the latest message. */
  | { type: "jumped_to_top" }
  /** The content changed size. A new list has no scroll event, so this places the top. */
  | { type: "content_measured"; distanceFromTop: number; viewportHeight: number };

export const initialTranscriptFollowState = (contentKey: string | null): TranscriptFollowState => ({
  atBottom: true,
  atTop: true,
  hasNewActivity: false,
  contentKey,
});

/** True while the space under the latest message is in view, so the list follows new content. */
export const isAtTranscriptBottom = (distanceFromBottom: number): boolean =>
  distanceFromBottom < BOTTOM_EDGE_HEIGHT;

/** True when `distance` from the first message is within the top threshold of the viewport. */
export const isNearTranscriptTop = (distance: number, viewportHeight: number): boolean =>
  distance <= Math.max(1, viewportHeight * TOP_THRESHOLD_FRACTION);

/** Returns the same state object when nothing changes, so the view does not render again. */
export const reduceTranscriptFollow = (
  state: TranscriptFollowState,
  event: TranscriptFollowEvent,
): TranscriptFollowState => {
  switch (event.type) {
    case "scrolled": {
      const atBottom = isAtTranscriptBottom(event.distanceFromBottom);
      const atTop = isNearTranscriptTop(event.distanceFromTop, event.viewportHeight);
      const hasNewActivity = atBottom ? false : state.hasNewActivity;
      if (
        atBottom === state.atBottom &&
        atTop === state.atTop &&
        hasNewActivity === state.hasNewActivity
      ) {
        return state;
      }
      return { ...state, atBottom, atTop, hasNewActivity };
    }
    case "content_changed": {
      // At the bottom the reader sees each change as it comes, and once new activity shows, more
      // changes add nothing. So the state stays the same object and a streamed change does not
      // render the list again. The next change away from the bottom still differs from the last
      // key that the state holds.
      if (event.contentKey === state.contentKey || state.atBottom || state.hasNewActivity) {
        return state;
      }
      return { ...state, contentKey: event.contentKey, hasNewActivity: state.contentKey !== null };
    }
    case "jumped_to_latest":
      if (state.atBottom && !state.hasNewActivity) return state;
      return { ...state, atBottom: true, hasNewActivity: false };
    case "content_measured": {
      const atTop = isNearTranscriptTop(event.distanceFromTop, event.viewportHeight);
      return atTop === state.atTop ? state : { ...state, atTop };
    }
    case "jumped_to_top":
      if (state.atTop && !state.atBottom) return state;
      return { ...state, atTop: true, atBottom: false };
  }
};

/** Names the transcript content, so a change shows as new activity. */
export const transcriptContentKey = ({
  rowCount,
  lastRowKey,
  messagesVersion,
}: {
  rowCount: number;
  lastRowKey: string | null;
  messagesVersion: number;
}): string => JSON.stringify([rowCount, lastRowKey, messagesVersion]);
